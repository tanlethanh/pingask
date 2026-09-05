import { describe, expect, test } from 'bun:test'
import type { FetchLike } from '../ports.ts'
import { withoutOrigin } from './origin.ts'

const capture = (): { fetch: FetchLike; headers: () => Headers | undefined } => {
  let seen: Headers | undefined
  return {
    fetch: async (_input, init) => {
      seen = new Headers(init?.headers)
      return new Response('')
    },
    headers: () => seen,
  }
}

describe('withoutOrigin', () => {
  // An empty value is not a blank origin — it is how tauri-plugin-http is told to drop
  // the header, which is the only way to stop looking like a browser to Anthropic.
  test('sends an empty Origin so the plugin removes it', async () => {
    const sink = capture()
    await withoutOrigin(sink.fetch)('https://api.anthropic.com/v1/messages', { method: 'POST' })
    expect(sink.headers()?.get('origin')).toBe('')
  })

  test('leaves the rest of the request alone', async () => {
    const sink = capture()
    await withoutOrigin(sink.fetch)('https://x.test/v1', {
      method: 'POST',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    })
    expect(sink.headers()?.get('authorization')).toBe('Bearer t')
    expect(sink.headers()?.get('content-type')).toBe('application/json')
  })

  test('a caller that wants an origin keeps it', async () => {
    const sink = capture()
    await withoutOrigin(sink.fetch)('https://x.test/v1', {
      headers: { Origin: 'https://pingask.test' },
    })
    expect(sink.headers()?.get('origin')).toBe('https://pingask.test')
  })

  test('works when the caller passed a Headers instance', async () => {
    const sink = capture()
    await withoutOrigin(sink.fetch)('https://x.test/v1', {
      headers: new Headers({ accept: 'text/event-stream' }),
    })
    expect(sink.headers()?.get('accept')).toBe('text/event-stream')
    expect(sink.headers()?.get('origin')).toBe('')
  })
})
