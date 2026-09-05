import { describe, expect, test } from 'bun:test'
import { fakePorts } from '../testing/fakes.ts'
import { getProvider, listProviders, PROVIDERS, resolveModel } from './registry.ts'
import type { ProviderId } from './types.ts'
import { formatModelRef, parseModelRef } from './types.ts'

/** PLAN.md decision #14. A new entry here is a deliberate product decision. */
const EXPECTED_IDS: ProviderId[] = [
  'anthropic',
  'openai',
  'claude',
  'chatgpt',
  'openrouter',
  'ollama',
]

describe('registry', () => {
  test('covers exactly the providers in the plan', () => {
    expect(Object.keys(PROVIDERS).sort()).toEqual([...EXPECTED_IDS].sort())
  })

  test('every def is self-consistent and reachable through getProvider', () => {
    for (const id of EXPECTED_IDS) {
      const def = getProvider(id)
      expect(def.id).toBe(id)
      expect(def.label.length).toBeGreaterThan(0)
      expect(typeof def.models).toBe('function')
      expect(typeof def.createModel).toBe('function')
    }
    expect(listProviders()).toHaveLength(EXPECTED_IDS.length)
  })

  test('every oauth provider carries a full AuthDef', () => {
    for (const def of listProviders()) {
      if (def.auth.kind !== 'oauth') continue
      expect(def.auth.clientId.length).toBeGreaterThan(0)
      expect(def.auth.authorizeUrl.startsWith('https://')).toBe(true)
      expect(def.auth.tokenUrl.startsWith('https://')).toBe(true)
      expect(def.auth.scopes.length).toBeGreaterThan(0)
      expect(def.auth.redirect.port).toBeGreaterThan(0)
      expect(def.auth.redirect.path.startsWith('/')).toBe(true)
    }
  })

  test('every catalog-backed provider offers exactly one default model', async () => {
    // fakePorts.fetch throws, so this exercises the offline fallback path.
    for (const def of listProviders()) {
      // Ollama has no catalog: an empty list is the correct answer when the
      // daemon is not running. Covered in ollama.test.ts.
      if (def.id === 'ollama') continue
      const models = await def.models(fakePorts())
      expect(models.length).toBeGreaterThan(0)
      expect(models.filter((m) => m.default)).toHaveLength(1)
      expect(models[0]?.default).toBe(true)
      expect(new Set(models.map((m) => m.id)).size).toBe(models.length)
    }
  })
})

describe('model refs', () => {
  test('format and parse round-trip, including ids containing a colon', () => {
    const cases: Array<[ProviderId, string]> = [
      ['anthropic', 'claude-sonnet-4-6'],
      ['chatgpt', 'gpt-5.5'],
      ['openrouter', 'anthropic/claude-sonnet-4.6'],
      // Ollama tags embed a colon; the ref must split on the first one only.
      ['ollama', 'qwen3:8b'],
    ]
    for (const [provider, model] of cases) {
      expect(parseModelRef(formatModelRef(provider, model))).toEqual({ provider, model })
    }
  })

  test('formatModelRef produces the stored string form', () => {
    expect(formatModelRef('anthropic', 'claude-sonnet-4-6')).toBe('anthropic:claude-sonnet-4-6')
  })
})

describe('resolveModel', () => {
  test('builds an ai-SDK model for an api-key provider', () => {
    const model = resolveModel(
      'anthropic:claude-sonnet-4-6',
      { type: 'api', key: 'sk-ant-test' },
      fakePorts(),
    )
    expect(model).toMatchObject({ modelId: 'claude-sonnet-4-6' })
  })

  test('builds an ai-SDK model for an oauth provider', () => {
    const model = resolveModel(
      'chatgpt:gpt-5.5',
      { type: 'oauth', access: 'at', refresh: 'rt', expires: Date.now() + 60_000 },
      fakePorts(),
    )
    expect(model).toMatchObject({ modelId: 'gpt-5.5' })
  })

  test('rejects a credential of the wrong type', () => {
    expect(() =>
      resolveModel('anthropic:claude-sonnet-4-6', { type: 'none' }, fakePorts()),
    ).toThrow(/API key/)
    expect(() => resolveModel('chatgpt:gpt-5.5', { type: 'api', key: 'k' }, fakePorts())).toThrow(
      /OAuth/,
    )
  })

  test('rejects an unknown provider and a ref with no model id', () => {
    expect(() =>
      resolveModel('nope:some-model' as never, { type: 'api', key: 'k' }, fakePorts()),
    ).toThrow(/Unknown provider/)
    expect(() =>
      resolveModel('anthropic:' as never, { type: 'api', key: 'k' }, fakePorts()),
    ).toThrow(/missing a model id/)
  })
})
