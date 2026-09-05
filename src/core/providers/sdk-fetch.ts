import type { FetchLike } from '../ports.ts'

/**
 * Hand our transport to an ai-SDK provider factory.
 *
 * The factories type their `fetch` option as `typeof globalThis.fetch`. Under
 * @types/bun that global carries a static `preconnect` property, which no plain
 * function — and no test double — has. `FetchLike` is the honest call signature, so
 * the mismatch is purely nominal.
 *
 * One cast lives here rather than one at every provider.
 */
export const sdkFetch = (fetch: FetchLike): typeof globalThis.fetch =>
  fetch as typeof globalThis.fetch
