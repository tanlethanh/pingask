// JWT claim reading for OAuth tokens.
//
// The signature is deliberately NOT verified: these are opaque identifiers and routing
// hints echoed back in request headers, never a trust decision. The token arrived over TLS
// from the vendor's own token endpoint, and a forged value would only address the wrong
// account, which the vendor rejects. Verifying would mean shipping JWKS for no gain.

/** Only the claims we actually read. Everything else in the token is ignored. */
export interface TokenClaims {
  chatgpt_account_id?: string
  /** Which OpenAI region must serve this account, or 'no_constraint'. */
  chatgpt_compute_residency?: string
  organizations?: Array<{ id: string }>
  'https://api.openai.com/auth'?: {
    chatgpt_account_id?: string
    chatgpt_compute_residency?: string
  }
}

const base64UrlDecodeToString = (value: string): string => {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
}

/** Undefined for anything that is not a readable JWT — callers always have a fallback. */
export const readClaims = (token: string | undefined): TokenClaims | undefined => {
  const part = token?.split('.')[1]
  if (!part) return undefined
  try {
    return JSON.parse(base64UrlDecodeToString(part)) as TokenClaims
  } catch {
    return undefined
  }
}

export const accountIdOf = (claims: TokenClaims | undefined): string | undefined =>
  claims?.chatgpt_account_id ??
  claims?.['https://api.openai.com/auth']?.chatgpt_account_id ??
  claims?.organizations?.[0]?.id

/**
 * The region constraint the ChatGPT backend expects echoed back as
 * `x-openai-internal-codex-residency`. 'no_constraint' means "send no header".
 */
export const residencyOf = (claims: TokenClaims | undefined): string | undefined => {
  const residency =
    claims?.['https://api.openai.com/auth']?.chatgpt_compute_residency ??
    claims?.chatgpt_compute_residency
  return !residency || residency === 'no_constraint' ? undefined : residency
}
