import type { Quirks } from '../providers/types.ts'
import type { Settings } from '../settings/schema.ts'

export interface SystemPromptInput {
  settings: Settings
  /** 0 for the first answer in a thread, 1+ for follow-ups. */
  turnIndex: number
  quirks?: Quirks
}

/**
 * Ported from the v1 worker. The rules are the same in both variants — only the budget
 * and the room to expand move.
 */
const firstAnswer = (words: number): string =>
  [
    `Give an ultra-concise answer. MAX ${words} WORDS.`,
    '- Quick fact/command question: give only the short, essential answer.',
    "- 'How to' question: give short brief steps.",
    '- General question: give a concise but thorough answer.',
    'Code and commands must be wrapped in a fenced code block.',
    'NO assumptions/guessing — say what you do not know.',
  ].join('\n')

const followUp = (words: number): string =>
  [
    `This is a follow-up in an ongoing thread. Stay tight, but you have room: MAX ${words} WORDS.`,
    'Build on the earlier turns. Do not repeat what has already been answered.',
    '- Quick fact/command question: give only the short, essential answer.',
    "- 'How to' question: give brief steps.",
    '- General question: answer thoroughly, without padding.',
    'Code and commands must be wrapped in a fenced code block.',
    'NO assumptions/guessing — say what you do not know.',
  ].join('\n')

/**
 * The system blocks for one turn, in order. Some providers require their own
 * preamble as the first block, so this returns an array rather than a string.
 */
export const buildSystemPrompt = ({ settings, turnIndex, quirks }: SystemPromptInput): string[] => {
  const blocks: string[] = []
  if (quirks?.systemPrefix) blocks.push(quirks.systemPrefix)
  blocks.push(
    settings.systemPrompt?.trim() ||
      (turnIndex <= 0 ? firstAnswer(settings.firstAnswerWords) : followUp(settings.followUpWords)),
  )
  return blocks
}
