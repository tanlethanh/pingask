import { describe, expect, test } from 'bun:test'
import type { FetchLike } from '../ports.ts'
import { fakePorts, fakeStore } from '../testing/fakes.ts'
import type { CatalogSpec } from './catalog.ts'
import {
  CATALOG_CACHE_KEY,
  CATALOG_TTL_MS,
  CATALOG_URL,
  isChatModel,
  listCatalogModels,
} from './catalog.ts'
import type { ModelDef } from './types.ts'

const FALLBACK: ModelDef[] = [
  { id: 'fallback-a', label: 'Fallback A' },
  { id: 'fallback-b', label: 'Fallback B' },
]

const SPEC: CatalogSpec = {
  catalogId: 'acme',
  defaultModel: 'acme-2',
  fallback: FALLBACK,
}

/** Shaped like models.dev api.json, trimmed to the fields catalog.ts reads. */
const API_JSON = {
  acme: {
    id: 'acme',
    name: 'Acme',
    models: {
      'acme-1': {
        id: 'acme-1',
        name: 'Acme One',
        release_date: '2025-01-01',
        reasoning: true,
      },
      'acme-2': {
        id: 'acme-2',
        name: 'Acme Two',
        release_date: '2026-01-01',
        reasoning: true,
      },
      'acme-old': { id: 'acme-old', name: 'Acme Old', status: 'deprecated' },
      'acme-embedding': { id: 'acme-embedding', name: 'Acme Embedding' },
      'acme-draw': {
        id: 'acme-draw',
        name: 'Acme Draw',
        modalities: { input: ['text'], output: ['image'] },
      },
    },
  },
}

/** Bun types `fetch` with a `preconnect` member; a bare handler is not assignable. */
const stubFetch = (
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): FetchLike => Object.assign(handler, { preconnect: () => {} })

/** Counts calls so the tests can assert whether the network was touched. */
const countingFetch = (
  body: unknown,
  calls: string[] = [],
): { fetch: FetchLike; calls: string[] } => ({
  calls,
  fetch: stubFetch(async (input) => {
    calls.push(String(input))
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }),
})

const offlineFetch = (calls: string[] = []): FetchLike =>
  stubFetch(async (input) => {
    calls.push(String(input))
    throw new TypeError('network unreachable')
  })

describe('listCatalogModels', () => {
  test('reads models.dev, filters non-chat entries and marks one default', async () => {
    const { fetch, calls } = countingFetch(API_JSON)
    const models = await listCatalogModels(SPEC, fakePorts({ fetch }))

    expect(calls).toEqual([CATALOG_URL])
    expect(models.map((m) => m.id)).toEqual(['acme-2', 'acme-1'])
    expect(models.filter((m) => m.default)).toHaveLength(1)
    expect(models[0]).toEqual({
      id: 'acme-2',
      label: 'Acme Two',
      reasoning: true,
      default: true,
    })
  })

  test('sorts newest first, after the default', async () => {
    const { fetch } = countingFetch({
      acme: {
        models: {
          old: { id: 'old', name: 'Old', release_date: '2024-01-01' },
          mid: { id: 'mid', name: 'Mid', release_date: '2025-06-01' },
          'acme-2': { id: 'acme-2', name: 'Acme Two', release_date: '2020-01-01' },
        },
      },
    })
    const models = await listCatalogModels(SPEC, fakePorts({ fetch }))
    expect(models.map((m) => m.id)).toEqual(['acme-2', 'mid', 'old'])
  })

  test('inserts the default even when the catalog does not list it', async () => {
    const { fetch } = countingFetch({ acme: { models: { other: { id: 'other', name: 'Other' } } } })
    const models = await listCatalogModels(SPEC, fakePorts({ fetch }))
    expect(models[0]).toEqual({ id: 'acme-2', label: 'acme-2', default: true })
    expect(models.filter((m) => m.default)).toHaveLength(1)
  })

  test('honours a provider-supplied include filter', async () => {
    const { fetch } = countingFetch(API_JSON)
    const models = await listCatalogModels(
      { ...SPEC, include: (_model, id) => id === 'acme-1' || id === 'acme-2' },
      fakePorts({ fetch }),
    )
    expect(models.map((m) => m.id)).toEqual(['acme-2', 'acme-1'])
  })

  test('falls back to the provider list when the catalog has no such provider', async () => {
    const { fetch } = countingFetch({ someone_else: { models: {} } })
    const models = await listCatalogModels(SPEC, fakePorts({ fetch }))
    expect(models.map((m) => m.id)).toEqual(['acme-2', 'fallback-a', 'fallback-b'])
  })
})

