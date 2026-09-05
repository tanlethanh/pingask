// Turning a thrown thing into something a person can read and a developer can act on.
//
// Two audiences, one function. The summary says what happened in the user's terms and
// never mentions a status code; the detail is everything we know, so a bug report is a
// copy-paste rather than a re-run with devtools open.

import { field, messageOf, nameOf, record } from './error-fields.ts'
import { type AskErrorKind, toAskError } from './stream.ts'

export interface Failure {
  /** One sentence, for the person looking at the screen. */
  summary: string
  /** Vendor message, status, and cause chain. Empty when there is nothing to add. */
  detail: string
  kind: AskErrorKind
}

/** Says what to do, not what went wrong internally. */
const SUMMARIES: Record<AskErrorKind, string> = {
  auth: 'The provider rejected these credentials. Reconnect it in settings.',
  'rate-limit': 'The provider is rate-limiting this account. Try again in a moment.',
  'bad-request': 'This model would not accept the request. Try another model.',
  network: 'Could not reach the provider. Check the connection and try again.',
  aborted: 'Cancelled.',
  unknown: 'The request failed.',
}

const MAX_DETAIL = 2000

const describeThrown = (error: unknown): string => {
  const message = messageOf(error)
  if (message) return message
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/** One line per link in the chain: `AI_APICallError: ... (400 https://…)`. */
const line = (error: unknown): string => {
  const status = field(error, 'statusCode') ?? field(error, 'status')
  const url = field(error, 'url')
  const where = [status, url].filter(Boolean).join(' ')
  return `${nameOf(error)}: ${describeThrown(error)}${where ? ` (${where})` : ''}`
}

/**
 * Every link of the chain, plus whatever body the vendor sent.
 *
 * The chain is what makes this worth having: the SDK wraps a retry around an API error
 * around a fetch failure, and only one of those three says anything useful. Which one it
 * is changes per provider, so all of them are printed.
 */
export const detailOf = (error: unknown): string => {
  const lines: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = error

  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current)
    lines.push(line(current))
    const body = field(current, 'responseBody')
    if (body && !lines.some((entry) => entry.includes(body))) lines.push(body)
    const fields = record(current)
    current = fields?.cause ?? fields?.lastError
  }

  const text = lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL)}…` : text
}

/**
 * The user-facing pair for anything that was thrown, from any layer.
 *
 * The vendor's own message goes in the detail rather than the summary: it is the most
 * useful line in a bug report and the least useful one on a screen, because it is written
 * for whoever called the API, not for whoever asked the question.
 *
 * `trace` is the transport's account of the last exchange, appended because some errors
 * describe themselves and some do not — AI_NoOutputGeneratedError carries no cause, no
 * status and no body.
 */
export const describeFailure = (error: unknown, trace?: string): Failure => {
  const failure = toAskError(error)
  const detail = [detailOf(error), trace?.trim()].filter(Boolean).join('\n\n')
  return { summary: SUMMARIES[failure.kind], detail, kind: failure.kind }
}
