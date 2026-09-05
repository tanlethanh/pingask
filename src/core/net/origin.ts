// Not claiming to be a browser.
//
// tauri-plugin-http appends the webview's `Origin` to every request. Anthropic reads that
// as cross-origin browser traffic and applies an organisation policy about browsers to a
// desktop app whose requests never went near one: `CORS requests are not allowed for this
// Organization`.
//
// The plugin's escape hatch is an empty Origin, which with the `unsafe-headers` feature it
// removes rather than sends blank. Both halves are required — without the feature the
// plugin strips our empty value as a forbidden header and appends the webview origin
// anyway — so `src-tauri/Cargo.toml` enables it, and this file is why.

import type { FetchLike } from '../ports.ts'

const ORIGIN = 'origin'

/**
 * Wrap a transport so its requests carry no Origin.
 *
 * A caller that sets one keeps it: a provider that genuinely needs to present an origin
 * can still say so, and this only overrides the default nobody asked for.
 */
export const withoutOrigin = (fetch: FetchLike): FetchLike => {
  return (input, init) => {
    const headers = new Headers(init?.headers)
    if (!headers.has(ORIGIN)) headers.set(ORIGIN, '')
    return fetch(input, { ...init, headers })
  }
}
