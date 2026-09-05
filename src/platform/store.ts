// KeyValueStore over tauri-plugin-store. One JSON file per store, all of them under
// ~/Library/Application Support/me.tanlethanh.pingask/ (see PLAN.md decision #8).

import { load, type Store } from '@tauri-apps/plugin-store'
import type { KeyValueStore } from '../core/ports.ts'

/**
 * Open (lazily, once) the store file `filename` and expose it as a KeyValueStore. Nothing
 * touches disk until the first get/set/delete, and a missing file is not an error.
 *
 * Auto-save is off on purpose: auth.json and threads.json must be on disk before the write
 * resolves — a 100ms debounce is a window in which a crash loses a credential — so every
 * mutation is followed by an explicit save().
 */
export const createStore = (filename: string): KeyValueStore => {
  let opening: Promise<Store> | undefined

  const open = (): Promise<Store> => {
    if (!opening) {
      opening = load(filename, { defaults: {}, autoSave: false }).catch((error: unknown) => {
        // Don't cache a failure forever; let the next call try again.
        opening = undefined
        throw error
      })
    }
    return opening
  }

  return {
    async get<T>(key: string): Promise<T | undefined> {
      const store = await open()
      return await store.get<T>(key)
    },

    async set(key: string, value: unknown): Promise<void> {
      const store = await open()
      await store.set(key, value)
      await store.save()
    },

    async delete(key: string): Promise<void> {
      const store = await open()
      await store.delete(key)
      await store.save()
    },
  }
}
