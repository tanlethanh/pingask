// One OAuth flow for every provider, driven entirely by an AuthDef. Adding a provider is
// a new entry in core/providers/ — it never touches this file.
//
// Ported from opencode's provider/openai.ts, minus Effect and minus Node: the loopback
// listener and the browser launch arrive as ports, so it runs under `bun test`.

import type { Ports } from '../ports.ts'
import type { AuthDef, Credential } from '../providers/types.ts'
import { accountIdOf, readClaims } from './claims.ts'
import { generatePkce, type Pkce, randomState } from './pkce.ts'

export type OAuthDef = Extract<AuthDef, { kind: 'oauth' }>
export type OAuthCredential = Extract<Credential, { type: 'oauth' }>

export type AuthErrorCode =
  | 'state_mismatch'
  | 'authorize_denied'
  | 'missing_code'
  | 'exchange_failed'
  | 'refresh_failed'
  | 'reauth_required'

/** Typed so the UI can tell "retry" apart from "sign in again" without string matching. */
export class AuthError extends Error {
  readonly code: AuthErrorCode

  constructor(code: AuthErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'AuthError'
    this.code = code
  }
}

/** The subset of an OAuth token response we read. Everything else is ignored. */
export interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  id_token?: string
}

export interface AuthorizeOptions {
  /** Overrides the vendor's pinned port — tests use it, the app should not. */
  port?: number
  timeoutMs?: number
}

const DEFAULT_EXPIRES_IN = 3600

export const redirectUriFor = (auth: OAuthDef, port = auth.redirect.port): string =>
  `http://localhost:${port}${auth.redirect.path}`

export const buildAuthorizeUrl = (
  auth: OAuthDef,
  redirectUri: string,
  pkce: Pkce,
  state: string,
): string => {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: auth.clientId,
    redirect_uri: redirectUri,
    scope: auth.scopes.join(' '),
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    state,
    // Identify ourselves rather than impersonating another client, as opencode does.
    originator: 'pingask',
    ...auth.extraAuthorizeParams,
  })
  return `${auth.authorizeUrl}?${params}`
}

/**
 * Read the code out of the redirect we were handed. The state comparison is strict and
 * comes first: it is the entire CSRF defence, and there is no lenient path past it.
 */
export const readCallback = (callbackUrl: string, state: string): string => {
  const params = new URL(callbackUrl, 'http://localhost').searchParams
  const error = params.get('error_description') ?? params.get('error')
  if (error) throw new AuthError('authorize_denied', error)
  if (params.get('state') !== state) {
    throw new AuthError('state_mismatch', 'OAuth state did not match — redirect rejected')
  }
  const code = params.get('code')
  if (!code) throw new AuthError('missing_code', 'Callback carried no authorization code')
  // Anthropic can hand back `code#state` in one parameter. Splitting on the fragment is
  // a no-op for vendors that never do it — a code never legitimately contains '#'.
  return code.split('#')[0] ?? code
}

/** How a vendor wants its token request encoded. Form is the OAuth 2 default. */
export type TokenFormat = 'form' | 'json'

/**
 * A failed token response describes itself — `invalid_grant`, `unsupported_grant_type`.
 * Dropping the body turns every failure into "400" and every fix into a guess.
 */
const describe = (status: number, body: string): string => {
  const trimmed = body.trim().replace(/\s+/g, ' ').slice(0, 300)
  return trimmed
    ? `Token request failed: ${status} — ${trimmed}`
    : `Token request failed: ${status}`
}

const postToken = async (
  url: string,
  body: Record<string, string>,
  ports: Ports,
  failure: AuthErrorCode,
  format: TokenFormat,
): Promise<TokenResponse> => {
  let response: Response
  try {
    response = await ports.fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type':
          format === 'json' ? 'application/json' : 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: format === 'json' ? JSON.stringify(body) : new URLSearchParams(body).toString(),
    })
  } catch (cause) {
    throw new AuthError(failure, `Token request to ${url} failed`, { cause })
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new AuthError(failure, describe(response.status, detail))
  }
  try {
    return (await response.json()) as TokenResponse
  } catch (cause) {
    throw new AuthError(failure, 'Token response was not JSON', { cause })
  }
}

/** Map a token response onto a stored credential with an absolute expiry. */
export const toCredential = (
  tokens: TokenResponse,
  previous?: OAuthCredential,
): OAuthCredential => {
  if (!tokens.access_token) {
    throw new AuthError('exchange_failed', 'Token response carried no access_token')
  }
  return {
    type: 'oauth',
    access: tokens.access_token,
    // Vendors that do not rotate omit refresh_token on refresh; keep the one we hold.
    refresh: tokens.refresh_token ?? previous?.refresh ?? '',
    expires: Date.now() + (tokens.expires_in ?? DEFAULT_EXPIRES_IN) * 1000,
    // Refresh responses usually drop the id_token, so fall back to what we already knew.
    accountId: decodeAccountId(tokens) ?? previous?.accountId,
  }
}

export const exchange = async (
  auth: OAuthDef,
  code: string,
  redirectUri: string,
  verifier: string,
  ports: Ports,
  state?: string,
): Promise<OAuthCredential> => {
  const tokens = await postToken(
    auth.tokenUrl,
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: auth.clientId,
      code_verifier: verifier,
      // Anthropic's endpoint rejects the exchange without it; OpenAI's does not ask for
      // it, so it is only sent when the provider says so.
      ...(auth.sendStateOnExchange && state ? { state } : {}),
    },
    ports,
    'exchange_failed',
    auth.tokenFormat ?? 'form',
  )
  return toCredential(tokens)
}

export const refreshToken = async (
  auth: OAuthDef,
  cred: OAuthCredential,
  ports: Ports,
): Promise<OAuthCredential> => {
  if (!cred.refresh) {
    throw new AuthError('reauth_required', 'No refresh token on this credential')
  }
  const tokens = await postToken(
    auth.tokenUrl,
    {
      grant_type: 'refresh_token',
      refresh_token: cred.refresh,
      client_id: auth.clientId,
    },
    ports,
    'refresh_failed',
    auth.tokenFormat ?? 'form',
  )
  return toCredential(tokens, cred)
}

/**
 * Run the whole browser flow and return the credential. Does not persist — the caller
 * decides where it lands.
 */
export const authorize = async (
  auth: OAuthDef,
  ports: Ports,
  opts: AuthorizeOptions = {},
): Promise<OAuthCredential> => {
  const port = opts.port ?? auth.redirect.port
  const redirectUri = redirectUriFor(auth, port)
  const pkce = await generatePkce()
  const state = randomState()

  // Listen before opening the browser: a cached consent screen can redirect faster than
  // the listener would otherwise bind.
  const callback = ports.loopback.await({ port, timeoutMs: opts.timeoutMs })
  // Keep a listener failure from surfacing as an unhandled rejection when the browser
  // launch throws first; the real rejection is still delivered at the await below.
  callback.catch(() => {})

  await ports.browser.open(buildAuthorizeUrl(auth, redirectUri, pkce, state))
  const code = readCallback(await callback, state)
  return exchange(auth, code, redirectUri, pkce.verifier, ports, state)
}

/**
 * Pull the ChatGPT account id out of the tokens, mirroring opencode's claim().
 *
 * The id_token carries it on a fresh login; refresh responses usually drop the id_token,
 * so the access token is read as a fallback.
 */
export const decodeAccountId = (tokens: TokenResponse): string | undefined =>
  accountIdOf(readClaims(tokens.id_token)) ?? accountIdOf(readClaims(tokens.access_token))
