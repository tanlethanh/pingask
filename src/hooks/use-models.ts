import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildModelOptions, selectModel } from '../core/ask/select.ts'
import type { Ports } from '../core/ports.ts'
import { listProviders } from '../core/providers/registry.ts'
import type { CredentialMap, ModelMap, ModelOption, ModelRef } from '../core/providers/types.ts'

export interface UseModels {
  /** Per-provider catalogs, filled in as models.dev responds. */
  models: ModelMap
  /** Flattened and labelled for the settings picker. */
  options: ModelOption[]
  /** The model the next question goes to, honouring the stored preference. */
  active?: ModelRef
  activeLabel?: string
  /**
   * Every provider's catalog has been probed at least once. Stays true across a refresh —
   * anything keyed on this would otherwise flicker each time the window opened.
   */
  loaded: boolean
  /**
   * Re-probe every provider's catalog. Ollama's list is a live call to the local daemon,
   * so a model pulled after launch is invisible until something asks again.
   */
  refresh: () => void
}

/**
 * Loads every provider's catalog once. A provider whose catalog fails resolves to an
 * empty list rather than rejecting — a models.dev outage must not take inference down.
 */
export const useModels = (
  ports: Ports,
  credentials: CredentialMap,
  preferred?: ModelRef,
): UseModels => {
  const [models, setModels] = useState<ModelMap>({})
  const [loaded, setLoaded] = useState(false)
  // Identifies the newest load: two probes can be in flight, and the slower must not
  // overwrite the newer result.
  const runId = useRef(0)

  const load = useCallback(async () => {
    const id = ++runId.current
    const entries = await Promise.all(
      listProviders().map(
        async (provider) => [provider.id, await provider.models(ports).catch(() => [])] as const,
      ),
    )
    if (runId.current !== id) return
    setModels(Object.fromEntries(entries))
    setLoaded(true)
  }, [ports])

  useEffect(() => {
    void load()
  }, [load])

  return useMemo(() => {
    const providers = listProviders()
    const options = buildModelOptions(providers, credentials, models)
    const active = selectModel({ preferred, providers, credentials, models })
    return {
      models,
      options,
      active,
      activeLabel: options.find((option) => option.ref === active)?.label,
      loaded,
      refresh: () => void load(),
    }
  }, [models, credentials, preferred, load, loaded])
}
