import { describe, expect, test } from 'bun:test'
import type { Credential, ProviderDef } from '../providers/types.ts'
import { buildModelOptions, isUsable, selectModel, usableProviders } from './select.ts'

const provider = (id: ProviderDef['id'], kind: ProviderDef['auth']['kind']): ProviderDef =>
  ({
    id,
    label: id,
    auth:
      kind === 'none'
        ? { kind: 'none' }
        : kind === 'apiKey'
          ? { kind: 'apiKey', help: '', placeholder: '' }
          : {
              kind: 'oauth',
              clientId: 'c',
              authorizeUrl: 'https://a',
              tokenUrl: 'https://t',
              scopes: [],
              redirect: { port: 1, path: '/cb' },
            },
    models: async () => [],
    createModel: () => {
      throw new Error('not used')
    },
  }) as ProviderDef

const key: Credential = { type: 'api', key: 'k' }

const ANTHROPIC = provider('anthropic', 'apiKey')
const OPENAI = provider('openai', 'apiKey')
const OLLAMA = provider('ollama', 'none')
const MODELS = {
  anthropic: [
    { id: 'a-1', label: 'A1' },
    { id: 'a-2', label: 'A2', default: true },
  ],
  openai: [{ id: 'o-1', label: 'O1', default: true }],
  ollama: [{ id: 'llama', label: 'Llama' }],
}

describe('isUsable', () => {
  test('a keyless provider is always usable', () => {
    expect(isUsable(OLLAMA, undefined)).toBe(true)
  })

  test('a key provider needs a credential', () => {
    expect(isUsable(ANTHROPIC, undefined)).toBe(false)
    expect(isUsable(ANTHROPIC, key)).toBe(true)
  })

  test('a "none" credential does not count as connected', () => {
    expect(isUsable(ANTHROPIC, { type: 'none' })).toBe(false)
  })
})

describe('usableProviders', () => {
  test('keeps registry order and drops the unconfigured', () => {
    const usable = usableProviders([ANTHROPIC, OPENAI, OLLAMA], { openai: key })
    expect(usable.map((p) => p.id)).toEqual(['openai', 'ollama'])
  })
})

describe('selectModel', () => {
  const providers = [ANTHROPIC, OPENAI, OLLAMA]

  test('returns nothing when no provider is usable', () => {
    expect(selectModel({ providers: [ANTHROPIC], credentials: {}, models: MODELS })).toBeUndefined()
  })

  test('honours a preference whose provider is still connected', () => {
    const ref = selectModel({
      preferred: 'anthropic:a-1',
      providers,
      credentials: { anthropic: key },
      models: MODELS,
    })
    expect(ref).toBe('anthropic:a-1')
  })

  test('abandons a preference whose provider lost its credential', () => {
    const ref = selectModel({
      preferred: 'anthropic:a-1',
      providers,
      credentials: { openai: key },
      models: MODELS,
    })
    expect(ref).toBe('openai:o-1')
  })

  test('falls back to the first usable provider default, in registry order', () => {
    const ref = selectModel({ providers, credentials: { anthropic: key }, models: MODELS })
    expect(ref).toBe('anthropic:a-2')
  })

  test('a running Ollama is enough on its own, with nothing connected', () => {
    // Reported: the "Connect a provider to start asking" warning stayed up even with a
    // local model selected. Ollama stores no credential, so any readiness test written
    // against credentials can never be satisfied by it. Readiness is "a model resolved".
    expect(
      selectModel({ providers: [ANTHROPIC, OPENAI, OLLAMA], credentials: {}, models: MODELS }),
    ).toBe('ollama:llama')
  })

  test('uses the first model when none is marked default', () => {
    const ref = selectModel({ providers: [OLLAMA], credentials: {}, models: MODELS })
    expect(ref).toBe('ollama:llama')
  })

  test('skips a usable provider whose catalog came back empty', () => {
    const ref = selectModel({
      providers,
      credentials: { anthropic: key, openai: key },
      models: { openai: MODELS.openai },
    })
    expect(ref).toBe('openai:o-1')
  })
})

describe('buildModelOptions', () => {
  const providers = [ANTHROPIC, OPENAI, OLLAMA]

  test('offers nothing when no provider is connected', () => {
    expect(buildModelOptions([ANTHROPIC, OPENAI], {}, MODELS)).toEqual([])
  })

  test('offers only the connected providers, in registry order', () => {
    const options = buildModelOptions(providers, { openai: key }, MODELS)
    expect(options.map((option) => option.ref)).toEqual(['openai:o-1', 'ollama:llama'])
  })

  test('hides a keyless provider that reports no models', () => {
    // Ollama needs no credential, so "connected" for it means actually running with
    // models pulled — which is exactly an empty catalog when it is not.
    expect(buildModelOptions(providers, {}, { ollama: [] })).toEqual([])
  })

  test('carries the provider label so the picker can group by it', () => {
    // Ollama is usable without a credential, so a connected Anthropic yields both.
    const options = buildModelOptions(providers, { anthropic: key }, MODELS)
    expect(options.map((option) => option.providerLabel)).toEqual([
      'anthropic',
      'anthropic',
      'ollama',
    ])
  })
})
