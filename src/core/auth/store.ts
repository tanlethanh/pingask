// The only reader/writer of auth.json (PLAN.md rule 5).
//
// Decision #7: plaintext in the user-scoped app data dir, no keychain — both Tauri
// keychain plugins have been dead since late 2024, and opencode, claude, codex and gh all
// store credentials the same way.

import type { KeyValueStore } from '../ports.ts'
import type { Credential, CredentialMap, ProviderId } from '../providers/types.ts'

/**
 * Every credential lives under one key: `all()` is then a single read and a write is
 * atomic. KeyValueStore has no enumeration, and an index key kept beside flat entries
 * desyncs the moment one of the two writes fails.
 */
const KEY = 'credentials'

export interface CredentialStore {
  get(providerId: ProviderId): Promise<Credential | undefined>
  set(providerId: ProviderId, cred: Credential): Promise<void>
  remove(providerId: ProviderId): Promise<void>
  all(): Promise<CredentialMap>
}

/** Shape check on read. Returns undefined for anything we cannot use as-is. */
export const parseCredential = (value: unknown): Credential | undefined => {
  if (typeof value !== 'object' || value === null) return undefined
  const c = value as Record<string, unknown>
  if (c.type === 'api') return typeof c.key === 'string' ? { type: 'api', key: c.key } : undefined
  if (c.type === 'none') return { type: 'none' }
  if (c.type !== 'oauth') return undefined
  if (typeof c.access !== 'string' || typeof c.refresh !== 'string') return undefined
  if (typeof c.expires !== 'number' || !Number.isFinite(c.expires)) return undefined
  return {
    type: 'oauth',
    access: c.access,
    refresh: c.refresh,
    expires: c.expires,
    accountId: typeof c.accountId === 'string' ? c.accountId : undefined,
  }
}

export const createCredentialStore = (store: KeyValueStore): CredentialStore => {
  const all = async (): Promise<CredentialMap> => {
    const raw = await store.get<unknown>(KEY)
    if (typeof raw !== 'object' || raw === null) return {}
    const out: CredentialMap = {}
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      const cred = parseCredential(value)
      // Drop what does not parse instead of throwing: one corrupt entry must not lock
      // the user out of every other provider.
      if (cred) out[id as ProviderId] = cred
    }
    return out
  }

  return {
    all,

    get: async (providerId) => (await all())[providerId],

    set: async (providerId, cred) => {
      await store.set(KEY, { ...(await all()), [providerId]: cred })
    },

    remove: async (providerId) => {
      const next = await all()
      delete next[providerId]
      if (Object.keys(next).length === 0) await store.delete(KEY)
      else await store.set(KEY, next)
    },
  }
}
