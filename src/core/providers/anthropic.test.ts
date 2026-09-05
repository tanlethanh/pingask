import { describe, expect, test } from 'bun:test'
import { streamText } from 'ai'
import type { FetchLike } from '../ports.ts'
import { fakePorts } from '../testing/fakes.ts'
import { anthropicProvider, MAX_OUTPUT_TOKENS } from './anthropic.ts'
import { claudeProvider } from './claude.ts'
import type { Credential, ProviderDef } from './types.ts'

const MODEL = 'claude-sonnet-4-6'

/** Runs one turn against a stub of the Messages API and returns the request body. */
const send = async (
  provider: ProviderDef,
  cred: Credential,
  thinking: boolean,
): Promise<Record<string, unknown>> => {
  let body: Record<string, unknown> | undefined
  const fetch: FetchLike = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response('', { headers: { 'content-type': 'text/event-stream' } })
  }

  const result = streamText({
    model: provider.createModel(cred, MODEL, fakePorts({ fetch })),
    messages: [{ role: 'user', content: 'hi' }],
    ...(provider.quirks?.maxOutputTokens
      ? { maxOutputTokens: provider.quirks.maxOutputTokens }
      : {}),
    ...(provider.providerOptions
      ? { providerOptions: provider.providerOptions({ thinking }, MODEL) }
      : {}),
    onError: () => {},
  })
  for await (const _ of result.fullStream) {
    // drained so the request completes
  }
  if (!body) throw new Error('no request was made')
  return body
}

const apiKey: Credential = { type: 'api', key: 'sk-ant-test' }
const oauth: Credential = {
  type: 'oauth',
  access: 'access-token',
  refresh: 'r',
  expires: Date.now() + 60_000,
}

describe('anthropic max_tokens', () => {
  // Anthropic makes the field mandatory, so omitting it does not mean "no ceiling" — the
  // SDK fills in the model's absolute one (128k on Sonnet), which is both far past any
  // answer this app asks for and past what Anthropic serves without the 128k-output beta.
  test('asks for a budget this app could plausibly spend', async () => {
    expect(MAX_OUTPUT_TOKENS).toBeLessThan(64_000)
    const body = await send(anthropicProvider, apiKey, false)
    expect(body.max_tokens).toBe(MAX_OUTPUT_TOKENS)
  })

  test('the subscription path carries the same ceiling', async () => {
    const body = await send(claudeProvider, oauth, false)
    expect(body.max_tokens).toBe(MAX_OUTPUT_TOKENS)
  })

  // The API rejects a request whose max_tokens does not exceed the thinking budget.
  test('leaves room for the scratchpad when thinking is on', async () => {
    for (const [provider, cred] of [
      [anthropicProvider, apiKey],
      [claudeProvider, oauth],
    ] as const) {
      const body = await send(provider, cred, true)
      const budget = (body.thinking as { budget_tokens: number }).budget_tokens
      expect(body.max_tokens).toBeGreaterThan(budget)
    }
  })
})

describe('claude subscription request', () => {
  test('sends the OAuth bearer and beta header, and no API key', async () => {
    let headers: Headers | undefined
    const fetch: FetchLike = async (_input, init) => {
      headers = new Headers(init?.headers)
      return new Response('', { headers: { 'content-type': 'text/event-stream' } })
    }
    const model = claudeProvider.createModel(oauth, MODEL, fakePorts({ fetch }))
    const result = streamText({
      model,
      messages: [{ role: 'user', content: 'hi' }],
      onError: () => {},
    })
    for await (const _ of result.fullStream) {
      // drained so the request completes
    }
    expect(headers?.get('authorization')).toBe('Bearer access-token')
    expect(headers?.get('anthropic-beta')).toBe('oauth-2025-04-20')
    // Passing both is a hard error in @ai-sdk/anthropic@4, so this is load-bearing.
    expect(headers?.has('x-api-key')).toBe(false)
  })
})

// The browser-access header is deliberately gone: `core/net/origin.ts` removes the Origin
// that made Anthropic classify us as a browser, so there is no browser rule left to opt
// out of — and the opt-out did not help anyway against an organisation that disallows
// browser traffic outright.
describe('anthropic browser access', () => {
  test('neither provider claims direct browser access', async () => {
    for (const [provider, cred] of [
      [anthropicProvider, apiKey],
      [claudeProvider, oauth],
    ] as const) {
      let headers: Headers | undefined
      const fetch: FetchLike = async (_input, init) => {
        headers = new Headers(init?.headers)
        return new Response('', { headers: { 'content-type': 'text/event-stream' } })
      }
      const result = streamText({
        model: provider.createModel(cred, MODEL, fakePorts({ fetch })),
        messages: [{ role: 'user', content: 'hi' }],
        onError: () => {},
      })
      for await (const _ of result.fullStream) {
        // drained so the request completes
      }
      expect(headers?.has('anthropic-dangerous-direct-browser-access')).toBe(false)
    }
  })
})
