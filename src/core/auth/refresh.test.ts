import { describe, expect, test } from 'bun:test'
import type { AuthDef, Credential } from '../providers/types.ts'
import { fakePorts, fakeStore } from '../testing/fakes.ts'
import { AuthError, type OAuthCredential, type OAuthDef } from './oauth.ts'
import { ensureFresh, REFRESH_WINDOW_MS } from './refresh.ts'
import { createCredentialStore } from './store.ts'

const AUTH: OAuthDef = {
  kind: 'oauth',
  clientId: 'client_123',
  authorizeUrl: 'https://auth.example.com/oauth/authorize',
  tokenUrl: 'https://auth.example.com/oauth/token',
  scopes: ['openid'],
  redirect: { port: 1455, path: '/auth/callback' },
}

const API_AUTH: AuthDef = { kind: 'apiKey', help: 'paste a key', placeholder: 'sk-…' }

const FRESH_TOKENS = { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }

const oauthCred = (expiresInMs: number): OAuthCredential => ({
  type: 'oauth',
  access: 'old-access',
  refresh: 'old-refresh',
  expires: Date.now() + expiresInMs,
  accountId: 'acct_1',
})

const harness = (token?: () => Response) => {
  let calls = 0
  const ports = fakePorts({
    fetch: async () => {
      calls += 1
      // A real token endpoint is never instant; make the window for a duplicate wide.
      await new Promise((resolve) => setTimeout(resolve, 5))
      return token?.() ?? Response.json(FRESH_TOKENS)
    },
  })
  return { ports, creds: createCredentialStore(fakeStore()), calls: () => calls }
}

describe('ensureFresh', () => {
  test('leaves a live token alone and does no IO', async () => {
    const h = harness()
    const cred = oauthCred(30 * 60_000)
    expect(await ensureFresh('chatgpt', cred, AUTH, h.ports, h.creds)).toBe(cred)
    expect(h.calls()).toBe(0)
  })

  test('passes an api credential straight through', async () => {
    const h = harness()
    const cred: Credential = { type: 'api', key: 'sk-test' }
    expect(await ensureFresh('openai', cred, API_AUTH, h.ports, h.creds)).toBe(cred)
    expect(h.calls()).toBe(0)
  })

  test('does not try to refresh against a non-oauth AuthDef', async () => {
    const h = harness()
    const cred = oauthCred(-1000)
    expect(await ensureFresh('openai', cred, API_AUTH, h.ports, h.creds)).toBe(cred)
    expect(h.calls()).toBe(0)
  })

  test('refreshes a token inside the window and persists the result', async () => {
    const h = harness()
    const next = await ensureFresh('chatgpt', oauthCred(5_000), AUTH, h.ports, h.creds)

    expect(next).toEqual({
      type: 'oauth',
      access: 'new-access',
      refresh: 'new-refresh',
      expires: expect.any(Number),
      accountId: 'acct_1',
    })
    expect(h.calls()).toBe(1)
    expect(await h.creds.get('chatgpt')).toEqual(next)
  })

  test('refreshes a token that already expired', async () => {
    const h = harness()
    const next = await ensureFresh('chatgpt', oauthCred(-60_000), AUTH, h.ports, h.creds)
    expect((next as OAuthCredential).access).toBe('new-access')
    expect(h.calls()).toBe(1)
  })

  test('treats the window boundary as due for refresh', async () => {
    const h = harness()
    await ensureFresh('chatgpt', oauthCred(REFRESH_WINDOW_MS), AUTH, h.ports, h.creds)
    expect(h.calls()).toBe(1)
  })

  test('collapses concurrent callers into one network request', async () => {
    const h = harness()
    const cred = oauthCred(1_000)
    const [a, b, c] = await Promise.all([
      ensureFresh('claude', cred, AUTH, h.ports, h.creds),
      ensureFresh('claude', cred, AUTH, h.ports, h.creds),
      ensureFresh('claude', cred, AUTH, h.ports, h.creds),
    ])

    expect(h.calls()).toBe(1)
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  test('refreshes different providers independently', async () => {
    const h = harness()
    await Promise.all([
      ensureFresh('claude', oauthCred(1_000), AUTH, h.ports, h.creds),
      ensureFresh('chatgpt', oauthCred(1_000), AUTH, h.ports, h.creds),
    ])
    expect(h.calls()).toBe(2)
  })

  test('clears the stored credential and asks for a new sign-in when refresh fails', async () => {
    const h = harness(() => new Response('', { status: 401 }))
    await h.creds.set('chatgpt', oauthCred(1_000))

    const error = await ensureFresh('chatgpt', oauthCred(1_000), AUTH, h.ports, h.creds)
      .then(() => undefined)
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(AuthError)
    expect((error as AuthError).code).toBe('reauth_required')
    expect(await h.creds.get('chatgpt')).toBeUndefined()
  })

  test('keeps other providers signed in when one refresh fails', async () => {
    const h = harness(() => new Response('', { status: 401 }))
    await h.creds.set('openai', { type: 'api', key: 'sk-keep' })
    await h.creds.set('chatgpt', oauthCred(1_000))

    await ensureFresh('chatgpt', oauthCred(1_000), AUTH, h.ports, h.creds).catch(() => {})
    expect(await h.creds.get('openai')).toEqual({ type: 'api', key: 'sk-keep' })
  })

  test('does not wedge on a failed attempt', async () => {
    let attempt = 0
    const h = harness(() => {
      attempt += 1
      return attempt === 1 ? new Response('', { status: 500 }) : Response.json(FRESH_TOKENS)
    })

    await ensureFresh('claude', oauthCred(1_000), AUTH, h.ports, h.creds).catch(() => {})
    const next = await ensureFresh('claude', oauthCred(1_000), AUTH, h.ports, h.creds)

    expect((next as OAuthCredential).access).toBe('new-access')
    expect(h.calls()).toBe(2)
  })
})
