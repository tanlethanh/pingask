import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Ports } from '../core/ports.ts'
import type { Thread } from '../core/threads/model.ts'
import type { Removed } from '../core/threads/repository.ts'
import { createThreadRepository } from '../core/threads/repository.ts'

export interface UseThreads {
  /** Newest threads, for the empty-input state. */
  recent: Thread[]
  /** Threads matching what is typed, for the suggestion list. */
  suggestions: Thread[]
  /**
   * The query is a search rather than nothing typed yet — so `suggestions` is the list to
   * show, empty or not, and Enter asks. Reported by the hook that already applies the rule.
   */
  searching: boolean
  persist: (thread: Thread) => Promise<void>
  /** Resolves with what was removed, so the caller can offer an undo. */
  remove: (thread: Thread) => Promise<Removed | undefined>
  restore: (removed: Removed) => Promise<void>
}

/** How far back "recent" reaches. The list scrolls; the window caps what is visible. */
const RECENT_LIMIT = 25

export const useThreads = (ports: Ports, query: string): UseThreads => {
  const repo = useMemo(() => createThreadRepository(ports.threadStore), [ports])
  const [recent, setRecent] = useState<Thread[]>([])
  const [suggestions, setSuggestions] = useState<Thread[]>([])

  const reload = useCallback(async () => {
    setRecent((await repo.list()).slice(0, RECENT_LIMIT))
  }, [repo])

  useEffect(() => {
    void reload()
  }, [reload])

  // Search on every keystroke. The repository caches, so this stays in memory.
  useEffect(() => {
    let alive = true
    const trimmed = query.trim()
    if (!trimmed) {
      setSuggestions([])
      return
    }
    void repo.search(trimmed).then((found) => {
      if (alive) setSuggestions(found)
    })
    return () => {
      alive = false
    }
  }, [repo, query])

  const persist = useCallback(
    async (thread: Thread) => {
      await repo.save(thread)
      await reload()
    },
    [repo, reload],
  )

  const remove = useCallback(
    async (thread: Thread) => {
      const removed = await repo.remove(thread.id)
      await reload()
      setSuggestions((current) => current.filter((item) => item.id !== thread.id))
      return removed
    },
    [repo, reload],
  )

  const restore = useCallback(
    async (removed: Removed) => {
      await repo.restore(removed)
      await reload()
    },
    [repo, reload],
  )

  return { recent, suggestions, searching: query.trim().length > 0, persist, remove, restore }
}
