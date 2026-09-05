// Which model answers the next question. Kept out of the hooks so it can be tested
// without React. The rule it encodes: a stored preference is honoured only while it
// still works.

import type {
  Credential,
  CredentialMap,
  ModelDef,
  ModelMap,
  ModelOption,
  ModelRef,
  ProviderDef,
} from '../providers/types.ts'
import { formatModelRef, parseModelRef } from '../providers/types.ts'

/** Ollama needs no credential; everything else needs one that is not `none`. */
export const isUsable = (provider: ProviderDef, cred: Credential | undefined): boolean =>
  provider.auth.kind === 'none' ? true : cred !== undefined && cred.type !== 'none'

export const usableProviders = (
  providers: readonly ProviderDef[],
  credentials: CredentialMap,
): ProviderDef[] => providers.filter((provider) => isUsable(provider, credentials[provider.id]))

const defaultModelOf = (models: readonly ModelDef[] | undefined): ModelDef | undefined =>
  models?.find((model) => model.default) ?? models?.[0]

/**
 * Resolve the model to use.
 *
 * A stored preference wins, but only while its provider is still usable — otherwise a
 * revoked key or a signed-out subscription would wedge the app on a model it can never
 * call. The fallback is the first usable provider's default model, in registry order.
 */
export const selectModel = (input: {
  preferred?: ModelRef
  providers: readonly ProviderDef[]
  credentials: CredentialMap
  models: ModelMap
}): ModelRef | undefined => {
  const usable = usableProviders(input.providers, input.credentials)
  if (usable.length === 0) return undefined

  if (input.preferred) {
    const { provider } = parseModelRef(input.preferred)
    if (usable.some((candidate) => candidate.id === provider)) return input.preferred
  }

  for (const provider of usable) {
    const model = defaultModelOf(input.models[provider.id])
    if (model) return formatModelRef(provider.id, model.id)
  }
  return undefined
}

/**
 * The model picker's contents. Only providers the user can actually send a question to
 * appear — offering a model behind a missing key is offering a choice that fails at ask
 * time. Ollama shows up exactly when it is running with models pulled, because its
 * catalog comes back empty otherwise.
 */
export const buildModelOptions = (
  providers: readonly ProviderDef[],
  credentials: CredentialMap,
  models: ModelMap,
): ModelOption[] =>
  usableProviders(providers, credentials).flatMap((provider) =>
    (models[provider.id] ?? []).map((model) => ({
      ref: formatModelRef(provider.id, model.id),
      label: model.label,
      providerLabel: provider.label,
    })),
  )
