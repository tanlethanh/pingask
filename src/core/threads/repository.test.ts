import { describe, expect, test } from 'bun:test'
import type { KeyValueStore } from '../ports.ts'
import { fakeStore } from '../testing/fakes.ts'
import { MAX_THREADS, type Message, type Thread } from './model.ts'
import { createThreadRepository, SEARCH_LIMIT } from './repository.ts'

const message = (role: Message['role'], text: string): Message => ({
  id: `${role}:${text}`,
  role,
  text,
  createdAt: 0,
})

const thread = (id: string, title: string, texts: string[] = []): Thread => ({
  id,
  title,
  createdAt: 0,
  updatedAt: 0,
  messages: [message('user', title), ...texts.map((text) => message('assistant', text))],
})

/** Wraps a store to prove the repository is not going back to it on every call. */
const counting = (inner: KeyValueStore) => {
  const counts = { get: 0, set: 0 }
  const store: KeyValueStore = {
    async get<T>(key: string): Promise<T | undefined> {
      counts.get += 1
      return inner.get<T>(key)
    },
    async set(key: string, value: unknown): Promise<void> {
      counts.set += 1
      await inner.set(key, value)
    },
    async delete(key: string): Promise<void> {
      await inner.delete(key)
    },
  }
  return { store, counts }
}

describe('createThreadRepository', () => {
  test('is empty when nothing is stored', async () => {
    const repo = createThreadRepository(fakeStore())
    expect(await repo.list()).toEqual([])
    expect(await repo.get('nope')).toBeUndefined()
  })

  test('save upserts by id, refreshes updatedAt and moves the thread to the front', async () => {
    const repo = createThreadRepository(fakeStore())
    await repo.save(thread('a', 'first'))
    await repo.save(thread('b', 'second'))
    await repo.save(thread('c', 'third'))
    expect((await repo.list()).map((t) => t.id)).toEqual(['c', 'b', 'a'])

    const saved = await repo.save({ ...thread('a', 'first again'), updatedAt: 0 })
    expect(saved.updatedAt).toBeGreaterThan(0)
    expect((await repo.list()).map((t) => t.id)).toEqual(['a', 'c', 'b'])
    expect((await repo.get('a'))?.title).toBe('first again')
    expect(await repo.list()).toHaveLength(3)
  })

  test('caps the list at MAX_THREADS, dropping the oldest', async () => {
    const repo = createThreadRepository(fakeStore())
    for (let i = 0; i < MAX_THREADS + 5; i += 1) await repo.save(thread(`t${i}`, `thread ${i}`))

    const threads = await repo.list()
    expect(threads).toHaveLength(MAX_THREADS)
    expect(threads[0]?.id).toBe(`t${MAX_THREADS + 4}`)
    expect(await repo.get('t0')).toBeUndefined()
    expect(await repo.get('t5')).toBeDefined()
  })

  test('remove drops the thread', async () => {
    const store = fakeStore()
    const repo = createThreadRepository(store)
    await repo.save(thread('a', 'keep'))
    await repo.save(thread('b', 'drop'))

    await repo.remove('b')
    expect((await repo.list()).map((t) => t.id)).toEqual(['a'])

    await repo.remove('missing')
    expect(await repo.list()).toHaveLength(1)
    expect(await createThreadRepository(store).list()).toHaveLength(1)
  })

  describe('corrupt storage', () => {
    test('falls back to empty when the value is not an array', async () => {
      const repo = createThreadRepository(fakeStore({ threads: 'not json' }))
      expect(await repo.list()).toEqual([])
    })

    test('drops rows that are not threads', async () => {
      const repo = createThreadRepository(
        fakeStore({ threads: [thread('a', 'good'), null, 42, { id: 'b' }] }),
      )
      expect((await repo.list()).map((t) => t.id)).toEqual(['a'])
    })

    test('truncates an oversized stored array', async () => {
      const rows = Array.from({ length: MAX_THREADS + 20 }, (_, i) => thread(`t${i}`, `t ${i}`))
      const repo = createThreadRepository(fakeStore({ threads: rows }))
      expect(await repo.list()).toHaveLength(MAX_THREADS)
    })

    test('survives a store that throws on read', async () => {
      const repo = createThreadRepository({
        get: () => Promise.reject(new Error('EACCES')),
        set: async () => {},
        delete: async () => {},
      })
      expect(await repo.list()).toEqual([])
    })
  })

  describe('search', () => {
    const seeded = async () => {
      const repo = createThreadRepository(fakeStore())
      await repo.save(thread('body', 'Weekend plans', ['run docker compose up -d']))
      await repo.save(thread('other', 'Tax deadline', ['nothing relevant']))
      await repo.save(thread('title', 'Docker network modes', ['bridge, host, none']))
      return repo
    }

    test('ranks title matches ahead of message matches', async () => {
      const repo = await seeded()
      expect((await repo.search('docker')).map((t) => t.id)).toEqual(['title', 'body'])
    })

    test('is case-insensitive', async () => {
      const repo = await seeded()
      expect((await repo.search('DOCKER')).map((t) => t.id)).toEqual(['title', 'body'])
    })

    test('returns nothing when nothing matches', async () => {
      const repo = await seeded()
      expect(await repo.search('kubernetes')).toEqual([])
    })

    test('returns at most SEARCH_LIMIT hits, newest first', async () => {
      const repo = createThreadRepository(fakeStore())
      for (let i = 0; i < SEARCH_LIMIT + 3; i += 1) await repo.save(thread(`t${i}`, `docker ${i}`))

      const hits = await repo.search('docker')
      expect(hits).toHaveLength(SEARCH_LIMIT)
      expect(hits[0]?.id).toBe(`t${SEARCH_LIMIT + 2}`)
    })

    test('an empty query yields the newest threads', async () => {
      const repo = await seeded()
      expect((await repo.search('  ')).map((t) => t.id)).toEqual(['title', 'other', 'body'])
    })
  })

  describe('cache', () => {
    test('reads the store once and serves later calls from memory', async () => {
      const { store, counts } = counting(fakeStore({ threads: [thread('a', 'cached')] }))
      const repo = createThreadRepository(store)

      await repo.list()
      await repo.list()
      await repo.search('cached')
      await repo.get('a')
      expect(counts.get).toBe(1)
    })

    test('a concurrent first read still hits the store once', async () => {
      const { store, counts } = counting(fakeStore({ threads: [thread('a', 'cached')] }))
      const repo = createThreadRepository(store)

      const [list, hits] = await Promise.all([repo.list(), repo.search('cached')])
      expect(list).toHaveLength(1)
      expect(hits).toHaveLength(1)
      expect(counts.get).toBe(1)
    })

    test('a save shows up in later reads without another store read', async () => {
      const { store, counts } = counting(fakeStore())
      const repo = createThreadRepository(store)

      await repo.save(thread('a', 'docker notes'))
      expect((await repo.list()).map((t) => t.id)).toEqual(['a'])
      expect((await repo.search('docker')).map((t) => t.id)).toEqual(['a'])
      expect((await repo.get('a'))?.title).toBe('docker notes')
      expect(counts.get).toBe(1)
      expect(counts.set).toBe(1)
    })

    test('a save is persisted, so a fresh repository sees it', async () => {
      const store = fakeStore()
      await createThreadRepository(store).save(thread('a', 'persisted'))
      expect((await createThreadRepository(store).list()).map((t) => t.id)).toEqual(['a'])
    })

    test('mutating a saved or returned thread does not corrupt the cache', async () => {
      const repo = createThreadRepository(fakeStore())
      const original = thread('a', 'original')
      await repo.save(original)

      original.title = 'mutated'
      original.messages.push(message('user', 'leaked'))
      const [listed] = await repo.list()
      listed!.title = 'also mutated'

      const stored = await repo.get('a')
      expect(stored?.title).toBe('original')
      expect(stored?.messages).toHaveLength(1)
    })
  })
})

