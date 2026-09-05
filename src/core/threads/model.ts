import type { ModelRef } from '../providers/types.ts'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  text: string
  /** Which model produced an assistant message. */
  model?: ModelRef
  /** Set instead of text when the turn failed. One sentence, for the reader. */
  error?: string
  /**
   * The vendor's own words behind `error`: status, message, cause chain. Kept apart so
   * the bubble can stay short and still hand over everything a bug report needs.
   * Absent on threads written before this existed, which is why it is optional.
   */
  errorDetail?: string
  createdAt: number
}

export interface Thread {
  id: string
  /** First user message, trimmed. */
  title: string
  createdAt: number
  updatedAt: number
  messages: Message[]
}

export const MAX_THREADS = 200

export const newId = (): string =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

export const titleOf = (text: string): string => {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length > 80 ? `${t.slice(0, 79)}…` : t
}
