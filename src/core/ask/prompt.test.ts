import { describe, expect, test } from 'bun:test'
import { DEFAULT_SETTINGS, type Settings } from '../settings/schema.ts'
import { buildSystemPrompt } from './prompt.ts'

const settings = (patch?: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...patch })

describe('buildSystemPrompt', () => {
  test('the first answer is held to firstAnswerWords', () => {
    const [prompt] = buildSystemPrompt({ settings: settings(), turnIndex: 0 })
    expect(prompt).toContain(`MAX ${DEFAULT_SETTINGS.firstAnswerWords} WORDS`)
    expect(prompt).not.toContain(String(DEFAULT_SETTINGS.followUpWords))
    expect(prompt).not.toContain('follow-up')
  })

  test('follow-ups get the looser followUpWords budget', () => {
    const [prompt] = buildSystemPrompt({ settings: settings(), turnIndex: 1 })
    expect(prompt).toContain(`MAX ${DEFAULT_SETTINGS.followUpWords} WORDS`)
    expect(prompt).toContain('follow-up')
    expect(prompt).not.toContain(`MAX ${DEFAULT_SETTINGS.firstAnswerWords} WORDS`)
  })

  test('the budgets come from settings, not from constants', () => {
    const custom = settings({ firstAnswerWords: 42, followUpWords: 999 })
    expect(buildSystemPrompt({ settings: custom, turnIndex: 0 })[0]).toContain('MAX 42 WORDS')
    expect(buildSystemPrompt({ settings: custom, turnIndex: 5 })[0]).toContain('MAX 999 WORDS')
  })

  test('both variants keep the v1 rules', () => {
    for (const turnIndex of [0, 1]) {
      const [prompt = ''] = buildSystemPrompt({ settings: settings(), turnIndex })
      expect(prompt).toContain('fenced code block')
      expect(prompt).toContain('NO assumptions/guessing')
      expect(prompt).toContain("'How to' question")
    }
  })

  test('a provider systemPrefix comes first, as its own block', () => {
    const blocks = buildSystemPrompt({
      settings: settings(),
      turnIndex: 0,
      quirks: { systemPrefix: "You are Claude Code, Anthropic's official CLI for Claude." },
    })
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toBe("You are Claude Code, Anthropic's official CLI for Claude.")
    expect(blocks[1]).toContain(`MAX ${DEFAULT_SETTINGS.firstAnswerWords} WORDS`)
  })

  test('without quirks there is exactly one block', () => {
    expect(buildSystemPrompt({ settings: settings(), turnIndex: 0 })).toHaveLength(1)
    expect(buildSystemPrompt({ settings: settings(), turnIndex: 0, quirks: {} })).toHaveLength(1)
  })

  test('a user systemPrompt replaces the built-in one but not the prefix', () => {
    const blocks = buildSystemPrompt({
      settings: settings({ systemPrompt: 'Answer in haiku.' }),
      turnIndex: 3,
      quirks: { systemPrefix: 'vendor preamble' },
    })
    expect(blocks).toEqual(['vendor preamble', 'Answer in haiku.'])
  })

  test('a blank user systemPrompt is ignored', () => {
    const [prompt] = buildSystemPrompt({
      settings: settings({ systemPrompt: '   ' }),
      turnIndex: 0,
    })
    expect(prompt).toContain(`MAX ${DEFAULT_SETTINGS.firstAnswerWords} WORDS`)
  })
})
