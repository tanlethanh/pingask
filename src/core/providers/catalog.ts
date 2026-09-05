// The models.dev catalog, fetched and cached to disk rather than hardcoded.
//
// A convenience, never a dependency: every lookup falls back to the stale cache, then to
// the provider's own hardcoded list. A models.dev outage must never stop inference.

import type { Ports } from '../ports.ts'
import type { ModelDef } from './types.ts'

export const CATALOG_URL = 'https://models.dev/api.json'
export const CATALOG_CACHE_KEY = 'models-dev'
export const CATALOG_TTL_MS = 24 * 60 * 60 * 1000

/** The handful of models.dev fields we read. A real entry carries far more. */
export interface CatalogModel {
  id?: string
  name?: string
  status?: string
  release_date?: string
  modalities?: { input?: string[]; output?: string[] }
  /** models.dev flags models that can reason before answering. */
  reasoning?: boolean
}

interface CatalogProvider {
  id?: string
  name?: string
  models?: Record<string, CatalogModel | undefined>
}

/** api.json, keyed by models.dev provider id. */
export type Catalog = Record<string, CatalogProvider | undefined>

/** What we persist. The TTL travels with the payload so the store stays dumb. */
interface CachedCatalog {
  fetchedAt: number
  catalog: Catalog
}

/**
 * A provider's slice of the catalog. Declared in the provider's own file so
 * adding a provider stays one file plus one registry line (PLAN.md rule 4).
 */
export interface CatalogSpec {
  /** Key in models.dev's api.json. `claude`/`chatgpt` borrow `anthropic`/`openai`. */
  catalogId: string
  /** Always present in the result, and always the only `default: true` entry. */
  defaultModel: string
  /** Used when the catalog is unreachable and nothing is cached. */
  fallback: ModelDef[]
  /** Narrows the catalog — a subscription exposes a subset of the API's models. */
  include?: (model: CatalogModel, id: string) => boolean
}

/** Families models.dev lists alongside chat models that we can never talk to. */
const NON_CHAT = /embedding|moderation|whisper|tts|audio|realtime|image|rerank|transcribe|guard/

/** Text-in/text-out, still supported. Embeddings claim text output, so match by id too. */
export const isChatModel = (model: CatalogModel, id: string): boolean => {
  if (model.status === 'deprecated') return false
  if (NON_CHAT.test(id)) return false
  const output = model.modalities?.output
  return output === undefined || output.every((m) => m === 'text')
}

/*
 * Keyed on the Ports they were loaded through, not on the module: a process-wide memo
 * would hand one set of ports the catalog fetched through another — which is what a test
 * suite looks like, and what a second Ports instance would look like at runtime.
 */
const inFlight = new WeakMap<Ports, Promise<Catalog | undefined>>()
const memo = new WeakMap<Ports, CachedCatalog>()

const readCache = async (ports: Ports): Promise<CachedCatalog | undefined> => {
  const held = memo.get(ports)
  if (held) return held
  try {
    const cached = await ports.cacheStore.get<CachedCatalog>(CATALOG_CACHE_KEY)
    if (!cached || typeof cached.fetchedAt !== 'number' || !cached.catalog) return undefined
    memo.set(ports, cached)
    return cached
  } catch {
    return undefined
  }
}

/**
 * Strip the catalog to the fields this module reads before it goes to disk.
 *
 * api.json is 4.3MB, almost all of it pricing, context limits and descriptions we
 * never look at. Providers are deliberately NOT filtered: scoping to the three we use
 * today would shrink it to 65KB but would silently starve any provider added later.
 */
const compact = (catalog: Catalog): Catalog => {
  const out: Catalog = {}
  for (const [providerId, provider] of Object.entries(catalog)) {
    const models: Record<string, CatalogModel> = {}
    for (const [modelId, model] of Object.entries(provider?.models ?? {})) {
      if (!model) continue
      const kept: CatalogModel = {}
      if (model.name !== undefined) kept.name = model.name
      if (model.release_date !== undefined) kept.release_date = model.release_date
      if (model.reasoning !== undefined) kept.reasoning = model.reasoning
      if (model.status !== undefined) kept.status = model.status
      if (model.modalities !== undefined) kept.modalities = model.modalities
      models[modelId] = kept
    }
    out[providerId] = { ...provider, models }
  }
  return out
}

const download = async (ports: Ports): Promise<Catalog | undefined> => {
  let catalog: Catalog
  try {
    const res = await ports.fetch(CATALOG_URL)
    if (!res.ok) return undefined
    const body: unknown = await res.json()
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined
    catalog = compact(body as Catalog)
  } catch {
    return undefined
  }
  const entry: CachedCatalog = { fetchedAt: Date.now(), catalog }
  memo.set(ports, entry)
  try {
    await ports.cacheStore.set(CATALOG_CACHE_KEY, entry)
  } catch {
    // A read-only cache is not a reason to fail the lookup.
  }
  return catalog
}

/** Deduplicates the download when several providers ask for the catalog at once. */
const downloadOnce = (ports: Ports): Promise<Catalog | undefined> => {
  const running = inFlight.get(ports)
  if (running) return running
  const started = download(ports).finally(() => inFlight.delete(ports))
  inFlight.set(ports, started)
  return started
}

/** api.json, from cache while fresh. Undefined only when there is nothing at all. */
export const loadCatalog = async (ports: Ports): Promise<Catalog | undefined> => {
  const cached = await readCache(ports)
  if (cached && Date.now() - cached.fetchedAt < CATALOG_TTL_MS) return cached.catalog
  // A stale cache still beats no catalog when the network is down.
  return (await downloadOnce(ports)) ?? cached?.catalog
}

/**
 * Guarantees exactly one `default: true`, at the front of the list.
 *
 * Every other field is carried through. Rebuilding entries from {id, label} dropped
 * `reasoning`, which disabled the extended-thinking toggle for every catalog model.
 */
const withDefault = (models: ModelDef[], defaultModel: string): ModelDef[] => {
  const hit = models.find((model) => model.id === defaultModel)
  const rest = models
    .filter((model) => model.id !== defaultModel)
    .map(({ id, label, reasoning }) => ({ id, label, reasoning }) satisfies ModelDef)
  return [
    {
      id: defaultModel,
      label: hit?.label ?? defaultModel,
      reasoning: hit?.reasoning,
      default: true,
    },
    ...rest,
  ]
}

/** A provider's model list: catalog if we have one, its hardcoded fallback if not. */
export const listCatalogModels = async (spec: CatalogSpec, ports: Ports): Promise<ModelDef[]> => {
  const catalog = await loadCatalog(ports)
  const models = catalog?.[spec.catalogId]?.models
  if (!models) return withDefault(spec.fallback, spec.defaultModel)

  const include = spec.include ?? isChatModel
  const found: Array<ModelDef & { release: string }> = []
  for (const [id, model] of Object.entries(models)) {
    if (!model || !include(model, id)) continue
    found.push({
      id,
      label: model.name ?? id,
      release: model.release_date ?? '',
      reasoning: model.reasoning === true,
    })
  }
  if (found.length === 0) return withDefault(spec.fallback, spec.defaultModel)

  // Newest first — api.json's key order is arbitrary.
  found.sort((a, b) => b.release.localeCompare(a.release) || a.id.localeCompare(b.id))
  return withDefault(found, spec.defaultModel)
}
