import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Ports } from '../core/ports.ts'
import { DEFAULT_SETTINGS, type Settings } from '../core/settings/schema.ts'
import { createSettingsStore } from '../core/settings/store.ts'

export interface UseSettings {
  settings: Settings
  /** False until settings.json has been read, so the hotkey is not bound to a default. */
  loaded: boolean
  save: (patch: Partial<Settings>) => Promise<void>
}

export const useSettings = (ports: Ports): UseSettings => {
  const store = useMemo(() => createSettingsStore(ports.settingsStore), [ports])
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    void store.load().then((loadedSettings) => {
      if (!alive) return
      setSettings(loadedSettings)
      setLoaded(true)
    })
    return () => {
      alive = false
    }
  }, [store])

  const save = useCallback(
    async (patch: Partial<Settings>) => {
      setSettings(await store.save(patch))
    },
    [store],
  )

  return { settings, loaded, save }
}