describe('cache', () => {
  test('writes the fetched catalog with a timestamp', async () => {
    const cacheStore = fakeStore()
    const { fetch } = countingFetch(API_JSON)
    const before = Date.now()
    await listCatalogModels(SPEC, fakePorts({ fetch, cacheStore }))

    const cached = await cacheStore.get<{ fetchedAt: number; catalog: unknown }>(CATALOG_CACHE_KEY)
    expect(cached?.fetchedAt).toBeGreaterThanOrEqual(before)
    // The cache holds a compacted catalog: api.json is 4.3MB, almost all of it fields
    // this module never reads, and `id` is redundant with the key it is stored under.
    expect(cached?.catalog).toEqual({
      acme: {
        id: 'acme',
        name: 'Acme',
        models: {
          'acme-1': { name: 'Acme One', release_date: '2025-01-01', reasoning: true },
          'acme-2': { name: 'Acme Two', release_date: '2026-01-01', reasoning: true },
          'acme-old': { name: 'Acme Old', status: 'deprecated' },
          'acme-embedding': { name: 'Acme Embedding' },
          'acme-draw': { name: 'Acme Draw', modalities: { input: ['text'], output: ['image'] } },
        },
      },
    })
  })

  test('serves a fresh cache without touching the network', async () => {
    const cacheStore = fakeStore({
      [CATALOG_CACHE_KEY]: { fetchedAt: Date.now() - 1000, catalog: API_JSON },
    })
    const calls: string[] = []
    const models = await listCatalogModels(
      SPEC,
      fakePorts({ fetch: offlineFetch(calls), cacheStore }),
    )

    expect(calls).toEqual([])
    expect(models.map((m) => m.id)).toEqual(['acme-2', 'acme-1'])
  })

  test('refetches once the entry is older than the TTL', async () => {
    const cacheStore = fakeStore({
      [CATALOG_CACHE_KEY]: {
        fetchedAt: Date.now() - CATALOG_TTL_MS - 1,
        catalog: { acme: { models: { stale: { id: 'stale', name: 'Stale' } } } },
      },
    })
    const { fetch, calls } = countingFetch(API_JSON)
    const models = await listCatalogModels(SPEC, fakePorts({ fetch, cacheStore }))

    expect(calls).toEqual([CATALOG_URL])
    expect(models.map((m) => m.id)).toEqual(['acme-2', 'acme-1'])
  })

  test('serves a stale cache when the refetch fails', async () => {
    const cacheStore = fakeStore({
      [CATALOG_CACHE_KEY]: {
        fetchedAt: Date.now() - CATALOG_TTL_MS - 1,
        catalog: { acme: { models: { stale: { id: 'stale', name: 'Stale' } } } },
      },
    })
    const calls: string[] = []
    const models = await listCatalogModels(
      SPEC,
      fakePorts({ fetch: offlineFetch(calls), cacheStore }),
    )

    expect(calls).toEqual([CATALOG_URL])
    expect(models.map((m) => m.id)).toEqual(['acme-2', 'stale'])
  })
})

describe('failure never breaks inference', () => {
  test('a thrown fetch falls back to the provider list', async () => {
    const models = await listCatalogModels(SPEC, fakePorts({ fetch: offlineFetch() }))
    expect(models.map((m) => m.id)).toEqual(['acme-2', 'fallback-a', 'fallback-b'])
  })

  test('a non-200 response falls back to the provider list', async () => {
    const fetch = stubFetch(async () => new Response('nope', { status: 503 }))
    const models = await listCatalogModels(SPEC, fakePorts({ fetch }))
    expect(models.map((m) => m.id)).toEqual(['acme-2', 'fallback-a', 'fallback-b'])
  })

  test('a malformed body falls back to the provider list', async () => {
    const fetch = stubFetch(async () => new Response('<html>bad gateway</html>', { status: 200 }))
    const models = await listCatalogModels(SPEC, fakePorts({ fetch }))
    expect(models.map((m) => m.id)).toEqual(['acme-2', 'fallback-a', 'fallback-b'])
  })

  test('a throwing cacheStore does not break the lookup', async () => {
    const broken = {
      async get() {
        throw new Error('disk gone')
      },
      async set() {
        throw new Error('disk gone')
      },
      async delete() {
        throw new Error('disk gone')
      },
    }
    const { fetch } = countingFetch(API_JSON)
    const models = await listCatalogModels(SPEC, fakePorts({ fetch, cacheStore: broken }))
    expect(models.map((m) => m.id)).toEqual(['acme-2', 'acme-1'])
  })
})

describe('isChatModel', () => {
  test('keeps text models and drops the rest', () => {
    expect(isChatModel({ modalities: { output: ['text'] } }, 'gpt-5.5')).toBe(true)
    expect(isChatModel({}, 'claude-sonnet-4-6')).toBe(true)
    expect(isChatModel({ status: 'deprecated' }, 'gpt-4')).toBe(false)
    expect(isChatModel({ modalities: { output: ['text'] } }, 'text-embedding-3-small')).toBe(false)
    expect(isChatModel({ modalities: { output: ['image'] } }, 'gpt-image-2')).toBe(false)
    expect(isChatModel({ modalities: { output: ['text', 'audio'] } }, 'gpt-realtime')).toBe(false)
  })
})

describe('capability flags survive the list', () => {
  const catalogFetch = (): FetchLike =>
    Object.assign(async () => Response.json(API_JSON), { preconnect: () => {} })

  test('reasoning is kept on the default model and the rest alike', async () => {
    // Regression: withDefault rebuilt entries from {id, label}, so `reasoning` never
    // reached ModelDef and the extended-thinking toggle was disabled for every
    // catalog-sourced model.
    const models = await listCatalogModels(SPEC, fakePorts({ fetch: catalogFetch() }))

    const byId = new Map(models.map((model) => [model.id, model]))
    expect(byId.get('acme-2')?.default).toBe(true)
    expect(byId.get('acme-2')?.reasoning).toBe(true)
    expect(byId.get('acme-1')?.reasoning).toBe(true)
  })

  test('a model without the flag stays unset rather than becoming true', async () => {
    const models = await listCatalogModels(SPEC, fakePorts({ fetch: catalogFetch() }))
    expect(models.find((model) => model.id === 'acme-embedding')).toBeUndefined()
    expect(models.every((model) => model.reasoning !== undefined)).toBe(true)
  })
})
