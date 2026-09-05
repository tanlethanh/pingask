import type { JSONValue, LanguageModel } from 'ai'
import type { Ports } from '../ports.ts'

export type ProviderId = 'anthropic' | 'openai' | 'claude' | 'chatgpt' | 'openrouter' | 'ollama'

/** How a provider is authenticated. Drives both the settings UI and the OAuth engine. */
export type AuthDef =
  | { kind: 'apiKey'; help: string; placeholder: string; envVar?: string }
  | {
      kind: 'oauth'
      clientId: string
      authorizeUrl: string
      tokenUrl: string
      scopes: string[]
      redirect: { port: number; path: string }
      /** Non-standard params some vendors require (e.g. codex_cli_simplified_flow). */
      extraAuthorizeParams?: Record<string, string>
      /**
       * How the token request is encoded. OAuth 2 specifies form; Anthropic's endpoint
       * wants JSON and answers 400 to a form body.
       */
      tokenFormat?: 'form' | 'json'
      /** Anthropic echoes `state` back on the exchange; most vendors reject the extra. */
      sendStateOnExchange?: boolean
    }
  | { kind: 'none' }

/** A stored credential. Persisted as-is into auth.json. */
export type Credential =
  | { type: 'oauth'; refresh: string; access: string; expires: number; accountId?: string }
  | { type: 'api'; key: string }
  | { type: 'none' }

/** What auth.json holds: one credential per configured provider. */
export type CredentialMap = Partial<Record<ProviderId, Credential>>

export interface ModelDef {
  id: string
  label: string
  /** Chosen when the user has not picked one. Exactly one per provider. */
  default?: boolean
  /** Model can reason before answering. From models.dev's `reasoning` flag. */
  reasoning?: boolean
}

/** Every provider's catalog, as loaded by useModels. */
export type ModelMap = Partial<Record<ProviderId, readonly ModelDef[]>>

/**
 * Generation settings the user controls, independent of provider. An object rather than
 * loose arguments, so the next one does not change every provider signature.
 */
export interface ModelPrefs {
  /**
   * Extended thinking. Off by default: it trades seconds of latency for depth, and this
   * app exists to put a short answer on screen immediately.
   */
  thinking: boolean
}

/**
 * What the ai SDK accepts as `providerOptions`: a provider id mapped to a JSON object.
 * Typed with the SDK's own JSONValue, so an unserialisable mapping fails here.
 */
export type ProviderOptions = Record<string, Record<string, JSONValue>>

/** Per-vendor deviations. Named fields, never scattered conditionals. */
export interface Quirks {
  headers?: Record<string, string>
  baseURL?: string
  /** Prepended as its own system block before the PingAsk prompt. */
  systemPrefix?: string
  /**
   * Ceiling for one answer, when the vendor's own default is the wrong number. Per
   * provider rather than global: Anthropic needs one (see anthropic.ts) and the Codex
   * endpoint wants none at all.
   */
  maxOutputTokens?: number
}

export interface ProviderDef {
  readonly id: ProviderId
  readonly label: string
  readonly auth: AuthDef
  readonly quirks?: Quirks
  /** Model list. Sourced from models.dev where possible, static fallback otherwise. */
  models(ports: Ports): Promise<ModelDef[]>
  /** Build an ai-SDK model. Dummy apiKey + bearer header for oauth credentials. */
  createModel(cred: Credential, modelId: string, ports: Ports): LanguageModel
  /**
   * Translate the user's preferences into this vendor's `providerOptions` shape.
   * Only called for models that advertise the capability; return undefined when
   * there is nothing to send.
   */
  providerOptions?(prefs: ModelPrefs, modelId: string): ProviderOptions | undefined
}

/** One entry in the model picker, grouped under `providerLabel`. */
export interface ModelOption {
  ref: ModelRef
  label: string
  providerLabel: string
}

/** "anthropic:claude-sonnet-4-5" — the single id stored in settings and threads. */
export type ModelRef = `${ProviderId}:${string}`

export const parseModelRef = (ref: ModelRef): { provider: ProviderId; model: string } => {
  const i = ref.indexOf(':')
  return { provider: ref.slice(0, i) as ProviderId, model: ref.slice(i + 1) }
}

export const formatModelRef = (provider: ProviderId, model: string): ModelRef =>
  `${provider}:${model}` as ModelRef
