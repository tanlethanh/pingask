import { createAnthropic } from '@ai-sdk/anthropic'
import type { Ports } from '../ports.ts'
import { listCatalogModels } from './catalog.ts'
import { sdkFetch } from './sdk-fetch.ts'
import type { ModelDef, ModelPrefs, ProviderDef, ProviderOptions, Quirks } from './types.ts'

/** Shared with claude.ts: same models, same knobs, different credential. */
export const DEFAULT_MODEL = 'claude-sonnet-4-6'

/** Only reached when models.dev is unreachable and nothing is cached. */
export const FALLBACK: ModelDef[] = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
]

/**
 * Anthropic's documented minimum is 1024; this is deliberately close to it. The answers
 * here are a hundred words, so a large budget buys latency, not quality.
 */
const THINKING_BUDGET_TOKENS = 2048

export const thinkingOptions = (prefs: ModelPrefs): ProviderOptions | undefined =>
  prefs.thinking
    ? { anthropic: { thinking: { type: 'enabled', budgetTokens: THINKING_BUDGET_TOKENS } } }
    : undefined

/**
 * Anthropic makes `max_tokens` mandatory, so leaving it out does not mean "no ceiling"
 * — it means the SDK sends the model's absolute ceiling, 128k on Sonnet. That is two
 * orders of magnitude past anything this app asks for, and above what Anthropic serves
 * without the 128k-output beta header, so the request can be rejected outright for a
 * budget nothing was ever going to spend. Must exceed THINKING_BUDGET_TOKENS.
 */
export const MAX_OUTPUT_TOKENS = 8192

const QUIRKS: Quirks = { maxOutputTokens: MAX_OUTPUT_TOKENS }

export const anthropicProvider: ProviderDef = {
  id: 'anthropic',
  label: 'Anthropic',
  quirks: QUIRKS,
  auth: {
    kind: 'apiKey',
    help: 'Create a key at console.anthropic.com → Settings → API keys.',
    placeholder: 'sk-ant-...',
    envVar: 'ANTHROPIC_API_KEY',
  },
  models: (ports: Ports) =>
    listCatalogModels(
      { catalogId: 'anthropic', defaultModel: DEFAULT_MODEL, fallback: FALLBACK },
      ports,
    ),
  createModel: (cred, modelId, ports) => {
    if (cred.type !== 'api') throw new Error('Anthropic needs an API key.')
    return createAnthropic({ apiKey: cred.key, fetch: sdkFetch(ports.fetch) })(modelId)
  },
  providerOptions: thinkingOptions,
}
