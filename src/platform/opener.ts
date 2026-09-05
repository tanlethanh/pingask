// Browser port: hands a URL to the OS so the user's real browser (with their real
// session cookies) handles it. Used by the OAuth flow in core/auth/oauth.ts.

import { openUrl } from '@tauri-apps/plugin-opener'
import type { Browser } from '../core/ports.ts'

export const browser: Browser = {
  async open(url: string): Promise<void> {
    await openUrl(url)
  },
}
