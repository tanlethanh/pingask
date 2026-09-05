import { describe, expect, test } from 'bun:test'
import { fakeStore } from '../testing/fakes.ts'
import { DEFAULT_SETTINGS } from './schema.ts'
import { createSettingsStore } from './store.ts'

describe('createSettingsStore', () => {
  test('returns the defaults when nothing is stored', async () => {
    expect(await createSettingsStore(fakeStore()).load()).toEqual(DEFAULT_SETTINGS)
  })

  test('merges what is stored over the defaults', async () => {
    const store = createSettingsStore(
      fakeStore({ settings: { model: 'anthropic:claude-sonnet-4-5' } }),
    )
    expect(await store.load()).toEqual({
      ...DEFAULT_SETTINGS,
      model: 'anthropic:claude-sonnet-4-5',
    })
  })

  test('save merges a patch, persists it and returns the result', async () => {
    const raw = fakeStore()
    const store = createSettingsStore(raw)

    const saved = await store.save({ keybinding: 'Alt+Space' })
    expect(saved).toEqual({ ...DEFAULT_SETTINGS, keybinding: 'Alt+Space' })

    await store.save({ followUpWords: 300 })
    expect(await store.load()).toEqual({
      ...DEFAULT_SETTINGS,
      keybinding: 'Alt+Space',
      followUpWords: 300,
    })
    expect(await createSettingsStore(raw).load()).toEqual(await store.load())
  })

  test('an explicit undefined in the patch clears an optional field', async () => {
    const store = createSettingsStore(fakeStore())
    await store.save({ model: 'openai:gpt-5', systemPrompt: 'be blunt' })

    const cleared = await store.save({ systemPrompt: undefined })
    expect(cleared.systemPrompt).toBeUndefined()
    expect(cleared.model).toBe('openai:gpt-5')
  })

  test('a patch that would blank a required field falls back to the default', async () => {
    const store = createSettingsStore(fakeStore())
    expect((await store.save({ keybinding: '  ' })).keybinding).toBe(DEFAULT_SETTINGS.keybinding)
    expect((await store.save({ firstAnswerWords: 0 })).firstAnswerWords).toBe(
      DEFAULT_SETTINGS.firstAnswerWords,
    )
  })

  describe('corrupt storage', () => {
    test('falls back to the defaults when the value is not an object', async () => {
      expect(await createSettingsStore(fakeStore({ settings: 'nonsense' })).load()).toEqual(
        DEFAULT_SETTINGS,
      )
    })

    test('keeps the good fields and defaults the bad ones', async () => {
      const store = createSettingsStore(
        fakeStore({
          settings: {
            keybinding: 'Alt+Space',
            firstAnswerWords: 'lots',
            followUpWords: -1,
            model: 'no-provider-separator',
            systemPrompt: '   ',
          },
        }),
      )
      expect(await store.load()).toEqual({ ...DEFAULT_SETTINGS, keybinding: 'Alt+Space' })
    })

    test('survives a store that throws on read', async () => {
      const store = createSettingsStore({
        get: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')),
        set: async () => {},
        delete: async () => {},
      })
      expect(await store.load()).toEqual(DEFAULT_SETTINGS)
      expect(await store.save({ keybinding: 'Alt+Space' })).toEqual({
        ...DEFAULT_SETTINGS,
        keybinding: 'Alt+Space',
      })
    })
  })
})
