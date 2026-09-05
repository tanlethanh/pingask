import { describe, expect, test } from 'bun:test'
import { streamText } from 'ai'
import type { FetchLike } from '../ports.ts'
import { fakePorts } from '../testing/fakes.ts'
import { chatgptProvider } from './chatgpt.ts'
import type { Credential } from './types.ts'

const jwt = (payload: unknown): string => {
  const body = btoa(JSON.stringify(payload))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
  return `header.${body}.signature`
}

const credential = (access: string, accountId?: string): Credential => ({
  type: 'oauth',
  access,
  refresh: 'r',
  expires: Date.now() + 60_000,
  ...(accountId ? { accountId } : {}),
})

interface Sent {
  url: string
  headers: Headers
  body: Record<string, unknown>
}

/**
 * Runs one turn against a stub of the Codex endpoint and returns what went on the wire.
 * The stream is empty on purpose — the assertions are about the request, and streamText
 * keeps the resulting failure to itself once the promise is caught.
 */
const send = async (cred: Credential, thinking: boolean): Promise<Sent> => {
  let sent: Sent | undefined
  const fetch: FetchLike = async (input, init) => {
    sent = {
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    }
    return new Response('data: [DONE]\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    })
  }

  const model = chatgptProvider.createModel(cred, 'gpt-5.5', fakePorts({ fetch }))
  const result = streamText({
    model,
    messages: [{ role: 'user', content: 'hi' }],
    ...(chatgptProvider.providerOptions
      ? { providerOptions: chatgptProvider.providerOptions({ thinking }, 'gpt-5.5') }
      : {}),
    onError: () => {},
  })
  for await (const _ of result.fullStream) {
    // drained so the request completes
  }
  if (!sent) throw new Error('no request was made')
  return sent
}

describe('chatgpt provider', () => {
  test('posts to the Codex backend with the ChatGPT auth headers', async () => {
    const access = jwt({ chatgpt_account_id: 'acc_1' })
    const { url, headers } = await send(credential(access, 'acc_1'), false)

    expect(url).toBe('https://chatgpt.com/backend-api/codex/responses')
    expect(headers.get('authorization')).toBe(`Bearer ${access}`)
    expect(headers.get('chatgpt-account-id')).toBe('acc_1')
    expect(headers.get('originator')).toBe('pingask')
    expect(headers.get('session-id')).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('echoes a region-pinned account back as the residency header', async () => {
    const pinned = jwt({ 'https://api.openai.com/auth': { chatgpt_compute_residency: 'eu' } })
    const { headers } = await send(credential(pinned), false)
    expect(headers.get('x-openai-internal-codex-residency')).toBe('eu')
  })

  test('sends no residency header for an unconstrained account', async () => {
    const free = jwt({ chatgpt_compute_residency: 'no_constraint' })
    const { headers } = await send(credential(free), false)
    expect(headers.has('x-openai-internal-codex-residency')).toBe(false)
  })

  // The endpoint stores nothing, so `store` has to be explicit — the Responses
  // default is true — and reasoning can only carry over as the encrypted include.
  test('always asks for a stateless response', async () => {
    for (const thinking of [false, true]) {
      const { body } = await send(credential(jwt({})), thinking)
      expect(body.store).toBe(false)
      expect(body.include).toEqual(['reasoning.encrypted_content'])
    }
  })

  // 'none' is an API-only effort; the Codex efforts stop at 'minimal'. The summary
  // has to be explicit too — the SDK's default above 'none' is 'detailed', which is
  // for verified organisations only.
  test('never asks for reasoning the Codex backend does not serve', async () => {
    const off = await send(credential(jwt({})), false)
    const on = await send(credential(jwt({})), true)
    expect(off.body.reasoning).toEqual({ effort: 'low', summary: 'auto' })
    expect(on.body.reasoning).toEqual({ effort: 'medium', summary: 'auto' })
  })
})
