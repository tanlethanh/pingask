import type { ModelRef } from '../providers/types.ts'

export interface Settings {
  keybinding: string
  /** Undefined until the user picks; resolved against configured providers at call time. */
  model?: ModelRef
  /** Overrides the built-in terse prompt when set. */
  systemPrompt?: string
  /** Word budget hints handed to the model. */
  firstAnswerWords: number
  followUpWords: number
  /** See ModelPrefs.thinking. Ignored for models that cannot reason. */
  thinking: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  keybinding: 'Control+P',
  firstAnswerWords: 100,
  followUpWords: 250,
  thinking: false,
}
