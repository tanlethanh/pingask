// Transport. Every network call the app makes goes through a FetchLike from here.
//
// PLAN.md decision #5: providers never reach for globalThis.fetch. The Rust-backed fetch
// is injected into every provider factory so requests leave the process rather than the
// webview, which sidesteps CORS entirely. Hosts must still be allowlisted in
// src-tauri/capabilities/default.json under the `http:default` entry.

import { fetch as pluginHttpFetch } from '@tauri-apps/plugin-http'
import { withoutOrigin } from '../core/net/origin.ts'
import type { FetchLike } from '../core/ports.ts'

/**
 * Rust-backed fetch. No CORS and no preflight; the capability allowlist is the only gate.
 * `init` additionally accepts plugin-http's ClientOptions (connectTimeout, proxy,
 * maxRedirections) which plain FetchLike callers can ignore.
 *
 * No CORS is not the same as no `Origin`: the plugin forwards the webview's origin on
 * every request, so a vendor that gates on the header still applies its browser rules.
 * `withoutOrigin` takes that claim back off — see core/net/origin.ts.
 *
 * Callers: do not hand this an `AbortSignal.timeout()`. That signal fires even after the
 * request completes, and the plugin never removes the abort listeners it attaches to it,
 * so a late abort calls fetch_cancel against resources it has already released and the
 * webview reports "The resource id N is invalid." Use an AbortController with a timer you
 * clear once the request settles.
 */
export const tauriFetch: FetchLike = withoutOrigin(pluginHttpFetch)

/**
 * The webview's own fetch. Not used today — the documented retreat for PLAN.md spike S1.
 *
 * It is subject to CORS, so a provider only works through it if the vendor sends
 * permissive headers, and it cannot drop its own Origin the way `tauriFetch` does.
 * What it does guarantee is genuinely incremental streaming, since it is the browser's
 * own implementation.
 */
export const webviewFetch: FetchLike = globalThis.fetch

/**
 * The single switch deciding which transport the app runs on.
 *
 * PLAN.md spike S1 asks whether plugin-http's fetch streams an SSE body incrementally or
 * buffers it. If it buffers, change this one line to return `webviewFetch` and add the
 * Anthropic browser-access header to that provider's quirks. Nothing else moves.
 */
export const pickFetch = (): FetchLike => tauriFetch
