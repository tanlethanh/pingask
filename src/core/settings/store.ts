import type { KeyValueStore } from '../ports.ts'
import type { ModelRef } from '../providers/types.ts'
import { DEFAULT_SETTINGS, type Settings } from './schema.ts'

const SETTINGS_KEY = 'settings'

export interface SettingsStore {
  /** Never rejects: an unreadable settings.json yields DEFAULT_SETTINGS. */
  load(): Promise<Settings>
  /** Merges over what is stored and returns the result. */
  save(patch: Partial<Settings>): Promise<Settings>
}

const positiveInt = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined

/** "provider:model". The provider is not checked here — settings outlive the registry. */
const isModelRef = (value: unknown): value is ModelRef => {
  if (typeof value !== 'string') return false
  const separator = value.indexOf(':')
  return separator > 0 && separator < value.length - 1
}

/**
 * The one place a raw object becomes Settings. Every required field falls back to its
 * default, so a truncated file, an old schema and a partial patch come out the same shape.
 */
const normalize = (value: unknown): Settings => {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const settings: Settings = {
    keybinding:
      typeof raw.keybinding === 'string' && raw.keybinding.trim().length > 0
        ? raw.keybinding
        : DEFAULT_SETTINGS.keybinding,
    firstAnswerWords: positiveInt(raw.firstAnswerWords) ?? DEFAULT_SETTINGS.firstAnswerWords,
    followUpWords: positiveInt(raw.followUpWords) ?? DEFAULT_SETTINGS.followUpWords,
    // Anything that is not literally true stays off.
    thinking: raw.thinking === true,
  }
  if (isModelRef(raw.model)) settings.model = raw.model
  if (typeof raw.systemPrompt === 'string' && raw.systemPrompt.trim().length > 0) {
    settings.systemPrompt = raw.systemPrompt
  }
  return settings
}

export const createSettingsStore = (store: KeyValueStore): SettingsStore => {
  const read = async (): Promise<Settings> => {
    try {
      return normalize(await store.get<unknown>(SETTINGS_KEY))
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  return {
    load: read,

    async save(patch) {
      // Spreading an explicit `undefined` clears the optional field; a key the
      // caller left out keeps its stored value.
      const next = normalize({ ...(await read()), ...patch })
      await store.set(SETTINGS_KEY, next)
      return next
    },
  }
}
