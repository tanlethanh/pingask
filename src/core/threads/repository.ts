import type { KeyValueStore } from '../ports.ts'
import { MAX_THREADS, type Thread } from './model.ts'

/** Every thread lives in one array under this key, newest first. */
const THREADS_KEY = 'threads'

/** How many hits the history palette shows. */
export const SEARCH_LIMIT = 5

/** A deleted thread and where it sat, which is everything undo needs. */
export interface Removed {
  thread: Thread
  index: number
}

export interface ThreadRepository {
  /** Newest first, capped at MAX_THREADS. */
  list(): Promise<Thread[]>
  get(id: string): Promise<Thread | undefined>
  /** Upserts by id, refreshes updatedAt, and moves the thread to the front. */
  save(thread: Thread): Promise<Thread>
  /** Returns what was removed, so it can be put back. Undefined if it was not there. */
  remove(id: string): Promise<Removed | undefined>
  /**
   * Put a removed thread back exactly where it was. Not `save`, which stamps `updatedAt`
   * and prepends — undo would resurrect the thread at the top wearing a fresh timestamp.
   * Position comes from the recorded index, because threads can share a millisecond.
   */
  restore(removed: Removed): Promise<void>
  /**
   * Case-insensitive substring over title and message text, title hits first,
   * at most SEARCH_LIMIT. An empty query matches everything, so it yields the
   * newest threads.
   */
  search(query: string): Promise<Thread[]>
}

const isThread = (value: unknown): value is Thread => {
  if (typeof value !== 'object' || value === null) return false
  const thread = value as Partial<Thread>
  return (
    typeof thread.id === 'string' &&
    typeof thread.title === 'string' &&
    Array.isArray(thread.messages)
  )
}

/** A hand-edited or half-written threads.json costs us the bad rows, not the window. */
const parse = (value: unknown): Thread[] =>
  Array.isArray(value) ? value.filter(isThread).slice(0, MAX_THREADS) : []

/** Reads and writes copy, so a caller mutating its thread never reaches the cache. */
const clone = (thread: Thread): Thread => ({ ...thread, messages: [...thread.messages] })

const matchesBody = (thread: Thread, needle: string): boolean =>
  thread.messages.some((message) => message.text.toLowerCase().includes(needle))

export const createThreadRepository = (store: KeyValueStore): ThreadRepository => {
  // Read once, then kept in sync by save/remove: search() runs on every keystroke
  // while the window is open and must never go back to disk for it.
  let cache: Thread[] | undefined
  let loading: Promise<Thread[]> | undefined

  const load = (): Promise<Thread[]> => {
    if (cache) return Promise.resolve(cache)
    loading ??= (async () => {
      let raw: unknown
      try {
        raw = await store.get<unknown>(THREADS_KEY)
      } catch {
        raw = undefined
      }
      const threads = parse(raw)
      cache = threads
      loading = undefined
      return threads
    })()
    return loading
  }

  const persist = async (threads: Thread[]): Promise<void> => {
    cache = threads
    await store.set(THREADS_KEY, threads)
  }

  return {
    async list() {
      return (await load()).map(clone)
    },

    async get(id) {
      const found = (await load()).find((thread) => thread.id === id)
      return found ? clone(found) : undefined
    },

    async save(thread) {
      const threads = await load()
      const saved: Thread = { ...clone(thread), updatedAt: Date.now() }
      const next = [saved, ...threads.filter((t) => t.id !== saved.id)].slice(0, MAX_THREADS)
      await persist(next)
      return clone(saved)
    },

    async restore({ thread, index }) {
      const threads = await load()
      if (threads.some((existing) => existing.id === thread.id)) return
      const next = [...threads]
      next.splice(Math.min(index, next.length), 0, clone(thread))
      await persist(next.slice(0, MAX_THREADS))
    },

    async remove(id) {
      const threads = await load()
      const index = threads.findIndex((thread) => thread.id === id)
      if (index < 0) return undefined
      const thread = clone(threads[index]!)
      await persist(threads.filter((existing) => existing.id !== id))
      return { thread, index }
    },

    async search(query) {
      const needle = query.trim().toLowerCase()
      const titles: Thread[] = []
      const bodies: Thread[] = []
      for (const thread of await load()) {
        if (thread.title.toLowerCase().includes(needle)) titles.push(thread)
        else if (matchesBody(thread, needle)) bodies.push(thread)
        // Nothing later can outrank a full page of title hits.
        if (titles.length >= SEARCH_LIMIT) break
      }
      return [...titles, ...bodies].slice(0, SEARCH_LIMIT).map(clone)
    },
  }
}
