import { describe, expect, test } from 'bun:test'
import type { FetchLike } from '../ports.ts'
import { fakePorts } from '../testing/fakes.ts'
import { ollamaProvider, TAGS_TIMEOUT_MS } from './ollama.ts'

/** Bun types `fetch` with a `preconnect` member; a bare handler is not assignable. */
const stubFetch = (
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): FetchLike => Object.assign(handler, { preconnect: () => {} })

const tagsFetch = (body: unknown, calls: string[] = []): FetchLike =>
  stubFetch(async (input) => {
    calls.push(String(input))
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })

describe('ollama models', () => {
  test('lists the installed tags, sorted, with the first as default', async () => {
    const calls: string[] = []
    const models = await ollamaProvider.models(
      fakePorts({
        fetch: tagsFetch(
          {
            models: [
              { name: 'qwen3:8b', model: 'qwen3:8b' },
              { name: 'llama3.2:latest', model: 'llama3.2:latest' },
            ],
          },
          calls,
        ),
      }),
    )

    expect(calls).toEqual(['http://localhost:11434/api/tags'])
    expect(models.map((m) => m.id)).toEqual(['llama3.2:latest', 'qwen3:8b'])
    expect(models.filter((m) => m.default)).toHaveLength(1)
    expect(models[0]?.default).toBe(true)
  })

  test('returns an empty list, not an error, when Ollama is not running', async () => {
    const fetch = stubFetch(async () => {
      throw new TypeError('connection refused')
    })
    expect(await ollamaProvider.models(fakePorts({ fetch }))).toEqual([])
  })

  test('returns an empty list on a non-200 or unusable body', async () => {
    const failing = stubFetch(async () => new Response('nope', { status: 500 }))
    expect(await ollamaProvider.models(fakePorts({ fetch: failing }))).toEqual([])
    expect(await ollamaProvider.models(fakePorts({ fetch: tagsFetch({}) }))).toEqual([])
    expect(await ollamaProvider.models(fakePorts({ fetch: tagsFetch({ models: [] }) }))).toEqual([])
  })
})

describe('ollama createModel', () => {
  test('needs no credential', () => {
    expect(ollamaProvider.auth.kind).toBe('none')
    const model = ollamaProvider.createModel({ type: 'none' }, 'qwen3:8b', fakePorts())
    expect(model).toMatchObject({ modelId: 'qwen3:8b' })
  })
})

describe('ollama request lifetime', () => {
  test('the abort signal never fires once the request has succeeded', async () => {
    // Regression: AbortSignal.timeout() fires even after the response is done, and
    // the Tauri http plugin never detaches its abort listeners — so a late abort
    // cancelled resources it had already released and the webview logged
    // "The resource id N is invalid." twice, once per rid.
    let captured: AbortSignal | undefined
    const fetch = stubFetch(async (_input, init) => {
      captured = init?.signal ?? undefined
      return new Response(JSON.stringify({ models: [{ model: 'llama3.2:latest' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    const models = await ollamaProvider.models(fakePorts({ fetch }))
    expect(models).toHaveLength(1)
    expect(captured).toBeDefined()
    expect(captured?.aborted).toBe(false)

    await Bun.sleep(TAGS_TIMEOUT_MS + 60)
    expect(captured?.aborted).toBe(false)
  })
})
