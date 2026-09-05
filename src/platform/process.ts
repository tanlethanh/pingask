// Ending the process. Its own file rather than a line in window.ts: hiding the window and
// quitting the app look alike from the UI and are not the same thing at all.

import { exit } from '@tauri-apps/plugin-process'

/** Quit for good — not `window.hide()`. Callers must confirm first; this asks nothing. */
export const quit = async (): Promise<void> => {
  await exit(0)
}
