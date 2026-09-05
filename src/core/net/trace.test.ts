import { describe, expect, test } from 'bun:test'
import type { FetchLike } from '../ports.ts'
import { createTracer } from './trace.ts'

const drain = async (response: Response): Promise<string> => await response.text()

const sse = (body: string, init?: ResponseInit) =>
  new Response(body, { headers: { 'content-type': 'text/event-stream' }, ...init })

describe('createTracer', () => {
  test('says nothing until a request is made', () => {
    const tracer = createTracer((async () => new Response('')) as FetchLike)
    expect(tracer.last()).toBeUndefined()
    expect(tracer.describe()).toBe('No request was sent.')
  })

  // The case this exists for: a stream that opened, said nothing, and closed. The error
  // the SDK raises for it carries no cause, no status and no body.
  test('records a response that arrived empty', async () => {
    const tracer = createTracer((async () => sse('')) as FetchLike)
    const response = await tracer.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
    })
    await drain(response)

    expect(tracer.last()).toMatchObject({
      method: 'POST',
      url: 'https://api.anthropic.com/v1/messages',
      status: 200,
      contentType: 'text/event-stream',
      bytes: 0,
    })
    expect(tracer.describe()).toBe(
      'POST https://api.anthropic.com/v1/messages → 200 text/event-stream, 0 bytes',
    )
  })

  test('quotes the head of a body that did arrive', async () => {
    const body = '{"type":"error","error":{"message":"nope"}}'
    const tracer = createTracer(
      (async () =>
        new Response(body, {
          status: 400,
          headers: { 'content-type': 'application/json' },
        })) as FetchLike,
    )
    await drain(await tracer.fetch('https://x.test/v1', { method: 'POST' }))

    expect(tracer.last()?.bytes).toBe(body.length)
    expect(tracer.describe()).toContain(body)
  })

  // Watching, not reading: an SSE body must still arrive in pieces, or the answer would
  // only appear once the model had finished writing it.
  test('a traced body still streams chunk by chunk', async () => {
    const chunks = ['a'.repeat(10), 'b'.repeat(10), 'c'.repeat(10)]
    const streaming: FetchLike = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
            controller.close()
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      )

    const tracer = createTracer(streaming)
    const reader = (await tracer.fetch('https://x.test/v1')).body?.getReader()
    if (!reader) throw new Error('traced response lost its body')

    const seen: number[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      seen.push(value.byteLength)
    }
    expect(seen).toEqual([10, 10, 10])
    expect(tracer.last()?.bytes).toBe(30)
  })

  test('records a request that never got a response', async () => {
    const dead: FetchLike = async () => {
      throw new TypeError('Load failed')
    }
    const tracer = createTracer(dead)
    await expect(tracer.fetch('https://x.test/v1', { method: 'POST' })).rejects.toThrow(
      'Load failed',
    )
    expect(tracer.describe()).toBe('POST https://x.test/v1 → no response (Load failed)')
  })

  // 204 may not carry one, and rebuilding the response around a body would throw.
  test('passes a bodiless response straight through', async () => {
    const tracer = createTracer((async () => new Response(null, { status: 204 })) as FetchLike)
    const response = await tracer.fetch('https://x.test/v1')
    expect(response.status).toBe(204)
    expect(tracer.last()?.bytes).toBe(0)
  })
})
