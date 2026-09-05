import { describe, expect, test } from 'bun:test'
import type { Credential } from '../providers/types.ts'
import { fakeStore } from '../testing/fakes.ts'
import { createCredentialStore, parseCredential } from './store.ts'

const oauth: Credential = {
  type: 'oauth',
  access: 'access-1',
  refresh: 'refresh-1',
  expires: 1_800_000_000_000,
  accountId: 'acct_1',
}

describe('createCredentialStore', () => {
  test('round-trips an api credential', async () => {
    const creds = createCredentialStore(fakeStore())
    await creds.set('openai', { type: 'api', key: 'sk-test' })
    expect(await creds.get('openai')).toEqual({ type: 'api', key: 'sk-test' })
  })

  test('round-trips an oauth credential', async () => {
    const creds = createCredentialStore(fakeStore())
    await creds.set('chatgpt', oauth)
    expect(await creds.get('chatgpt')).toEqual(oauth)
  })

  test('returns undefined for a provider that was never stored', async () => {
    const creds = createCredentialStore(fakeStore())
    expect(await creds.get('claude')).toBeUndefined()
  })

  test('keeps providers independent', async () => {
    const creds = createCredentialStore(fakeStore())
    await creds.set('openai', { type: 'api', key: 'sk-a' })
    await creds.set('anthropic', { type: 'api', key: 'sk-b' })
    expect(await creds.all()).toEqual({
      openai: { type: 'api', key: 'sk-a' },
      anthropic: { type: 'api', key: 'sk-b' },
    })
  })

  test('set overwrites in place', async () => {
    const creds = createCredentialStore(fakeStore())
    await creds.set('openai', { type: 'api', key: 'sk-a' })
    await creds.set('openai', { type: 'api', key: 'sk-b' })
    expect(await creds.get('openai')).toEqual({ type: 'api', key: 'sk-b' })
  })

  test('remove drops one provider and leaves the rest', async () => {
    const creds = createCredentialStore(fakeStore())
    await creds.set('openai', { type: 'api', key: 'sk-a' })
    await creds.set('chatgpt', oauth)
    await creds.remove('chatgpt')
    expect(await creds.get('chatgpt')).toBeUndefined()
    expect(await creds.get('openai')).toEqual({ type: 'api', key: 'sk-a' })
  })

  test('remove on an empty store is a no-op', async () => {
    const creds = createCredentialStore(fakeStore())
    await creds.remove('ollama')
    expect(await creds.all()).toEqual({})
  })

  test('all is empty when the file has never been written', async () => {
    expect(await createCredentialStore(fakeStore()).all()).toEqual({})
  })

  test('drops entries that do not parse instead of throwing', async () => {
    const creds = createCredentialStore(
      fakeStore({
        credentials: {
          openai: { type: 'api', key: 'sk-good' },
          anthropic: { type: 'api' },
          chatgpt: { type: 'oauth', access: 'a', refresh: 'r', expires: 'soon' },
          claude: 'not-an-object',
          ollama: null,
        },
      }),
    )
    expect(await creds.all()).toEqual({ openai: { type: 'api', key: 'sk-good' } })
  })

  test('survives a corrupt top-level value', async () => {
    const creds = createCredentialStore(fakeStore({ credentials: 'garbage' }))
    expect(await creds.all()).toEqual({})
    await creds.set('openai', { type: 'api', key: 'sk-a' })
    expect(await creds.get('openai')).toEqual({ type: 'api', key: 'sk-a' })
  })
})

describe('parseCredential', () => {
  test('accepts each variant of the union', () => {
    expect(parseCredential({ type: 'api', key: 'k' })).toEqual({ type: 'api', key: 'k' })
    expect(parseCredential({ type: 'none' })).toEqual({ type: 'none' })
    expect(parseCredential(oauth)).toEqual(oauth)
  })

  test('makes accountId optional', () => {
    const { accountId: _drop, ...rest } = oauth as Extract<Credential, { type: 'oauth' }>
    expect(parseCredential(rest)).toEqual({ ...rest, accountId: undefined })
  })

  test('rejects unknown and malformed shapes', () => {
    expect(parseCredential({ type: 'wellknown', key: 'k', token: 't' })).toBeUndefined()
    expect(parseCredential({ type: 'oauth', access: 'a', refresh: 'r' })).toBeUndefined()
    expect(parseCredential({ type: 'oauth', access: 1, refresh: 'r', expires: 2 })).toBeUndefined()
    expect(parseCredential({ type: 'api', key: 42 })).toBeUndefined()
    expect(parseCredential(undefined)).toBeUndefined()
    expect(parseCredential([])).toBeUndefined()
  })
})
