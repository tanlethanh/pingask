// PKCE (RFC 7636) and the CSRF state token, over Web Crypto only.
//
// No OAuth library on purpose: the endpoints we talk to carry non-standard authorize
// params that RFC-conformant clients strip or reject. This is the whole crypto surface.

/** The unreserved character set, RFC 7636 §4.1. */
const VERIFIER_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
const VERIFIER_LENGTH = 43
const STATE_BYTES = 32

export interface Pkce {
  verifier: string
  challenge: string
}

/** base64url without padding. Hand-rolled — this runs in a webview, so no Node Buffer. */
export const base64UrlEncode = (bytes: Uint8Array): string => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

const randomBytes = (length: number): Uint8Array => crypto.getRandomValues(new Uint8Array(length))

/** The S256 challenge for a verifier: base64url(sha256(verifier)). */
export const codeChallenge = async (verifier: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64UrlEncode(new Uint8Array(digest))
}

export const generatePkce = async (): Promise<Pkce> => {
  const verifier = Array.from(
    randomBytes(VERIFIER_LENGTH),
    (byte) => VERIFIER_CHARS[byte % VERIFIER_CHARS.length]!,
  ).join('')
  return { verifier, challenge: await codeChallenge(verifier) }
}

/** Opaque token echoed back through the redirect and compared byte-for-byte. */
export const randomState = (): string => base64UrlEncode(randomBytes(STATE_BYTES))
