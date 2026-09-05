import { describe, expect, test } from 'bun:test'
import type { ModelDef, ModelMap } from '../providers/types.ts'
import { buildProviderOptions, modelSupportsThinking } from './options.ts'

const MODELS: ModelMap = {
  anthropic: [
    { id: 'claude-sonnet-4-6', label: 'Sonnet', reasoning: true },
    { id: 'claude-haiku-3', label: 'Haiku' },
  ] satisfies ModelDef[],
  openai: [{ id: 'gpt-5.6', label: 'GPT-5.6', reasoning: true }],
  ollama: [{ id: 'llama3.2:latest', label: 'llama' }],
}

describe('modelSupportsThinking', () => {
  test('reads the catalog flag', () => {
    expect(modelSupportsThinking(MODELS, 'anthropic:claude-sonnet-4-6')).toBe(true)
    expect(modelSupportsThinking(MODELS, 'anthropic:claude-haiku-3')).toBe(false)
  })

  test('a model missing from the catalog is treated as not reasoning', () => {
    expect(modelSupportsThinking(MODELS, 'anthropic:something-new')).toBe(false)
    expect(modelSupportsThinking({}, 'anthropic:claude-sonnet-4-6')).toBe(false)
  })
})

describe('buildProviderOptions', () => {
  test('enables Anthropic thinking with a budget', () => {
    const options = buildProviderOptions('anthropic:claude-sonnet-4-6', { thinking: true }, MODELS)
    expect(options?.anthropic?.thinking).toEqual({ type: 'enabled', budgetTokens: 2048 })
  })

  test('sends nothing for Anthropic when thinking is off', () => {
    expect(
      buildProviderOptions('anthropic:claude-sonnet-4-6', { thinking: false }, MODELS),
    ).toBeUndefined()
  })

  test('a model that cannot reason ignores the preference', () => {
    // The toggle stays on while the user switches models; the request must not.
    expect(
      buildProviderOptions('anthropic:claude-haiku-3', { thinking: true }, MODELS),
    ).toBeUndefined()
  })

  test('OpenAI is told explicitly to spend no effort when thinking is off', () => {
    // Reasoning models default to a middling effort; 'none' is what keeps the
    // default path fast rather than merely unconfigured.
    expect(buildProviderOptions('openai:gpt-5.6', { thinking: false }, MODELS)).toEqual({
      openai: { reasoningEffort: 'none' },
    })
    expect(buildProviderOptions('openai:gpt-5.6', { thinking: true }, MODELS)).toEqual({
      openai: { reasoningEffort: 'low' },
    })
  })

  test('OpenAI models without a no-effort tier get their own floor', () => {
    // Regression: the gpt-5 line answers 400 to 'none' ("not supported with the
    // 'gpt-5-mini' model"), and the o-series has no 'minimal' either.
    expect(buildProviderOptions('openai:gpt-5-mini', { thinking: false }, MODELS)).toEqual({
      openai: { reasoningEffort: 'minimal' },
    })
    expect(buildProviderOptions('openai:gpt-5', { thinking: false }, MODELS)).toEqual({
      openai: { reasoningEffort: 'minimal' },
    })
    expect(buildProviderOptions('openai:o4-mini', { thinking: false }, MODELS)).toEqual({
      openai: { reasoningEffort: 'low' },
    })
    expect(buildProviderOptions('openai:gpt-5.1', { thinking: false }, MODELS)).toEqual({
      openai: { reasoningEffort: 'none' },
    })
  })

  test('Ollama always receives an explicit think flag', () => {
    expect(buildProviderOptions('ollama:llama3.2:latest', { thinking: false }, MODELS)).toEqual({
      ollama: { think: false },
    })
  })

  test('an unknown provider yields no options rather than throwing', () => {
    expect(
      buildProviderOptions('nope:whatever' as never, { thinking: true }, MODELS),
    ).toBeUndefined()
  })
})
