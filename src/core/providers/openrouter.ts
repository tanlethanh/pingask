import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { Ports } from '../ports.ts'
import { listCatalogModels } from './catalog.ts'
import { sdkFetch } from './sdk-fetch.ts'
import type { ModelDef, ProviderDef } from './types.ts'

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.6'

/** Only reached when models.dev is unreachable and nothing is cached. */
const FALLBACK: ModelDef[] = [
  { id: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
  { id: 'openai/gpt-5.5', label: 'GPT-5.5' },
  { id: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
]

export const openrouterProvider: ProviderDef = {
  id: 'openrouter',
  label: 'OpenRouter',
  auth: {
    kind: 'apiKey',
    help: 'Create a key at openrouter.ai → Keys.',
    placeholder: 'sk-or-v1-...',
    envVar: 'OPENROUTER_API_KEY',
  },
  models: (ports: Ports) =>
    listCatalogModels(
      { catalogId: 'openrouter', defaultModel: DEFAULT_MODEL, fallback: FALLBACK },
      ports,
    ),
  createModel: (cred, modelId, ports) => {
    if (cred.type !== 'api') throw new Error('OpenRouter needs an API key.')
    return createOpenRouter({
      apiKey: cred.key,
      fetch: sdkFetch(ports.fetch),
      // 'compatible' is the factory default and drops newer request fields;
      // we talk to OpenRouter itself, so ask for the full protocol.
      compatibility: 'strict',
      appName: 'PingAsk',
    }).chat(modelId)
  },
  // Only sent when on: OpenRouter proxies whatever the upstream model does by
  // default, and its `reasoning` object requires one of effort/max_tokens, so
  // there is no honest way to spell "leave it alone" other than omitting it.
  providerOptions: (prefs) =>
    prefs.thinking ? { openrouter: { reasoning: { enabled: true, effort: 'low' } } } : undefined,
}
