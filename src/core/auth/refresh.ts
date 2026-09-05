// Keeping an OAuth credential usable. Called on the hot path before every request, so
// the common case — a token with hours left — does no IO at all.

import type { Ports } from '../ports.ts'
import type { AuthDef, Credential, ProviderId } from '../providers/types.ts'
import { AuthError, type OAuthCredential, refreshToken } from './oauth.ts'
import type { CredentialStore } from './store.ts'

/** Refresh this far ahead of the real expiry, so a request never races the deadline. */
export const REFRESH_WINDOW_MS = 60_000

/**
 * One refresh in flight per provider. Two panes asking at once would otherwise both
 * spend the refresh token, and vendors that rotate invalidate the loser.
 */
const inflight = new Map<ProviderId, Promise<Credential>>()

export const ensureFresh = async (
  providerId: ProviderId,
  cred: Credential,
  auth: AuthDef,
  ports: Ports,
  credStore: CredentialStore,
): Promise<Credential> => {
  if (cred.type !== 'oauth' || auth.kind !== 'oauth') return cred
  if (cred.expires - Date.now() > REFRESH_WINDOW_MS) return cred

  const existing = inflight.get(providerId)
  if (existing) return existing

  const task = rotate(providerId, cred, auth, ports, credStore).finally(() => {
    inflight.delete(providerId)
  })
  inflight.set(providerId, task)
  return task
}

const rotate = async (
  providerId: ProviderId,
  cred: OAuthCredential,
  auth: Extract<AuthDef, { kind: 'oauth' }>,
  ports: Ports,
  credStore: CredentialStore,
): Promise<Credential> => {
  let next: OAuthCredential
  try {
    next = await refreshToken(auth, cred, ports)
  } catch (cause) {
    // The refresh token is spent, revoked or rejected — there is nothing here to retry.
    // Drop it so the UI asks for a new sign-in instead of looping on a dead credential.
    await credStore.remove(providerId).catch(() => {})
    throw cause instanceof AuthError && cause.code === 'reauth_required'
      ? cause
      : new AuthError('reauth_required', `Sign in to ${providerId} again`, { cause })
  }
  await credStore.set(providerId, next)
  return next
}
