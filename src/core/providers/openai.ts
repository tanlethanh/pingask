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
  // costs seconds on every quick lookup — 'none' is what makes the off state fast
  // rather than merely un-configured.
  providerOptions: (prefs) => ({
    openai: { reasoningEffort: prefs.thinking ? 'low' : 'none' },
  }),
}
