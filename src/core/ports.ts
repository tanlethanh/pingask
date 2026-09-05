// Ports: the only way core/ touches the outside world.
//
// core/ never imports @tauri-apps/*. It declares what it needs here, platform/ supplies
// the implementations, and the app wires them together at startup. Tests pass in-memory
// fakes. See PLAN.md rule 2.

/** Namespaced key/value persistence. Backed by tauri-plugin-store on disk. */
export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
}

/**
 * WHATWG fetch, as a structural call signature rather than `typeof globalThis.fetch` —
 * that global carries a static `preconnect` under @types/bun which no plain function or
 * test double has. Supplied by platform/http.ts (Rust-backed, no CORS).
 */
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** Opens a URL in the user's default browser. */
export interface Browser {
  open(url: string): Promise<void>
}

/** A one-shot localhost listener for OAuth redirects. */
export interface LoopbackServer {
  /** Resolves with the full callback URL once the browser hits it. Rejects on timeout/cancel. */
  await(options: { port: number; timeoutMs?: number }): Promise<string>
}

/** Everything core/ needs from the host. */
export interface Ports {
  fetch: FetchLike
  browser: Browser
  loopback: LoopbackServer
  authStore: KeyValueStore
  settingsStore: KeyValueStore
  threadStore: KeyValueStore
  cacheStore: KeyValueStore
}
