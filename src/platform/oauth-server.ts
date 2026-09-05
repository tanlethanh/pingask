// LoopbackServer over @fabianlars/tauri-plugin-oauth 2.1.0.
//
// How the plugin behaves, from its lib.rs:
//
//   start({ ports: [p] })  binds 127.0.0.1:p and resolves with the bound port. A
//                          single-element list has no fallback — a taken port rejects.
//   the callback           takes TWO connections: the redirect gets an HTML page whose
//                          inline script re-fetches with a `Full-Url` header, and that
//                          second request both produces the URL and stops the server.
//   oauth://invalid-url    emitted only when Url::parse fails, so it is a real error
//                          rather than a stray favicon request.
//   cancel(p)              writes a magic exit token to the port. Fails with connection
//                          refused once the server has stopped, which cleanup swallows.

import { cancel, onInvalidUrl, onUrl, start } from '@fabianlars/tauri-plugin-oauth'
import type { LoopbackServer } from '../core/ports.ts'

/** Long enough for a password manager, 2FA and a consent screen. */
const DEFAULT_TIMEOUT_MS = 120_000

// Must contain <head> or <body>: the plugin injects its callback script into one of
// them and warns if it finds neither.
const RESPONSE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Pingask</title>
<style>html{color-scheme:light dark}body{margin:0;height:100vh;display:grid;place-items:center;
font:15px/1.5 -apple-system,system-ui,sans-serif}</style></head>
<body><p>Signed in. You can close this tab and return to Pingask.</p></body></html>`

const portBusy = (port: number) =>
  `Could not bind 127.0.0.1:${port} for the sign-in callback. ` +
  'The provider pins this port, so the flow cannot fall back to another one. ' +
  'It is usually held by a CLI that is already running: Claude Code sits on :54545, ' +
  'the Codex CLI on :1455. Quit it and try again.'

export const loopback: LoopbackServer = {
  async await(options: { port: number; timeoutMs?: number }): Promise<string> {
    const { port, timeoutMs = DEFAULT_TIMEOUT_MS } = options

    let resolveUrl!: (url: string) => void
    let rejectUrl!: (error: Error) => void
    const callback = new Promise<string>((resolve, reject) => {
      resolveUrl = resolve
      rejectUrl = reject
    })

    // Subscribe before binding: the events are plain window events, and a browser that
    // is already sitting on the authorize URL can redirect faster than a late listen().
    const unlisten = [
      await onUrl(resolveUrl),
      await onInvalidUrl((error) => {
        rejectUrl(new Error(`The sign-in callback URL could not be parsed: ${error}`))
      }),
    ]
    const stopListening = () => {
      for (const un of unlisten) un()
    }

    let bound: number
    try {
      bound = await start({ ports: [port], response: RESPONSE_HTML })
    } catch (cause) {
      stopListening()
      throw new Error(portBusy(port), { cause })
    }

    if (bound !== port) {
      // Defensive: the provider only accepts the redirect URI it has on file.
      await cancel(bound).catch(() => undefined)
      stopListening()
      throw new Error(portBusy(port))
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for the sign-in callback.`))
      }, timeoutMs)
    })

    try {
      return await Promise.race([callback, timeout])
    } finally {
      clearTimeout(timer)
      stopListening()
      // Already gone after a successful callback — that rejection is not interesting.
      await cancel(port).catch(() => undefined)
    }
  },
}
