import { describe, expect, test } from 'bun:test'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import type { Message } from '../threads/model.ts'
import { AskError, type AskErrorKind, askStream, toAskError } from './stream.ts'

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}

const user = (text: string): Message => ({ id: `u:${text}`, role: 'user', text, createdAt: 0 })
const assistant = (text: string): Message => ({
  id: `a:${text}`,
  role: 'assistant',
  text,
  createdAt: 0,
})

/** The provider-level stream part, without importing @ai-sdk/provider directly. */
type StreamPart =
  Awaited<ReturnType<MockLanguageModelV4['doStream']>> extends {
    stream: ReadableStream<infer Part>
  }
    ? Part
    : never

const streaming = (chunks: StreamPart[]) =>
  new MockLanguageModelV4({
    doStream: async () => ({ stream: simulateReadableStream({ chunks }) }),
  })

const deltas = (...texts: string[]) => {
  const chunks: StreamPart[] = [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: '0' },
  ]
  for (const delta of texts) chunks.push({ type: 'text-delta', id: '0', delta })
  chunks.push({ type: 'text-end', id: '0' })
  chunks.push({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: USAGE })
  return streaming(chunks)
}

const failsWith = (error: unknown) =>
  streaming([
    { type: 'stream-start', warnings: [] },
    { type: 'error', error },
  ])

const withStatus = (status: number, message: string): Error =>
  Object.assign(new Error(message), { statusCode: status })

describe('askStream', () => {
  test('streams deltas and resolves with the full text', async () => {
    const chunks: string[] = []
    const text = await askStream({
      model: deltas('Hello', ', ', 'world'),
      system: ['be terse'],
      messages: [user('hi')],
      onChunk: (delta) => chunks.push(delta),
    })

    expect(text).toBe('Hello, world')
    expect(chunks).toEqual(['Hello', ', ', 'world'])
  })

  test('sends the system blocks in order, followed by the thread', async () => {
    const model = deltas('ok')
    await askStream({
      model,
      system: ['vendor preamble', 'pingask rules'],
      messages: [user('first'), assistant('answer'), user('follow up')],
    })

    const prompt = model.doStreamCalls[0]?.prompt ?? []
    expect(prompt.flatMap((m) => (m.role === 'system' ? [m.content] : []))).toEqual([
      'vendor preamble',
      'pingask rules',
    ])
    expect(prompt.map((m) => m.role)).toEqual(['system', 'system', 'user', 'assistant', 'user'])
  })

  test('drops turns that failed, since they carry no text', async () => {
    const model = deltas('ok')
    await askStream({
      model,
      system: [],
      messages: [
        user('first'),
        { id: 'boom', role: 'assistant', text: '', error: 'rate limited', createdAt: 0 },
        user('retry'),
      ],
    })

    const prompt = model.doStreamCalls[0]?.prompt ?? []
    expect(prompt.map((m) => m.role)).toEqual(['user', 'user'])
  })

  test('refuses an empty thread', async () => {
    const call = askStream({ model: deltas('ok'), system: [], messages: [] })
    await expect(call).rejects.toMatchObject({ kind: 'unknown' })
  })

  test('throws aborted when the signal is already spent', async () => {
    const call = askStream({
      model: deltas('ok'),
      system: [],
      messages: [user('hi')],
      signal: AbortSignal.abort(),
    })
    await expect(call).rejects.toMatchObject({ kind: 'aborted' })
  })

  test('maps a stream error into a typed AskError', async () => {
    const call = askStream({
      model: failsWith(withStatus(429, 'Too many requests')),
      system: [],
      messages: [user('hi')],
    })
    await expect(call).rejects.toMatchObject({ kind: 'rate-limit', message: 'Too many requests' })
  })

  test('every failure is an AskError', async () => {
    try {
      await askStream({ model: failsWith('plain string'), system: [], messages: [user('hi')] })
      throw new Error('should have thrown')
    } catch (error) {
      expect(AskError.isInstance(error)).toBe(true)
    }
  })

  // The SDK rejects its own result promises here — promises askStream never reads — so
  // without this an empty stream resolved as an empty answer with nothing to explain it.
  test('a stream that ends with no text and no error is still a failure', async () => {
    const silent = streaming([
      { type: 'stream-start', warnings: [] },
      { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: USAGE },
    ])
    const call = askStream({ model: silent, system: [], messages: [user('hi')] })
    await expect(call).rejects.toMatchObject({
      kind: 'unknown',
      message: 'The model returned no output.',
    })
  })
})

describe('toAskError', () => {
  const httpCases: [number, AskErrorKind][] = [
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate-limit'],
    [500, 'network'],
    [503, 'network'],
    [400, 'unknown'],
  ]

  test.each(httpCases)('maps HTTP %i to %s', (status, kind) => {
    expect(toAskError(withStatus(status, 'nope')).kind).toBe(kind)
  })

  test('unwraps the last error of a retry wrapper', () => {
    const wrapper = Object.assign(new Error('failed after 3 attempts'), {
      lastError: withStatus(401, 'invalid x-api-key'),
    })
    expect(toAskError(wrapper)).toMatchObject({ kind: 'auth', message: 'invalid x-api-key' })
  })

  test('recognises an abort', () => {
    const aborted = new Error('The operation was aborted.')
    aborted.name = 'AbortError'
    expect(toAskError(aborted).kind).toBe('aborted')
  })

  test('recognises a missing key before any request is made', () => {
    const missing = new Error('API key is missing')
    missing.name = 'AI_LoadAPIKeyError'
    expect(toAskError(missing).kind).toBe('auth')
  })

  test('recognises a dead connection', () => {
    expect(toAskError(new TypeError('fetch failed')).kind).toBe('network')
    expect(toAskError(new Error('connect ECONNREFUSED 127.0.0.1:11434')).kind).toBe('network')
  })

  test('falls back to unknown, with a message', () => {
    expect(toAskError(new Error('weird')).kind).toBe('unknown')
    expect(toAskError(null).message).toBe('Something went wrong.')
  })

  test('passes an AskError straight through', () => {
    const original = new AskError('auth', 'already typed')
    expect(toAskError(original)).toBe(original)
  })

  test('appends the response body the SDK message left out', () => {
    const failure = Object.assign(new Error('Bad Request'), {
      statusCode: 400,
      responseBody: '{"detail":"reasoning.effort\n  none is not a valid effort"}',
    })
    expect(toAskError(failure).message).toBe(
      'Bad Request — {"detail":"reasoning.effort none is not a valid effort"}',
    )
  })

  test('does not repeat a body the message already quotes', () => {
    const failure = Object.assign(new Error('model not on plan'), {
      statusCode: 403,
      responseBody: 'model not on plan',
    })
    expect(toAskError(failure).message).toBe('model not on plan')
  })
})
