// The main window. One window, no decorations, transparent, always on top — see the
// `app.windows[0]` block in src-tauri/tauri.conf.json.
//
// Dragging is not here: `data-tauri-drag-region` on the header does it from markup, which
// is why capabilities/default.json still grants core:window:allow-start-dragging.

import { LogicalSize, PhysicalPosition } from '@tauri-apps/api/dpi'
import {
  currentMonitor,
  cursorPosition,
  getCurrentWindow,
  monitorFromPoint,
} from '@tauri-apps/api/window'

// Mirror the `app.windows[0]` block in tauri.conf.json. The window is
// `resizable: false`, so these never change at runtime.
const WINDOW_WIDTH = 620
const MIN_HEIGHT = 92
/** Past this the transcript scrolls internally instead of growing the window. */
const MAX_HEIGHT = 640

// Resolved per call rather than at import time: getCurrentWindow() reads
// __TAURI_INTERNALS__, which does not exist outside the webview.
const win = () => getCurrentWindow()

export const show = async (): Promise<void> => {
  await win().show()
}

export const hide = async (): Promise<void> => {
  await win().hide()
}

export const isVisible = (): Promise<boolean> => win().isVisible()

export const focus = async (): Promise<void> => {
  await win().setFocus()
}

/**
 * Hotkey behaviour: hide if we are up, otherwise show and take keyboard focus.
 * Resolves with the new visibility.
 */
export const toggle = async (): Promise<boolean> => {
  const w = win()
  if (await w.isVisible()) {
    await w.hide()
    return false
  }
  await w.show()
  await w.setFocus()
  return true
}

/**
 * Grow or shrink the window to fit `px` of content, clamped to MIN_HEIGHT..MAX_HEIGHT
 * and keeping the width fixed. Resolves with the height actually applied, so the caller
 * can tell it hit the cap and should start scrolling the transcript instead.
 *
 * The window is undecorated, so inner size is content size — no chrome to subtract.
 */
export const setContentHeight = async (px: number): Promise<number> => {
  const height = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, px)))
  await win().setSize(new LogicalSize(WINDOW_WIDTH, height))
  return height
}

/**
 * How far down the screen the panel's TOP edge sits. The panel grows downward as answers
 * arrive, so anchoring the top keeps the query field still; a vertically centred window
 * would slide it out from under the user's eyes on every turn.
 */
const TOP_FRACTION = 0.2

/**
 * The monitor the user is actually working on.
 *
 * `currentMonitor()` reports where the *window* is, which is where it was last shown — so
 * on a second display the panel would keep appearing back on the first. The pointer is the
 * best available proxy for attention, and it is what Spotlight and Raycast follow.
 */
const activeMonitor = async () => {
  try {
    const cursor = await cursorPosition()
    const found = await monitorFromPoint(cursor.x, cursor.y)
    if (found) return found
  } catch {
    // Fall through: a missing cursor is not a reason to refuse to place the window.
  }
  return currentMonitor()
}

/**
 * Horizontally centred on the active monitor, top edge high — where a macOS search panel
 * belongs. Uses `workArea`, so the menu bar and Dock are excluded.
 */
export const anchorTop = async (): Promise<void> => {
  const monitor = await activeMonitor()
  if (!monitor) return

  // `workArea` excludes the menu bar and Dock, which is what we want — but it is a
  // newer addition to the Monitor payload, so fall back to the full monitor bounds
  // rather than destructuring undefined and computing NaN.
  const area = monitor.workArea ?? { position: monitor.position, size: monitor.size }
  const outer = await win().outerSize()
  const maxPhysical = MAX_HEIGHT * monitor.scaleFactor

  const x = area.position.x + Math.round((area.size.width - outer.width) / 2)
  // Reserve room for the panel at full height: the top edge is fixed once shown,
  // so a grown transcript must not run off the bottom of the screen.
  const lowest = area.position.y + Math.max(0, area.size.height - maxPhysical)
  const y = Math.round(Math.min(area.position.y + area.size.height * TOP_FRACTION, lowest))

  // Never move blind. A NaN here puts the window somewhere unreachable, with no
  // decorations to drag it back by.
  if (!Number.isFinite(x) || !Number.isFinite(y)) return

  await win().setPosition(new PhysicalPosition(x, Math.max(area.position.y, y)))
}

/**
 * Run `handler` when the window loses focus, i.e. the user clicked away.
 *
 * Resolves with an unsubscribe function.
 */
export const onBlur = async (handler: () => void): Promise<() => void> => {
  const unlisten = await win().onFocusChanged(({ payload: focused }) => {
    if (!focused) handler()
  })
  return unlisten
}
