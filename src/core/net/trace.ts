// A record of the last HTTP exchange, for when the error does not carry one.
//
// `AI_NoOutputGeneratedError` is the case this exists for: raised when a stream produced
// nothing, it carries no cause, no status and no body. The transport always knows.
//
// The body is watched rather than read — bytes counted and the first of them kept as they
// pass through — so a traced request still streams exactly as it did.

import type { FetchLike } from '../ports.ts'

/** How much of a response body is worth keeping to identify a failure. */
const HEAD_LIMIT = 400

export interface Exchange {
  method: string
  url: string
  status?: number
  statusText?: string
  contentType?: string
  /** Bytes that reached the reader. Zero on a stream that opened and said nothing. */
  bytes: number
  /** The first of those bytes, decoded. */
  head: string
  /** Set when the request never produced a response at all. */
  transportError?: string
}

export interface Tracer {
  /** Hand this to the provider in place of ports.fetch. */
  readonly fetch: FetchLike
  /** The most recent exchange, or undefined when nothing was sent. */
  last(): Exchange | undefined
  /** Two lines at most, for a failure detail. Empty when there is nothing to say. */
  describe(): string
}

const urlOf = (input: Parameters<FetchLike>[0]): string => {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

const oneLine = (text: string): string => text.trim().replace(/\s+/g, ' ')

/**
 * Not every status may carry a body, so the response is only rebuilt when one is present.
 * `new Response(body, { status: 204 })` throws, and a 1xx cannot be constructed at all.
 */
const canCarryBody = (status: number): boolean =>
  status >= 200 && status !== 204 && status !== 205 && status !== 304

export const describeExchange = (exchange: Exchange | undefined): string => {
  if (!exchange) return 'No request was sent.'
  const { method, url, status, statusText, contentType, bytes, transportError, head } = exchange
  if (transportError) return `${method} ${url} → no response (${transportError})`

  const outcome = [status, statusText, contentType].filter(Boolean).join(' ')
  const first = `${method} ${url} → ${outcome}, ${bytes} bytes`
  // A body worth quoting is one that failed. A stream that said nothing is described by
  // its byte count alone, and there is no second line to write.
  return head ? `${first}\n${oneLine(head).slice(0, HEAD_LIMIT)}` : first
}

/**
 * Wrap a transport so the last exchange through it can be read back.
 *
 * One tracer per turn: the trace belongs to the request that failed, and a shared one
 * would report whichever call happened to be last across the whole app.
 */
export const createTracer = (fetch: FetchLike): Tracer => {
  let current: Exchange | undefined

  const traced: FetchLike = async (input, init) => {
    const exchange: Exchange = {
      method: init?.method ?? 'GET',
      url: urlOf(input),
      bytes: 0,
      head: '',
    }
    current = exchange

    let response: Response
    try {
      response = await fetch(input, init)
    } catch (cause) {
      exchange.transportError = cause instanceof Error ? cause.message : String(cause)
      throw cause
    }

    exchange.status = response.status
    exchange.statusText = response.statusText
    exchange.contentType = response.headers.get('content-type') ?? undefined

    if (!response.body || !canCarryBody(response.status)) return response

    const decoder = new TextDecoder()
    const watched = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          exchange.bytes += chunk.byteLength
          if (exchange.head.length < HEAD_LIMIT) {
            exchange.head += decoder.decode(chunk, { stream: true })
          }
          controller.enqueue(chunk)
        },
      }),
    )

    return new Response(watched, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }

  return {
    fetch: traced,
    last: () => current,
    describe: () => describeExchange(current),
  }
}
