import { createOllama } from 'ai-sdk-ollama'
import type { Ports } from '../ports.ts'
import { sdkFetch } from './sdk-fetch.ts'
import type { ModelDef, ProviderDef } from './types.ts'

const BASE_URL = 'http://localhost:11434'

/** Ollama is local: a stalled daemon must not stall the settings screen. */
export const TAGS_TIMEOUT_MS = 2000

interface TagsResponse {
  models?: Array<{ name?: string; model?: string } | undefined>
}

/**
 * The installed models, straight from the local daemon — models.dev could not know what
 * this machine has pulled. Returns an empty list, never an error, when Ollama is not
 * running: "no local models" is a normal state.
 */
const listInstalled = async (ports: Ports): Promise<ModelDef[]> => {
  let body: TagsResponse
  // Deliberately not AbortSignal.timeout(): see the warning on platform/http.ts's
  // tauriFetch. Clearing the timer on the way out is what keeps a late abort from
  // cancelling resources the plugin has already released.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TAGS_TIMEOUT_MS)
  try {
    const res = await ports.fetch(`${BASE_URL}/api/tags`, { signal: controller.signal })
    if (!res.ok) return []
    body = (await res.json()) as TagsResponse
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }

  const names = new Set<string>()
  for (const entry of body.models ?? []) {
    const name = entry?.model ?? entry?.name
    if (name) names.add(name)
  }
  const sorted = [...names].sort((a, b) => a.localeCompare(b))
  // Whatever sorts first is the default: there is no meaningful ranking of someone's
  // local models, and the list is stable across calls.
  return sorted.map((id, i) => (i === 0 ? { id, label: id, default: true } : { id, label: id }))
}

export const ollamaProvider: ProviderDef = {
  id: 'ollama',
  label: 'Ollama',
  auth: { kind: 'none' },
  quirks: { baseURL: BASE_URL },
  models: listInstalled,
  createModel: (_cred, modelId, ports) =>
    createOllama({ baseURL: BASE_URL, fetch: sdkFetch(ports.fetch) })(modelId),
  providerOptions: (prefs) => ({ ollama: { think: prefs.thinking } }),
}
