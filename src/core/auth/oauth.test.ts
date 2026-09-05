import { describe, expect, test } from 'bun:test'
import { fakePorts } from '../testing/fakes.ts'
import {
  AuthError,
  authorize,
  decodeAccountId,
  type OAuthCredential,
  type OAuthDef,
  readCallback,
  refreshToken,
  toCredential,
} from './oauth.ts'
import { base64UrlEncode, codeChallenge } from './pkce.ts'

const AUTH: OAuthDef = {
  kind: 'oauth',
  clientId: 'client_123',
  authorizeUrl: 'https://auth.example.com/oauth/authorize',
  tokenUrl: 'https://auth.example.com/oauth/token',
  scopes: ['openid', 'profile', 'offline_access'],
  redirect: { port: 1455, path: '/auth/callback' },
  extraAuthorizeParams: { codex_cli_simplified_flow: 'true' },
}

const TOKENS = { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 }

interface TokenCall {
  url: string
  body: URLSearchParams
  headers: Record<string, string>
  /** Unparsed, so a JSON body can be inspected as well as a form one. */
  raw: string
}

/** Drives the browser + loopback handshake from a single callback-url function. */
const harness = (options: { token?: () => Response; callback?: (authorizeUrl: URL) => string }) => {
  const calls: TokenCall[] = []
  let opened: URL | undefined
  let loopbackPort: number | undefined
  let deliver: ((url: string) => void) | undefined
  let fail: ((reason: unknown) => void) | undefined
  // authorize() awaits generatePkce() before it ever reaches loopback.await, so a test
  // that fails the listener on the next line gets here first. Hold the reason and apply
  // it when the listener actually shows up, otherwise the flow hangs forever.
  let pendingFailure: { reason: unknown } | undefined

  const ports = fakePorts({
    fetch: async (input, init) => {
      const raw = String(init?.body ?? '')
      calls.push({
        url: String(input),
        body: new URLSearchParams(raw),
        headers: (init?.headers ?? {}) as Record<string, string>,
        raw,
      })
      return options.token?.() ?? Response.json(TOKENS)
    },
    browser: {
      open: async (url) => {
        opened = new URL(url)
        const callback = options.callback?.(opened)
        if (callback !== undefined) deliver?.(callback)
      },
    },
    loopback: {
      await: (opts) => {
        loopbackPort = opts.port
        if (pendingFailure) return Promise.reject(pendingFailure.reason)
        return new Promise<string>((resolve, reject) => {
          deliver = resolve
          fail = reject
        })
      },
    },
  })

  return {
    ports,
    calls,
    opened: () => opened!,
    loopbackPort: () => loopbackPort,
    fail: (reason: unknown) => {
      if (fail) fail(reason)
      else pendingFailure = { reason }
    },
  }
}

const echoState = (url: URL) =>
  `http://localhost:1455/auth/callback?code=auth-code&state=${url.searchParams.get('state')}`

const jwt = (payload: unknown): string =>
  ['e30', base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload))), 'sig'].join('.')

const caught = async (promise: Promise<unknown>): Promise<AuthError> => {
  const error = await promise.then(() => undefined).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(AuthError)
  return error as AuthError
}

