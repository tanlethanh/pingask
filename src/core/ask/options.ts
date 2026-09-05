// Turning the user's preferences into a vendor's `providerOptions`.
//
// Two things live here so neither is duplicated per provider: the capability gate
// (does this model actually reason?) and the lookup that finds the provider.

import { PROVIDERS } from '../providers/registry.ts'
import type { ModelMap, ModelPrefs, ModelRef, ProviderOptions } from '../providers/types.ts'
import { parseModelRef } from '../providers/types.ts'

/**
 * Whether the model advertises reasoning, per models.dev.
 *
 * Unknown means no: a model missing from the catalog gets the safe, fast path
 * rather than an option the API may reject.
 */
export const modelSupportsThinking = (models: ModelMap, ref: ModelRef): boolean => {
  const { provider, model } = parseModelRef(ref)
  return models[provider]?.some((entry) => entry.id === model && entry.reasoning === true) === true
}

/**
 * The `providerOptions` for a call, or undefined when the provider wants none.
 *
 * Preferences are clamped against the model's real capability first, so asking for
 * thinking on a model that cannot do it is silently the same as not asking — the
 * toggle can be left on while switching models without breaking the next request.
 */
export const buildProviderOptions = (
  ref: ModelRef,
  prefs: ModelPrefs,
  models: ModelMap,
): ProviderOptions | undefined => {
  const { provider, model } = parseModelRef(ref)
  const def = PROVIDERS[provider]
  if (!def) return undefined
  const effective: ModelPrefs = {
    thinking: prefs.thinking && modelSupportsThinking(models, ref),
  }
  return def.providerOptions?.(effective, model)
}
