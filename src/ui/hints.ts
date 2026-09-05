import type { KeyHint } from './footer.tsx'

const SETTINGS: KeyHint = { keys: ['⌘', '.'], label: 'settings' }

export interface HintState {
  streaming: boolean
  hasTranscript: boolean
  /** Something is typed, so Enter asks rather than doing nothing. */
  typing?: boolean
  /** A history row is highlighted, which is what makes ⌘⌫ mean anything. */
  rowSelected?: boolean
  canUndo?: boolean
}

/**
 * The keycaps for the current state.
 *
 * A plain function rather than a hook: it reads no state and holds none, and being
 * callable from a test without a renderer is worth more than the memoisation.
 */
export const keyHints = ({
  streaming,
  hasTranscript,
  typing = false,
  rowSelected = false,
  canUndo = false,
}: HintState): KeyHint[] => {
  if (streaming) return [{ keys: ['esc'], label: 'stop' }, SETTINGS]
  // Esc means something different in each state, so the hint has to say which.
  if (hasTranscript)
    return [
      { keys: ['esc'], label: 'back' },
      { keys: ['⏎'], label: 'follow up' },
    ]

  // The list is on screen in both remaining states, so its keys are added rather than
  // branched. Contextual hints are *appended*: inserting them ahead of the standing ones
  // would shove the whole rail sideways every time the highlight moves onto or off a row.
  const shown: KeyHint[] = []
  if (typing) shown.push({ keys: ['⏎'], label: 'ask' })
  shown.push({ keys: ['esc'], label: 'close' })
  if (!typing) shown.push(SETTINGS)
  if (rowSelected) shown.push({ keys: ['⌘', '⌫'], label: 'delete' })
  if (canUndo) shown.push({ keys: ['⌘', 'Z'], label: 'undo' })
  return shown
}