describe('authorize', () => {
  test('builds the authorize url from the AuthDef alone', async () => {
    const h = harness({ callback: echoState })
    await authorize(AUTH, h.ports)

    const url = h.opened()
    expect(`${url.origin}${url.pathname}`).toBe('https://auth.example.com/oauth/authorize')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('client_123')
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:1455/auth/callback')
    expect(url.searchParams.get('scope')).toBe('openid profile offline_access')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(url.searchParams.get('originator')).toBe('pingask')
    expect(url.searchParams.get('codex_cli_simplified_flow')).toBe('true')
  })

  test('listens on the pinned port, and on an override when given', async () => {
    const h = harness({ callback: echoState })
    await authorize(AUTH, h.ports)
    expect(h.loopbackPort()).toBe(1455)

    const other = harness({
      callback: (url) =>
        `http://localhost:9999/auth/callback?code=c&state=${url.searchParams.get('state')}`,
    })
    await authorize(AUTH, other.ports, { port: 9999 })
    expect(other.loopbackPort()).toBe(9999)
    expect(other.opened().searchParams.get('redirect_uri')).toBe(
      'http://localhost:9999/auth/callback',
    )
  })

  test('exchanges the code and maps the token response', async () => {
    const h = harness({ callback: echoState })
    const before = Date.now()
    const cred = await authorize(AUTH, h.ports)

    expect(cred.type).toBe('oauth')
    expect(cred.access).toBe('access-1')
    expect(cred.refresh).toBe('refresh-1')
    expect(cred.expires).toBeGreaterThanOrEqual(before + 3_600_000)
    expect(cred.expires).toBeLessThanOrEqual(Date.now() + 3_600_000)
  })

  test('posts a form-encoded authorization_code grant', async () => {
    const h = harness({ callback: echoState })
    await authorize(AUTH, h.ports)

    expect(h.calls).toHaveLength(1)
    const call = h.calls[0]!
    expect(call.url).toBe('https://auth.example.com/oauth/token')
    expect(call.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(call.body.get('grant_type')).toBe('authorization_code')
    expect(call.body.get('code')).toBe('auth-code')
    expect(call.body.get('client_id')).toBe('client_123')
    expect(call.body.get('redirect_uri')).toBe('http://localhost:1455/auth/callback')
  })

  test('sends the verifier the challenge was derived from', async () => {
    const h = harness({ callback: echoState })
    await authorize(AUTH, h.ports)

    const verifier = h.calls[0]!.body.get('code_verifier')!
    expect(await codeChallenge(verifier)).toBe(h.opened().searchParams.get('code_challenge')!)
  })

  test('rejects a mismatched state without exchanging anything', async () => {
    const h = harness({
      callback: () => 'http://localhost:1455/auth/callback?code=auth-code&state=attacker',
    })
    const error = await caught(authorize(AUTH, h.ports))
    expect(error.code).toBe('state_mismatch')
    expect(h.calls).toHaveLength(0)
  })

  test('rejects a callback carrying no state at all', async () => {
    const h = harness({ callback: () => 'http://localhost:1455/auth/callback?code=auth-code' })
    const error = await caught(authorize(AUTH, h.ports))
    expect(error.code).toBe('state_mismatch')
    expect(h.calls).toHaveLength(0)
  })

  test('surfaces a denial from the redirect', async () => {
    const h = harness({
      callback: (url) =>
        `http://localhost:1455/auth/callback?error=access_denied&error_description=User+said+no&state=${url.searchParams.get('state')}`,
    })
    const error = await caught(authorize(AUTH, h.ports))
    expect(error.code).toBe('authorize_denied')
    expect(error.message).toBe('User said no')
    expect(h.calls).toHaveLength(0)
  })

  test('rejects a callback with a matching state but no code', async () => {
    const h = harness({
      callback: (url) =>
        `http://localhost:1455/auth/callback?state=${url.searchParams.get('state')}`,
    })
    expect((await caught(authorize(AUTH, h.ports))).code).toBe('missing_code')
  })

  test('reports a failed token exchange', async () => {
    const h = harness({
      callback: echoState,
      token: () => new Response('nope', { status: 400 }),
    })
    const error = await caught(authorize(AUTH, h.ports))
    expect(error.code).toBe('exchange_failed')
    expect(error.message).toContain('400')
  })

  test('propagates a loopback failure', async () => {
    const h = harness({})
    const flow = authorize(AUTH, h.ports)
    h.fail(new Error('port 1455 already in use'))
    await expect(flow).rejects.toThrow('port 1455 already in use')
  })
})

describe('readCallback', () => {
  test('returns the code when the state matches', () => {
    expect(readCallback('http://localhost:1455/cb?code=c1&state=s1', 's1')).toBe('c1')
  })

  test('accepts a path-only callback url', () => {
    expect(readCallback('/cb?code=c1&state=s1', 's1')).toBe('c1')
  })

  test('checks the state before the code', () => {
    // A redirect that is not ours must never reach the token endpoint, even when it
    // carries something code-shaped.
    let code: AuthError['code'] | undefined
    try {
      readCallback('/cb?code=c1&state=other', 's1')
    } catch (e) {
      code = (e as AuthError).code
    }
    expect(code).toBe('state_mismatch')
  })
})

describe('toCredential', () => {
  test('turns expires_in into an absolute timestamp', () => {
    const before = Date.now()
    const cred = toCredential({ access_token: 'a', refresh_token: 'r', expires_in: 120 })
    expect(cred.expires).toBeGreaterThanOrEqual(before + 120_000)
    expect(cred.expires).toBeLessThanOrEqual(Date.now() + 120_000)
  })

  test('defaults a missing expires_in to an hour', () => {
    const cred = toCredential({ access_token: 'a', refresh_token: 'r' })
    expect(cred.expires).toBeGreaterThan(Date.now() + 3_500_000)
  })

  test('throws when the response has no access token', () => {
    expect(() => toCredential({ refresh_token: 'r' })).toThrow(AuthError)
  })
})

describe('refreshToken', () => {
  const stale: OAuthCredential = {
    type: 'oauth',
    access: 'old-access',
    refresh: 'old-refresh',
    expires: 0,
    accountId: 'acct_1',
  }

  test('posts a refresh_token grant', async () => {
    const h = harness({})
    await refreshToken(AUTH, stale, h.ports)

    const call = h.calls[0]!
    expect(call.url).toBe('https://auth.example.com/oauth/token')
    expect(call.body.get('grant_type')).toBe('refresh_token')
    expect(call.body.get('refresh_token')).toBe('old-refresh')
    expect(call.body.get('client_id')).toBe('client_123')
    expect(call.body.get('code_verifier')).toBeNull()
  })

  test('keeps the old refresh token when the vendor does not rotate', async () => {
    const h = harness({ token: () => Response.json({ access_token: 'new', expires_in: 60 }) })
    const cred = await refreshToken(AUTH, stale, h.ports)
    expect(cred.access).toBe('new')
    expect(cred.refresh).toBe('old-refresh')
  })

  test('keeps the account id when the refresh response drops the id_token', async () => {
    const h = harness({})
    expect((await refreshToken(AUTH, stale, h.ports)).accountId).toBe('acct_1')
  })

  test('fails without touching the network when there is no refresh token', async () => {
    const h = harness({})
    const error = await caught(refreshToken(AUTH, { ...stale, refresh: '' }, h.ports))
    expect(error.code).toBe('reauth_required')
    expect(h.calls).toHaveLength(0)
  })

  test('reports a rejected refresh', async () => {
    const h = harness({ token: () => new Response('', { status: 401 }) })
    expect((await caught(refreshToken(AUTH, stale, h.ports))).code).toBe('refresh_failed')
  })
})

describe('decodeAccountId', () => {
  test('reads the top-level claim from the id token', () => {
    expect(decodeAccountId({ id_token: jwt({ chatgpt_account_id: 'acct_top' }) })).toBe('acct_top')
  })

  test('falls back to the access token', () => {
    expect(decodeAccountId({ access_token: jwt({ chatgpt_account_id: 'acct_a' }) })).toBe('acct_a')
  })

  test('reads the namespaced claim', () => {
    const token = jwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct_ns' } })
    expect(decodeAccountId({ id_token: token })).toBe('acct_ns')
  })

  test('falls back to the first organization', () => {
    expect(decodeAccountId({ id_token: jwt({ organizations: [{ id: 'org_1' }] }) })).toBe('org_1')
  })

  test('handles non-ascii payloads', () => {
    expect(decodeAccountId({ id_token: jwt({ chatgpt_account_id: 'ünïcode-✓' }) })).toBe(
      'ünïcode-✓',
    )
  })

  test('returns undefined for junk rather than throwing', () => {
    expect(decodeAccountId({})).toBeUndefined()
    expect(decodeAccountId({ id_token: 'not-a-jwt' })).toBeUndefined()
    expect(decodeAccountId({ id_token: 'a.!!!.c' })).toBeUndefined()
    expect(decodeAccountId({ id_token: jwt({ sub: 'nobody' }) })).toBeUndefined()
  })
})

describe('vendor-specific token requests', () => {
  const JSON_AUTH = { ...AUTH, tokenFormat: 'json' as const, sendStateOnExchange: true }

  test('a JSON provider posts JSON and echoes state back', async () => {
    // Regression: the generic flow was copied from a form-encoded vendor, and Anthropic's
    // endpoint answers 400 to a form body. The failure said only "400" because the
    // response body was discarded — which is why this went unnoticed.
    const h = harness({ callback: echoState })
    await authorize(JSON_AUTH, h.ports)

    const call = h.calls[0]!
    expect(call.headers['Content-Type']).toBe('application/json')
    const sent = JSON.parse(call.raw) as Record<string, string>
    expect(sent.grant_type).toBe('authorization_code')
    expect(sent.state).toBeDefined()
  })

  test('a form provider is unchanged and sends no state', async () => {
    const h = harness({ callback: echoState })
    await authorize(AUTH, h.ports)
    expect(h.calls[0]!.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(h.calls[0]!.body.get('state')).toBeNull()
  })

  test('a failed exchange carries the server explanation', async () => {
    const h = harness({
      callback: echoState,
      token: () => new Response('{"error":"invalid_grant"}', { status: 400 }),
    })
    const error = await caught(authorize(AUTH, h.ports))
    expect(error.message).toContain('400')
    expect(error.message).toContain('invalid_grant')
  })
})

describe('readCallback fragments', () => {
  test('splits a code#state parameter', () => {
    expect(readCallback('http://localhost:1455/cb?code=abc%23xyz&state=s1', 's1')).toBe('abc')
  })
})
