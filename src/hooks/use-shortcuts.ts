import { useEffect, useRef } from 'react'

export interface Shortcut {
  /** Matched against event.key — the character, so the chord matches the keycap. */
  key: string
  meta?: boolean
  shift?: boolean
  /** False leaves the key alone: it falls through to the field, or to nothing. */
  when?: boolean
  run: () => void
}

/**
 * Document-level keys for whoever is on screen.
 *
 * Bound on the document rather than on the query field, because the settings page
 * replaces that field entirely and Escape has to keep working there. Each page calls this
 * with its own list; the shell's bindings and the current page's share one document, and
 * the first to claim an event wins.
 */
export const useShortcuts = (shortcuts: readonly Shortcut[]): void => {
  // Through a ref so the listener binds once: these close over state that changes on
  // every keystroke.
  const latest = useRef(shortcuts)
  latest.current = shortcuts

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      for (const shortcut of latest.current) {
        if (shortcut.when === false) continue
        if (event.key !== shortcut.key) continue
        if ((shortcut.meta ?? false) !== event.metaKey) continue
        if ((shortcut.shift ?? false) !== event.shiftKey) continue
        event.preventDefault()
        shortcut.run()
        return
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
}
