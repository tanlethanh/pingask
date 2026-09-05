import { type LanguageModel, type ModelMessage, streamText } from 'ai'
import type { ProviderOptions } from '../providers/types.ts'
import type { Message } from '../threads/model.ts'
import { messageOf, oneLine, record, statusOf } from './error-fields.ts'

export type AskErrorKind = 'auth' | 'rate-limit' | 'network' | 'aborted' | 'unknown'

/** Every failure askStream throws. The UI switches on `kind`, never on the text. */
export class AskError extends Error {
  readonly kind: AskErrorKind

  constructor(kind: AskErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'AskError'
    this.kind = kind
  }

  static isInstance(error: unknown): error is AskError {
    return error instanceof AskError
  }
}

const HTTP_HINT = /\b(401|403|429)\b/
const NETWORK_HINTS = [
  'fetch failed',
  'load failed',
  'network',
  'econnrefused',
  'econnreset',
  'enotfound',
  'etimedout',
  'socket hang up',
]

const BODY_LIMIT = 300

/**
 * The vendor's own words, when the SDK's message does not already carry them.
 *
 * A rejected request explains itself in the response body — which model is not on the
 * plan, which parameter the endpoint does not accept. APICallError keeps that body in a
 * field the message often omits, and dropping it turns every failure into "400" and
 * every fix into a guess.
 */
const textOf = (error: unknown): string => {
  const message = messageOf(error) || 'Something went wrong.'
  const body = record(error)?.responseBody
  if (typeof body !== 'string') return message
  const trimmed = oneLine(body, BODY_LIMIT)
  if (!trimmed || message.includes(trimmed)) return message
  return `${message} — ${trimmed}`
}

const isAbort = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')

/** RetryError buries the real failure in `lastError`. */
const unwrap = (error: unknown): unknown => {
  const fields = record(error)
  if (fields && 'lastError' in fields && fields.lastError !== undefined) return fields.lastError
  return error
}

export const toAskError = (error: unknown): AskError => {
  if (error instanceof AskError) return error

  const cause = unwrap(error)
  if (isAbort(error) || isAbort(cause))
    return new AskError('aborted', 'Cancelled.', { cause: error })

  const name = record(cause)?.name
  if (name === 'AI_LoadAPIKeyError') return new AskError('auth', textOf(cause), { cause: error })

  const status = statusOf(cause)
  if (status === 401 || status === 403) return new AskError('auth', textOf(cause), { cause: error })
  if (status === 429) return new AskError('rate-limit', textOf(cause), { cause: error })
  if (status !== undefined && status >= 500)
    return new AskError('network', textOf(cause), { cause: error })

  const message = textOf(cause)
  if (status === undefined) {
    const lower = message.toLowerCase()
    // A key rejected before any HTTP round-trip still reads as an auth problem.
    if (lower.includes('api key') || lower.includes('unauthorized')) {
      return new AskError('auth', message, { cause: error })
    }
    if (HTTP_HINT.test(message)) {
      return new AskError(message.includes('429') ? 'rate-limit' : 'auth', message, {
        cause: error,
      })
    }
    if (cause instanceof TypeError || NETWORK_HINTS.some((hint) => lower.includes(hint))) {
      return new AskError('network', message, { cause: error })
    }
  }
  return new AskError('unknown', message, { cause: error })
}

export interface AskStreamOptions {
  model: LanguageModel
  /** System blocks from buildSystemPrompt, in order. */
  system: string[]
  /** The whole thread, oldest first, ending with the question being asked. */
  messages: Message[]
  signal?: AbortSignal
  onChunk?: (delta: string) => void
  /** Vendor-specific generation options, from buildProviderOptions. */
  providerOptions?: ProviderOptions
  /** From the provider's quirks. Unset means the SDK's own default stands. */
  maxOutputTokens?: number
}

/** Failed turns carry `error` instead of `text`; they are not worth resending. */
const toModelMessages = (messages: Message[]): ModelMessage[] =>
  messages
    .filter((message) => message.text.trim().length > 0)
    .map(
      (message): ModelMessage =>
        message.role === 'assistant'
          ? { role: 'assistant', content: message.text }
          : { role: 'user', content: message.text },
    )

/**
 * One turn of inference. Streams deltas to `onChunk`, resolves with the full
 * text, and throws AskError for everything else.
 */
export const askStream = async ({
  model,
  system,
  messages,
  signal,
  onChunk,
  providerOptions,
  maxOutputTokens,
}: AskStreamOptions): Promise<string> => {
  if (signal?.aborted) throw new AskError('aborted', 'Cancelled.')

  const prompt = toModelMessages(messages)
  if (prompt.length === 0) throw new AskError('unknown', 'Nothing to ask.')

  // streamText keeps errors off the stream unless we take them here; the SDK
  // default handler only console.errors them.
  let reported: unknown
  let text = ''

  try {
    const result = streamText({
      model,
      instructions: system.map((content) => ({ role: 'system' as const, content })),
      ...(providerOptions ? { providerOptions } : {}),
      ...(maxOutputTokens ? { maxOutputTokens } : {}),
      messages: prompt,
      abortSignal: signal,
      onError: ({ error }) => {
        reported = error
      },
    })

    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        text += part.text
        onChunk?.(part.text)
      } else if (part.type === 'error') {
        throw toAskError(part.error)
      } else if (part.type === 'abort') {
        throw new AskError('aborted', 'Cancelled.')
      }
    }
  } catch (error) {
    throw toAskError(error)
  }

  if (reported !== undefined) throw toAskError(reported)
  if (signal?.aborted) throw new AskError('aborted', 'Cancelled.')
  // A stream that closes without text and without an error part is still a failed turn:
  // the SDK rejects its own result promises with AI_NoOutputGeneratedError here, but
  // those are promises we never read, so the failure would otherwise land as an empty
  // answer bubble with nothing to explain it.
  if (!text) throw new AskError('unknown', 'The model returned no output.')
  return text
}
