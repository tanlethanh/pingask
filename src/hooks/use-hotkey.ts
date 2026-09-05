import { useEffect, useRef } from 'react'
import { shortcut } from '../platform/index.ts'

/**
 * Binds the global hotkey, rebinding whenever the accelerator changes.
 *
 * The handler is held in a ref so a re-render never forces an unregister/register
 * cycle — re-binding mid-session is what makes the OS drop the shortcut.
 */
export const useHotkey = (accelerator: string, enabled: boolean, handler: () => void): void => {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void shortcut
      .rebind(accelerator, () => handlerRef.current())
      .catch((error: unknown) => {
        if (!cancelled) console.error('Failed to bind hotkey', accelerator, error)
      })
    return () => {
      cancelled = true
      // Releasing here is what makes `enabled` a real switch: while the user records a
      // new chord the OS must not hold the old one, or the keypress never reaches the
      // webview.
      void shortcut.unregisterAll().catch(() => {})
    }
  }, [accelerator, enabled])
}
