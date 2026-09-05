import { describe, expect, test } from 'bun:test'
import { describeFailure, detailOf } from './failure.ts'
import { AskError } from './stream.ts'

const apiError = (status: number, message: string, body?: string): Error =>
  Object.assign(new Error(message), {
    name: 'AI_APICallError',
    statusCode: status,
    url: 'https://api.anthropic.com/v1/messages',
    ...(body ? { responseBody: body } : {}),
  })

describe('detailOf', () => {
  test('leads with the name, status and url', () => {
    expect(detailOf(apiError(400, 'Bad Request'))).toBe(
      'AI_APICallError: Bad Request (400 https://api.anthropic.com/v1/messages)',
    )
  })

  test("keeps the vendor's body, which is the line worth having", () => {
    const body = '{"type":"error","error":{"message":"CORS requests must set ..."}}'
    expect(detailOf(apiError(401, 'Unauthorized', body))).toContain(body)
  })

  // The SDK wraps a retry around an API error around a fetch failure, and only one of
  // the three says anything useful — which one changes per provider.
  test('walks the whole chain, through cause and lastError alike', () => {
    const inner = new TypeError('fetch failed')
    const middle = Object.assign(new Error('API call failed'), {
      name: 'AI_APICallError',
      cause: inner,
    })
    const outer = Object.assign(new Error('failed after 3 attempts'), {
      name: 'AI_RetryError',
      lastError: middle,
    })
    expect(detailOf(outer).split('\n')).toEqual([
      'AI_RetryError: failed after 3 attempts',
      'AI_APICallError: API call failed',
      'TypeError: fetch failed',
    ])
  })

  test('a cycle in the chain terminates', () => {
    const a: Record<string, unknown> = { name: 'A', message: 'a' }
    const b: Record<string, unknown> = { name: 'B', message: 'b', cause: a }
    a.cause = b
    expect(detailOf(a).split('\n')).toEqual(['A: a', 'B: b'])
  })

  test('survives a thrown non-error', () => {
    expect(detailOf('plain string')).toBe('Error: plain string')
    expect(detailOf({ weird: true })).toBe('Error: {"weird":true}')
  })
})

describe('describeFailure', () => {
  // The summary is for the screen, the detail for a bug report. A status code belongs in
  // exactly one of them.
  test('says what to do without quoting the vendor', () => {
    const failure = describeFailure(apiError(401, 'invalid x-api-key'))
    expect(failure.kind).toBe('auth')
    expect(failure.summary).toBe(
      'The provider rejected these credentials. Reconnect it in settings.',
    )
    expect(failure.summary).not.toContain('401')
    expect(failure.detail).toContain('invalid x-api-key')
  })

  test('carries the kind through for a rate limit and a dead connection', () => {
    expect(describeFailure(apiError(429, 'Too many requests')).kind).toBe('rate-limit')
    expect(describeFailure(new TypeError('Load failed')).kind).toBe('network')
  })

  test('a rejected request points at the model, not the credentials', () => {
    const failure = describeFailure(apiError(400, "Unsupported value: 'none'"))
    expect(failure.kind).toBe('bad-request')
    expect(failure.summary).toBe('This model would not accept the request. Try another model.')
  })

  test('an abort is a kind, not an error to explain', () => {
    expect(describeFailure(new AskError('aborted', 'Cancelled.')).kind).toBe('aborted')
  })

  // AI_NoOutputGeneratedError carries no cause, no status and no body, so on its own its
  // detail explains nothing. The transport's account of the exchange is the whole point.
  test('appends the transport trace when one is given', () => {
    const silent = Object.assign(new Error('No output generated. Check the stream for errors.'), {
      name: 'AI_NoOutputGeneratedError',
    })
    const trace = 'POST https://api.anthropic.com/v1/messages → 200 text/event-stream, 0 bytes'
    expect(describeFailure(silent, trace).detail).toBe(
      `AI_NoOutputGeneratedError: No output generated. Check the stream for errors.\n\n${trace}`,
    )
  })

  test('leaves the detail alone when there is no trace', () => {
    const failure = describeFailure(apiError(400, 'Bad Request'), '   ')
    expect(failure.detail.endsWith(')')).toBe(true)
  })

  test('falls back to a summary that points at the detail', () => {
    const failure = describeFailure(new Error('something odd'))
    expect(failure.summary).toBe('The request failed.')
    expect(failure.detail).toBe('Error: something odd')
  })
})
