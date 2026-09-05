import type { Browser, FetchLike, KeyValueStore, LoopbackServer, Ports } from '../ports.ts'

/**
 * In-memory KeyValueStore. Values are cloned in and out, so a test sees the same aliasing
 * behaviour it would get from a real JSON file on disk.
 */
export const fakeStore = (initial?: Record<string, unknown>): KeyValueStore => {
  const data = new Map<string, unknown>(Object.entries(initial ?? {}))
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const value = data.get(key)
      return value === undefined ? undefined : (structuredClone(value) as T)
    },
    async set(key: string, value: unknown): Promise<void> {
      data.set(key, structuredClone(value))
    },
    async delete(key: string): Promise<void> {
      data.delete(key)
    },
  }
}

/** Fails loudly rather than reaching the network from a unit test. */
const fakeFetch: FetchLike = async (input) => {
  throw new Error(`fakePorts.fetch was called: ${String(input)}`)
}

const fakeBrowser = (): Browser => ({
  async open() {},
})

const fakeLoopback = (): LoopbackServer => ({
  async await() {
    throw new Error('fakePorts.loopback.await was called')
  },
})

/** Ports with no Tauri and no network. Override only what the test cares about. */
export const fakePorts = (overrides?: Partial<Ports>): Ports => ({
  fetch: fakeFetch,
  browser: fakeBrowser(),
  loopback: fakeLoopback(),
  authStore: fakeStore(),
  settingsStore: fakeStore(),
  threadStore: fakeStore(),
  cacheStore: fakeStore(),
  ...overrides,
})
