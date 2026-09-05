import { useCallback, useState } from 'react'

export type Page = 'launcher' | 'thread' | 'settings'

export interface Navigation {
  page: Page
  /** Go somewhere new, keeping where you were. */
  push: (page: Page) => void
  /** Back one layer. A no-op at the root, so Esc there is free to mean something else. */
  back: () => void
  /** All the way back to the launcher, in one step. */
  reset: () => void
}

/**
 * Where the panel is, as a stack rather than a single value: settings is a layer over the
 * page you were on, so leaving it has to land where you came from.
 */
export const useNavigation = (): Navigation => {
  const [stack, setStack] = useState<Page[]>(['launcher'])

  return {
    page: stack[stack.length - 1] ?? 'launcher',
    push: useCallback((page: Page) => setStack((current) => [...current, page]), []),
    back: useCallback(
      () => setStack((current) => (current.length > 1 ? current.slice(0, -1) : current)),
      [],
    ),
    reset: useCallback(() => setStack(['launcher']), []),
  }
}
