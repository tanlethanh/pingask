import { useCallback, useEffect, useRef } from 'react'
import type { Ports } from '../core/ports.ts'
import { appWindow, isDialogOpen } from '../platform/index.ts'
import { useHotkey } from './use-hotkey.ts'

export interface UsePanelWindowOptions {
  ports: Ports
  /** The chord from settings, and whether it is safe to claim right now. */
  keybinding: string
  hotkeyEnabled: boolean
  /**
   * Work in progress that a dismissal would destroy: a streaming answer, an OAuth round
   * trip through the browser. Read at the moment of the blur, never at subscribe time.
   */
  busy: boolean
  /** Reset the panel to its opening state. Runs on every show and every hide. */
  freshen: () => void
  /** The window is up and focused: put the caret somewhere, refresh what went stale. */
  onShown?: () => void
}

export interface PanelWindow {
  /** Hide the window and reset the panel. Bound to Esc by the caller. */
  dismiss: () => Promise<void>
}

/**
 * Everything the panel does *as an OS window*: the global hotkey, dismissal on
 * click-away, where it sits on screen, and links that must leave the webview.
 *
 * None of it belongs to a page — there is one window and three pages, and a page owning
 * any of this would fight the other two over the same window on every navigation.
 */
export const usePanelWindow = ({
  ports,
  keybinding,
  hotkeyEnabled,
  busy,
  freshen,
  onShown,
}: UsePanelWindowOptions): PanelWindow => {
  const dismiss = useCallback(async () => {
    await appWindow.hide()
    freshen()
  }, [freshen])

  const shown = useRef(onShown)
  shown.current = onShown

  useHotkey(
    keybinding,
    hotkeyEnabled,
    useCallback(async () => {
      if (await appWindow.isVisible()) {
        await appWindow.hide()
        freshen()
        return
      }
      freshen()
      // Re-anchor on every open: the user may have switched monitors, or changed
      // resolution, since the last time the panel was up.
      await appWindow.anchorTop()
      await appWindow.show()
      await appWindow.focus()
      // After the window has the OS focus, not before: a DOM element focused while the
      // window is still hidden does not keep the caret once it comes up.
      shown.current?.()
    }, [freshen]),
  )

  /*
   * Click away and the panel goes. Three exceptions, all cases where hiding would destroy
   * work in progress: an answer still streaming (freshen() resets the thread, which aborts
   * it), an OAuth connect waiting on the browser — which takes focus itself — and a native
   * confirmation sheet, which is attached to this window and would go down with it.
   */
  const busyRef = useRef(busy)
  busyRef.current = busy

  useEffect(() => {
    let unlisten: (() => void) | undefined
    let cancelled = false
    void appWindow
      .onBlur(() => {
        if (!busyRef.current && !isDialogOpen()) void dismiss()
      })
      .then((off) => {
        if (cancelled) off()
        else unlisten = off
      })
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [dismiss])

  // Anchor at startup as well as on every hotkey open: the window can be shown without
  // going through the hotkey — first launch, or a dev build with `visible: true` — and
  // Tauri's own `center: true` would leave it mid-screen.
  useEffect(() => {
    void appWindow.anchorTop()
  }, [])

  // Links inside an answer must leave through the OS browser; without this a click
  // navigates the webview away from the app, which it cannot come back from. message.tsx
  // marks the ones it has already checked for a safe scheme.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const link = target.closest('a[data-external]')
      const href = link?.getAttribute('href')
      if (!href) return
      event.preventDefault()
      void ports.browser.open(href)
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [ports])

  return { dismiss }
}