describe('restore', () => {
  test('remove reports where the thread was', async () => {
    const repo = createThreadRepository(fakeStore())
    await repo.save({ id: 'a', title: 'a', createdAt: 0, updatedAt: 0, messages: [] })
    await repo.save({ id: 'b', title: 'b', createdAt: 0, updatedAt: 0, messages: [] })
    // Ties in updatedAt are why position is recorded rather than derived.
    expect((await repo.remove('a'))?.index).toBe(1)
    expect(await repo.remove('nope')).toBeUndefined()
  })

  const at = (id: string, updatedAt: number): Thread => ({
    id,
    title: id,
    createdAt: updatedAt,
    updatedAt,
    messages: [],
  })

  test('puts a thread back in its original position, not at the front', async () => {
    const repo = createThreadRepository(fakeStore())
    await repo.save(at('old', 0))
    await repo.save(at('mid', 0))
    await repo.save(at('new', 0))
    const before = (await repo.list()).map((thread) => thread.id)
    const middle = (await repo.list())[1]

    const removed = await repo.remove(middle!.id)
    await repo.restore(removed!)

    expect((await repo.list()).map((thread) => thread.id)).toEqual(before)
  })

  test('keeps the original updatedAt', async () => {
    const repo = createThreadRepository(fakeStore())
    const saved = await repo.save(at('a', 0))
    const removed = await repo.remove(saved.id)
    await repo.restore(removed!)

    const [restored] = await repo.list()
    expect(restored?.updatedAt).toBe(saved.updatedAt)
  })

  test('restoring a thread that is still there changes nothing', async () => {
    const repo = createThreadRepository(fakeStore())
    const saved = await repo.save(at('a', 0))
    await repo.restore({ thread: saved, index: 0 })
    expect(await repo.list()).toHaveLength(1)
  })

  test('a restored thread is readable again', async () => {
    const repo = createThreadRepository(fakeStore())
    const saved = await repo.save(at('a', 0))
    const removed = await repo.remove(saved.id)
    expect(await repo.get(saved.id)).toBeUndefined()
    await repo.restore(removed!)
    expect(await repo.get(saved.id)).toBeDefined()
  })
})
