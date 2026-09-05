import { confirm } from '@tauri-apps/plugin-dialog'

/*
 * How many native sheets are up. A counter, not a boolean, so two overlapping asks cannot
 * have the first one to close clear the guard for the second.
 *
 * The sheet takes focus from the window it is attached to, and the panel dismisses itself
 * on blur (use-panel-window.ts) — which tore the sheet down with its parent the instant it
 * appeared. The blur handler reads this to tell a click-away from a dialog of our own.
 */
let openSheets = 0

/**
 * True while a native sheet is up, plus a short tail after it closes.
 *
 * The tail is there because window focus events arrive over IPC, so a blur emitted
 * while the sheet was up can be delivered after the answer has already come back. Long
 * enough to cover that hop, short enough that a real click-away right after answering
 * still dismisses.
 */
export const isDialogOpen = (): boolean => openSheets > 0

const GUARD_TAIL_MS = 300

/**
 * A native confirmation sheet. Resolves false if it cannot be shown at all: a destructive
 * action must not proceed just because we failed to ask.
 */
export const confirmDestructive = async (options: {
  title: string
  message: string
  okLabel: string
}): Promise<boolean> => {
  openSheets += 1
  try {
    return await confirm(options.message, {
      title: options.title,
      kind: 'warning',
      okLabel: options.okLabel,
      cancelLabel: 'Cancel',
    })
  } catch {
    return false
  } finally {
    setTimeout(() => {
      openSheets -= 1
    }, GUARD_TAIL_MS)
  }
}
