import { createOpenAI } from '@ai-sdk/openai'
import { readClaims, residencyOf } from '../auth/claims.ts'
import type { Ports } from '../ports.ts'
import type { CatalogModel } from './catalog.ts'
import { isChatModel, listCatalogModels } from './catalog.ts'
import { sdkFetch } from './sdk-fetch.ts'
import type { ModelDef, ProviderDef, Quirks } from './types.ts'

// Constants copied verbatim from opencode's ChatGPT OAuth (commit 5cf9f517cf).
// `originator` is the one deliberate change: we identify ourselves as pingask rather
// than impersonating opencode or the Codex CLI (PLAN.md decision #15).
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const ISSUER = 'https://auth.openai.com'
const REDIRECT_PORT = 1455
const REDIRECT_PATH = '/auth/callback'
const SCOPES = ['openid', 'profile', 'email', 'offline_access']

/** Non-standard params the Codex flow requires. Verbatim from opencode. */
const EXTRA_AUTHORIZE_PARAMS = {
  id_token_add_organizations: 'true',
  codex_cli_simplified_flow: 'true',
  originator: 'pingask',
}

/**
 * The ChatGPT backend, not the public API. @ai-sdk/openai@4's Responses model posts to
 * `${baseURL}/responses`, so this lands on the Codex endpoint with no fetch-level rewrite.
 */
const BASE_URL = 'https://chatgpt.com/backend-api/codex'

const QUIRKS: Quirks = {
  baseURL: BASE_URL,
  headers: { originator: 'pingask' },
}

/** opencode's allowlist confirms gpt-5.5 is served to ChatGPT plans. */
const DEFAULT_MODEL = 'gpt-5.5'

/** Only reached when models.dev is unreachable and nothing is cached. */
const FALLBACK: ModelDef[] = [
  { id: 'gpt-5.5', label: 'GPT-5.5' },
  { id: 'gpt-5.4', label: 'GPT-5.4' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini' },
]

/**
 * models.dev catalogs the OpenAI *API*, not what a ChatGPT plan is entitled to, and the
 * real entitlement list is not published. This approximates it — gpt-5.x, no `-pro`, no
 * `-codex` — so expect a model outside the plan to 403 at inference time.
 */
const isPlanModel = (model: CatalogModel, id: string): boolean =>
  isChatModel(model, id) && /^gpt-5\.\d/.test(id) && !/-pro$/.test(id) && !id.includes('-codex')

export const chatgptProvider: ProviderDef = {
  id: 'chatgpt',
  label: 'ChatGPT Plus/Pro',
  auth: {
    kind: 'oauth',
    clientId: CLIENT_ID,
    authorizeUrl: `${ISSUER}/oauth/authorize`,
    tokenUrl: `${ISSUER}/oauth/token`,
    scopes: SCOPES,
    redirect: { port: REDIRECT_PORT, path: REDIRECT_PATH },
    extraAuthorizeParams: EXTRA_AUTHORIZE_PARAMS,
  },
  quirks: QUIRKS,
  models: (ports: Ports) =>
    listCatalogModels(
      {
        catalogId: 'openai',
        defaultModel: DEFAULT_MODEL,
        fallback: FALLBACK,
        include: isPlanModel,
      },
      ports,
    ),
  createModel: (cred, modelId, ports) => {
    if (cred.type !== 'oauth') throw new Error('ChatGPT Plus/Pro needs an OAuth login.')
    // createOpenAI sends `Authorization: Bearer <apiKey>`, so the access token goes in as
    // the apiKey and no dummy is needed. The credential is refreshed before it reaches
    // here, and the model is built per request, so nothing goes stale.
    const headers: Record<string, string> = { ...QUIRKS.headers }
    // From the id_token's chatgpt_account_id claim: the backend rejects multi-org
    // accounts without it.
    if (cred.accountId) headers['ChatGPT-Account-Id'] = cred.accountId
    // A pinned account is only served by its own region's capacity. Absent (or
    // 'no_constraint') means the header must not be sent at all.
    const residency = residencyOf(readClaims(cred.access))
    if (residency) headers['x-openai-internal-codex-residency'] = residency
    // One conversation per turn: we build a model per turn and have no id to hand down,
    // which is what this means to a backend that stores nothing.
    headers['session-id'] = crypto.randomUUID()
    return createOpenAI({
      apiKey: cred.access,
      baseURL: BASE_URL,
      headers,
      fetch: sdkFetch(ports.fetch),
    }).responses(modelId)
  },
  /**
   * The Codex backend stores nothing, so `store: false` is pinned — leaving it out is not
   * neutral, the Responses default is `true`, which this endpoint cannot honour — and with
   * no server-side state the encrypted include is the only way a follow-up carries its
   * reasoning forward.
   *
   * The off state cannot borrow openai.ts's `reasoningEffort: 'none'`: that is API-only,
   * and 'low' is the floor this endpoint accepts. `reasoningSummary` is 'auto' because the
   * SDK's default of 'detailed' is served only to verified organisations.
   */
  providerOptions: (prefs) => ({
    openai: {
      store: false,
      include: ['reasoning.encrypted_content'],
      reasoningEffort: prefs.thinking ? 'medium' : 'low',
      reasoningSummary: 'auto',
    },
  }),
}
