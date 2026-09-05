import { useCallback, useRef, useState } from 'react'
import { describeFailure } from '../core/ask/failure.ts'
import { buildProviderOptions } from '../core/ask/options.ts'
import { buildSystemPrompt } from '../core/ask/prompt.ts'
import { askStream } from '../core/ask/stream.ts'
import { createTracer, type Tracer } from '../core/net/trace.ts'
import type { Ports } from '../core/ports.ts'
import { getProvider, resolveModel } from '../core/providers/registry.ts'
import {
  type Credential,
  type ModelMap,
  type ModelRef,
  type ProviderId,
  parseModelRef,
} from '../core/providers/types.ts'
import type { Settings } from '../core/settings/schema.ts'
import { type Message, newId, type Thread, titleOf } from '../core/threads/model.ts'

export interface UseAskOptions {
  ports: Ports
  settings: Settings
  modelRef?: ModelRef
  /** Per-provider catalogs, used to check whether the model can actually reason. */
  modelCatalog: ModelMap
  /** Refreshes an OAuth token if it is about to expire. From useCredentials. */
  ensure: (providerId: ProviderId) => Promise<Credential>
  /** Called once a turn completes, successfully or not. */
  onPersist: (thread: Thread) => void
}

export interface UseAsk {
  thread: Thread
  streaming: boolean
  error?: string
  ask: (question: string) => Promise<void>
  /** Stops the stream but keeps whatever text arrived. */
  abort: () => void
  /** Back to an empty thread. */
  reset: () => void
  /** Attach a failure that escaped `ask`, so it lands on the turn it belongs to. */
  report: (error: unknown) => void
  /** Continue an existing thread from history. */
  open: (thread: Thread) => void
}

export const emptyThread = (): Thread => {
  const now = Date.now()
  return { id: newId(), title: '', createdAt: now, updatedAt: now, messages: [] }
}

export const useAsk = ({
  ports,
  settings,
  modelRef,
  modelCatalog,
  ensure,
  onPersist,
}: UseAskOptions): UseAsk => {
  const [thread, setThread] = useState<Thread>(emptyThread)
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const abortRef = useRef<AbortController | undefined>(undefined)
  // The transport the current turn is running on. AI_NoOutputGeneratedError carries no
  // cause, no status and no body; the tracer knows which request failed and how, and it
  // outlives the turn so a late rejection is still described.
  const tracerRef = useRef<Tracer | undefined>(undefined)
  // The transcript is re-rendered per delta; this is the authoritative copy that the
  // persist call reads, so a trailing setState never races the save.
  const liveRef = useRef<Thread>(thread)

  const commit = useCallback((next: Thread) => {
    liveRef.current = next
    setThread(next)
  }, [])

  const ask = useCallback(
    async (question: string) => {
      const text = question.trim()
      if (!text || streaming) return
      if (!modelRef) {
        setError('Connect a provider in settings first.')
        return
      }

      setError(undefined)
      const now = Date.now()
      const current = liveRef.current
      const user: Message = { id: newId(), role: 'user', text, createdAt: now }
      const assistant: Message = {
        id: newId(),
        role: 'assistant',
        text: '',
        model: modelRef,
        createdAt: now,
      }

      // turnIndex counts answers already given: 0 makes this the terse first answer,
      // 1+ opens the budget up for a follow-up (PLAN #16).
      const turnIndex = current.messages.filter((message) => message.role === 'assistant').length
      const started: Thread = {
        ...current,
        title: current.title || titleOf(text),
        updatedAt: now,
        messages: [...current.messages, user, assistant],
      }
      commit(started)
      setStreaming(true)

      const controller = new AbortController()
      abortRef.current = controller

      const patchAssistant = (patch: Partial<Message>) => {
        const live = liveRef.current
        commit({
          ...live,
          updatedAt: Date.now(),
          messages: live.messages.map((message) =>
            message.id === assistant.id ? { ...message, ...patch } : message,
          ),
        })
      }

      const tracer = createTracer(ports.fetch)
      tracerRef.current = tracer

      try {
        const { provider: providerId } = parseModelRef(modelRef)
        const provider = getProvider(providerId)
        const credential = await ensure(providerId)
        const model = resolveModel(modelRef, credential, { ...ports, fetch: tracer.fetch })
        const system = buildSystemPrompt({ settings, turnIndex, quirks: provider.quirks })
        const providerOptions = buildProviderOptions(
          modelRef,
          { thinking: settings.thinking },
          modelCatalog,
        )

        let accumulated = ''
        await askStream({
          model,
          system,
          messages: [...current.messages, user],
          signal: controller.signal,
          ...(providerOptions ? { providerOptions } : {}),
          ...(provider.quirks?.maxOutputTokens
            ? { maxOutputTokens: provider.quirks.maxOutputTokens }
            : {}),
          onChunk: (delta) => {
            accumulated += delta
            patchAssistant({ text: accumulated })
          },
        })
      } catch (cause) {
        const failure = describeFailure(cause, tracer.describe())
        // An abort keeps the partial answer — the user stopped it on purpose.
        if (failure.kind !== 'aborted') {
          patchAssistant({ error: failure.summary, errorDetail: failure.detail })
          setError(failure.summary)
        }
      } finally {
        abortRef.current = undefined
        setStreaming(false)
        onPersist(liveRef.current)
      }
    },
    [commit, ensure, modelCatalog, modelRef, onPersist, ports, settings, streaming],
  )

  const abort = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  /**
   * Only the turn that has nothing to show is overwritten: a late rejection must not
   * replace an answer that already streamed in, or the error the catch above wrote — both
   * know more about what happened than a stray rejection does.
   */
  const report = useCallback(
    (error: unknown) => {
      const failure = describeFailure(error, tracerRef.current?.describe())
      if (failure.kind === 'aborted') return
      console.error(`[pingask] ${failure.summary}\n${failure.detail}`)
      const live = liveRef.current
      const blank = live.messages.findLast(
        (message) => message.role === 'assistant' && !message.text && !message.error,
      )
      if (!blank) {
        setError(failure.summary)
        return
      }
      commit({
        ...live,
        messages: live.messages.map((message) =>
          message.id === blank.id
            ? { ...message, error: failure.summary, errorDetail: failure.detail }
            : message,
        ),
      })
    },
    [commit],
  )

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setError(undefined)
    commit(emptyThread())
  }, [commit])

  const open = useCallback(
    (existing: Thread) => {
      abortRef.current?.abort()
      setError(undefined)
      commit({ ...existing, messages: [...existing.messages] })
    },
    [commit],
  )

  return { thread, streaming, error, ask, abort, reset, open, report }
}
