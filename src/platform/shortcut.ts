// The global hotkey. One accelerator at a time — the app has exactly one.
//
// `global-shortcut:default` grants nothing (the plugin ships `permissions = []`), so
// capabilities/default.json lists allow-register and allow-unregister-all explicitly —
// the two commands used below. Without them every call here is denied at runtime.

import {
  register as pluginRegister,
  unregisterAll as pluginUnregisterAll,
} from '@tauri-apps/plugin-global-shortcut'

/** Called once per keypress. Not given the event — there is only ever one shortcut. */
export type Handler = () => void

/** What we believe is currently bound, so a failed rebind can put it back. */
let current: { accelerator: string; handler: Handler } | undefined

const conflict = (accelerator: string) =>
  `Could not register "${accelerator}" as the global shortcut. ` +
  'Another application already owns that combination (or macOS reserves it). ' +
  'Pick a different one in Settings.'

/**
 * Bind `accelerator` (Tauri syntax, e.g. `Alt+P`) to `handler`.
 *
 * Rejects with a readable Error when the combination is taken; the plugin's own
 * message is kept as `cause`.
 */
export const register = async (accelerator: string, handler: Handler): Promise<void> => {
  try {
    await pluginRegister(accelerator, (event) => {
      // The plugin fires on both edges. Only act on the press, or the window
      // toggles twice per keystroke and appears not to open at all.
      if (event.state === 'Pressed') handler()
    })
  } catch (cause) {
    throw new Error(conflict(accelerator), { cause })
  }
  current = { accelerator, handler }
}

/** Drop every shortcut this process holds. Safe to call when nothing is bound. */
export const unregisterAll = async (): Promise<void> => {
  await pluginUnregisterAll()
  current = undefined
}

/**
 * Move the hotkey to `accelerator`. Unregisters first — the OS will not let the same
 * process hold a combination twice, and the user may be swapping back to one we own.
 *
 * If the new accelerator is unavailable the previous binding is restored before the
 * error propagates: leaving the user with no way to summon the app is worse than a
 * rejected settings change.
 */
export const rebind = async (accelerator: string, handler: Handler): Promise<void> => {
  const previous = current
  await unregisterAll()
  try {
    await register(accelerator, handler)
  } catch (error) {
    if (previous) {
      await register(previous.accelerator, previous.handler).catch(() => undefined)
    }
    throw error
  }
}
