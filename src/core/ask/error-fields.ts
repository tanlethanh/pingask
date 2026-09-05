// Reading a thrown thing.
//
// Providers throw Errors, plain objects and SSE error payloads alike, and every layer
// that has to report a failure reaches for the same handful of fields.

export const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined

/** The error's own message, or '' when it carries none. Callers supply the fallback. */
export const messageOf = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  const message = record(error)?.message
  return typeof message === 'string' ? message : ''
}

export const nameOf = (error: unknown): string => {
  const name = record(error)?.name
  return typeof name === 'string' && name ? name : 'Error'
}

/** A field as text. Numbers are stringified — `statusCode` arrives as both. */
export const field = (error: unknown, key: string): string | undefined => {
  const value = record(error)?.[key]
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number') return String(value)
  return undefined
}

export const statusOf = (error: unknown): number | undefined => {
  const fields = record(error)
  if (typeof fields?.statusCode === 'number') return fields.statusCode
  if (typeof fields?.status === 'number') return fields.status
  return undefined
}

/** One line, whitespace collapsed, capped. */
export const oneLine = (text: string, limit: number): string =>
  text.trim().replace(/\s+/g, ' ').slice(0, limit)
