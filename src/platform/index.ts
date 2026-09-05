// The platform layer's entry point. Everything outside src/platform/ imports from here;
// core/ imports nothing from here at all and receives Ports.

import type { Ports } from '../core/ports.ts'
import { pickFetch } from './http.ts'
import { loopback } from './oauth-server.ts'
import { browser } from './opener.ts'
import { createStore } from './store.ts'

/**
 * Build the real Ports. Called once at startup; tests substitute in-memory fakes for the
 * same interface.
 *
 * Each store is its own JSON file in the app data dir, split by lifetime: auth.json holds
 * secrets, settings.json is user-authored, threads.json is the data model, and cache.json
 * is anything that can be thrown away and refetched. Nothing here touches disk until it
 * is first read.
 */
export const createPorts = (): Ports => ({
  fetch: pickFetch(),
  browser,
  loopback,
  authStore: createStore('auth.json'),
  settingsStore: createStore('settings.json'),
  threadStore: createStore('threads.json'),
  cacheStore: createStore('cache.json'),
})

export { appVersion } from './app.ts'
export { confirmDestructive, isDialogOpen } from './dialog.ts'
export { quit } from './process.ts'
export * as shortcut from './shortcut.ts'
export * as appWindow from './window.ts'
