import { createOpenAI } from '@ai-sdk/openai'
import type { Ports } from '../ports.ts'
import { listCatalogModels } from './catalog.ts'
import { sdkFetch } from './sdk-fetch.ts'
import type { ModelDef, ProviderDef } from './types.ts'

const DEFAULT_MODEL = 'gpt-5.6'

/** Only reached when models.dev is unreachable and nothing is cached. */
const FALLBACK: ModelDef[] = [
  { id: 'gpt-5.6', label: 'GPT-5.6' },
  { id: 'gpt-5.5', label: 'GPT-5.5' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini' },
]

/**
 * The lowest effort a model actually accepts, for the thinking-off path.
 *
 * 'none' arrived with GPT-5.1. The original gpt-5 line — gpt-5, gpt-5-mini,
 * gpt-5-nano — answers 400 ("'none' is not supported with the 'gpt-5-mini' model")
 * and floors at 'minimal'; the o-series has neither and floors at 'low'.
 */
const offEffort = (modelId: string): 'none' | 'minimal' | 'low' => {
  if (/^o\d/.test(modelId)) return 'low'
  if (/^gpt-5(-|$)/.test(modelId)) return 'minimal'
  return 'none'
}

export const openaiProvider: ProviderDef = {
  id: 'openai',
  label: 'OpenAI',
  auth: {
    kind: 'apiKey',
    help: 'Create a key at platform.openai.com → API keys.',
    placeholder: 'sk-proj-...',
    envVar: 'OPENAI_API_KEY',
  },
  models: (ports: Ports) =>
    listCatalogModels(
      { catalogId: 'openai', defaultModel: DEFAULT_MODEL, fallback: FALLBACK },
      ports,
    ),
  createModel: (cred, modelId, ports) => {
    if (cred.type !== 'api') throw new Error('OpenAI needs an API key.')
    // `createOpenAI(...)(id)` is the Responses API in @ai-sdk/openai@4.
    return createOpenAI({ apiKey: cred.key, fetch: sdkFetch(ports.fetch) })(modelId)
  },
  // Always sent, both ways. Reasoning models default to a middling effort, which
  // costs seconds on every quick lookup — the floor below is what makes the off
  // state fast rather than merely un-configured.
  providerOptions: (prefs, modelId) => ({
    openai: { reasoningEffort: prefs.thinking ? 'low' : offEffort(modelId) },
  }),
}
