import { createAnthropic } from '@ai-sdk/anthropic'
import type { Ports } from '../ports.ts'
import { DEFAULT_MODEL, FALLBACK, MAX_OUTPUT_TOKENS, thinkingOptions } from './anthropic.ts'
import { isChatModel, listCatalogModels } from './catalog.ts'
import { sdkFetch } from './sdk-fetch.ts'
import type { ProviderDef, Quirks } from './types.ts'

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️  EVERY CONSTANT IN THIS BLOCK IS AN UNVERIFIED GUESS.
//
// opencode dropped Claude Pro/Max OAuth from its OSS tree, so unlike chatgpt.ts there is
// nothing to copy line-for-line. These endpoints, the client id, the port and the beta
// header come from public reports of what the Claude Code CLI sends.
//
// PLAN.md spike S3 owns proving them, and decision #3 covers the failure case: ship
// Claude via anthropic.ts (API key) and keep chatgpt.ts as the only OAuth provider.
// Do not treat anything here as load-bearing until S3 says so.
// ─────────────────────────────────────────────────────────────────────────────

const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize'
const TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token'
const REDIRECT_PORT = 54545
const REDIRECT_PATH = '/callback'
const SCOPES = ['org:create_api_key', 'user:profile', 'user:inference']

/**
 * Sent as its own system block ahead of the PingAsk prompt.
 *
 * UNVERIFIED: the `user:inference` scope is widely reported to reject requests that do
 * not identify themselves as Claude Code. If S3 shows it is not required, delete it —
 * it costs tokens and misidentifies us on every turn.
 */
const CLAUDE_CODE_SYSTEM_PREFIX = "You are Claude Code, Anthropic's official CLI for Claude."

const QUIRKS: Quirks = {
  headers: { 'anthropic-beta': 'oauth-2025-04-20' },
  systemPrefix: CLAUDE_CODE_SYSTEM_PREFIX,
  // Matters more than on the API-key path: a subscription is metered on Anthropic's
  // side, so a request reserving 128k of output is the one most likely to be turned
  // away before a single token is generated.
  maxOutputTokens: MAX_OUTPUT_TOKENS,
}

/** Dated snapshots duplicate their alias; a subscription picker only needs the alias. */
const isSubscriptionModel = (model: Parameters<typeof isChatModel>[0], id: string): boolean =>
  isChatModel(model, id) && !/-\d{8}$/.test(id)

export const claudeProvider: ProviderDef = {
  id: 'claude',
  label: 'Claude Pro/Max',
  auth: {
    kind: 'oauth',
    clientId: CLIENT_ID,
    authorizeUrl: AUTHORIZE_URL,
    tokenUrl: TOKEN_URL,
    scopes: SCOPES,
    redirect: { port: REDIRECT_PORT, path: REDIRECT_PATH },
    // Anthropic's token endpoint takes JSON and echoes `state` back on the exchange.
    // A form-encoded body is what produced "Token request failed: 400".
    tokenFormat: 'json',
    sendStateOnExchange: true,
  },
  quirks: QUIRKS,
  models: (ports: Ports) =>
    listCatalogModels(
      {
        catalogId: 'anthropic',
        defaultModel: DEFAULT_MODEL,
        fallback: FALLBACK,
        include: isSubscriptionModel,
      },
      ports,
    ),
  createModel: (cred, modelId, ports) => {
    if (cred.type !== 'oauth') throw new Error('Claude Pro/Max needs an OAuth login.')
    // `authToken` sends exactly `Authorization: Bearer <access>` and no `x-api-key`, so
    // no dummy apiKey is needed — and passing both is a hard error in @ai-sdk/anthropic@4.
    return createAnthropic({
      authToken: cred.access,
      headers: QUIRKS.headers,
      fetch: sdkFetch(ports.fetch),
    })(modelId)
  },
  providerOptions: thinkingOptions,
}
