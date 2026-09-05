// The provider table. Adding a provider is one new file plus one line here —
// nothing else in the app knows a provider by name (PLAN.md rule 4).

import type { LanguageModel } from 'ai'
import type { Ports } from '../ports.ts'
import { anthropicProvider } from './anthropic.ts'
import { chatgptProvider } from './chatgpt.ts'
import { claudeProvider } from './claude.ts'
import { ollamaProvider } from './ollama.ts'
import { openaiProvider } from './openai.ts'
import { openrouterProvider } from './openrouter.ts'
import type { Credential, ModelRef, ProviderDef, ProviderId } from './types.ts'
import { parseModelRef } from './types.ts'

/*
 * Key order is display order, everywhere the app lists providers — the settings card
 * and the model picker's groups both read it from here.
 *
 * Paired by vendor, key before sign-in: OpenAI then ChatGPT, Anthropic then Claude. The
 * two ways into the same models sit together, and the one that works with a key you
 * paste comes first. Aggregator and local last.
 */
export const PROVIDERS: Record<ProviderId, ProviderDef> = {
  openai: openaiProvider,
  chatgpt: chatgptProvider,
  anthropic: anthropicProvider,
  claude: claudeProvider,
  openrouter: openrouterProvider,
  ollama: ollamaProvider,
}

export const getProvider = (id: ProviderId): ProviderDef => {
  const provider = PROVIDERS[id]
  if (!provider) throw new Error(`Unknown provider: ${id}`)
  return provider
}

/** Settings-screen order. Object key order is the display order. */
export const listProviders = (): ProviderDef[] => Object.values(PROVIDERS)

/** Turns a stored "provider:model" plus its credential into an ai-SDK model. */
export const resolveModel = (ref: ModelRef, cred: Credential, ports: Ports): LanguageModel => {
  const { provider, model } = parseModelRef(ref)
  if (!model) throw new Error(`Model ref is missing a model id: ${ref}`)
  return getProvider(provider).createModel(cred, model, ports)
}
