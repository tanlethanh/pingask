// The app bundle's own metadata. `getVersion()` returns the version compiled in from
// src-tauri/tauri.conf.json, so a label built on it can never drift from what shipped —
// which package.json's copy, bundled into the frontend, would do the moment one is
// bumped without the other.

import { getVersion } from '@tauri-apps/api/app'

/** The bundle version, e.g. "2.0.0". Allowed by core:app:default, part of core:default. */
export const appVersion = (): Promise<string> => getVersion()
