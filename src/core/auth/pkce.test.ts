import { describe, expect, test } from 'bun:test'
import { base64UrlEncode, codeChallenge, generatePkce, randomState } from './pkce.ts'

describe('generatePkce', () => {
  test('verifier is 43 unreserved characters', async () => {
    const { verifier } = await generatePkce()
    expect(verifier).toHaveLength(43)
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43}$/)
  })

  test('challenge is unpadded base64url of a sha256 digest', async () => {
    const { challenge } = await generatePkce()
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(challenge).not.toContain('=')
  })

  test('challenge matches the verifier it was derived from', async () => {
    const { verifier, challenge } = await generatePkce()
    expect(challenge).toBe(await codeChallenge(verifier))
  })

  test('two calls do not collide', async () => {
    const [a, b] = await Promise.all([generatePkce(), generatePkce()])
    expect(a.verifier).not.toBe(b.verifier)
  })
})

describe('codeChallenge', () => {
  // RFC 7636 appendix B.
  test('reproduces the RFC 7636 vector', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    expect(await codeChallenge(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })
})

describe('base64UrlEncode', () => {
  test('uses the url alphabet and drops padding', () => {
    // 0xfb 0xff encodes to "+/8=" in standard base64.
    expect(base64UrlEncode(new Uint8Array([0xfb, 0xff]))).toBe('-_8')
  })

  test('round-trips through atob', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255])
    const encoded = base64UrlEncode(bytes)
    const binary = atob(encoded.replaceAll('-', '+').replaceAll('_', '/').padEnd(12, '='))
    expect([...binary].map((c) => c.charCodeAt(0))).toEqual([...bytes])
  })
})

describe('randomState', () => {
  test('is 32 bytes of base64url', () => {
    expect(randomState()).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  test('never repeats', () => {
    const seen = new Set(Array.from({ length: 100 }, randomState))
    expect(seen.size).toBe(100)
  })
})
