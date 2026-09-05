# PingAsk v2 — rewrite plan

Decided 2026-09-05 via design interview. Every row below is a settled decision; deviating from one
means re-opening it deliberately, not drifting.

## Decisions

| # | Area | Decision |
|---|------|----------|
| 1 | Scope | Parity with v1 **plus multi-turn follow-up**. No clipboard/screenshot/MCP. |
| 2 | Rust | **Zero custom commands.** `lib.rs` is builder + `.plugin()` lines only. No `#[tauri::command]` ever. One amendment (2026-09-05): a `.setup()` that sets `ActivationPolicy::Accessory`, because tao overrides `LSUIElement` at launch and no config key or JS API exists. See S-Dock below. |
| 3 | Auth model | BYO API key is the default and guaranteed path; OAuth subscription is a second credential type behind the same interface. |
| 4 | Inference | Vercel **`ai` SDK v7** (`ai@7`, `@ai-sdk/anthropic@4`, `@ai-sdk/openai@4`). Not hand-rolled. |
| 5 | Transport | `@tauri-apps/plugin-http` `fetch` injected into every provider factory. No CORS, allowlist in `capabilities/`. |
| 6 | OAuth callback | `@fabianlars/tauri-plugin-oauth` loopback on the vendor's pinned port. |
| 7 | Secrets | **Plaintext `auth.json`** in app data dir. No keychain — both Tauri keychain plugins are dead (last published Nov/Dec 2024). Matches opencode, claude, codex, gh. |
| 8 | Data model | `Thread{id,title,createdAt,updatedAt,messages[]}` in `threads.json` via `tauri-plugin-store`. One repository module owns all IO. |
| 9 | Window UX | One window. Grows to fit, capped ~640px, then transcript scrolls internally. |
| 10 | Lifecycle | Hotkey opens fresh, except an unasked question, which is kept. Esc unwinds one step: streaming→abort, thread→back to an empty panel, empty→hide. Reopen from history to continue. |
| 11 | Layout | Tauri project **at root**. Old code moved to `ref/{app,api}`, excluded from build. No `app/`. |
| 12 | Build | **Full Bun.** `bun ./index.html` dev server, `bun build` release. No Vite. |
| 13 | Structure | Layered `core/` `platform/` `ui/`. **`@tauri-apps/*` may only be imported inside `platform/`.** |
| 14 | Providers | Anthropic (key), OpenAI (key), Claude (oauth), ChatGPT (oauth), OpenRouter (key), Ollama (none). |
| 15 | Provider API | opencode's shape **minus Effect**: one plain `ProviderDef` object per file, hand-rolled PKCE, models.dev catalog. |
| 16 | Prompt | Terse first answer (~100 words). Follow-ups looser (~250). Two variants in `core/ask/prompt.ts`. |
| 17 | Ship | macOS only. `bun test` over `core/`. Biome + `tsc --noEmit` (TypeScript **7.0.2**). Signing + notarization + updater included. |

## What we learned from opencode (`~/oss/opencode`)

Read at commit `5cf9f517cf`. Findings that shaped the decisions above:

- They **kept the `ai` SDK** — 19 pinned `@ai-sdk/*` deps — and added a native protocol layer
  (`@opencode-ai/llm`) only for cache-control and streaming control. We skip the native layer.
- `provider/anthropic.ts` is **27 lines**: inject `anthropic-beta` headers, lazy-import `createAnthropic`.
  `provider/openai.ts` is 292 only because it carries a full OAuth flow.
- **No OAuth library.** PKCE is 6 lines of `crypto.getRandomValues` + `crypto.subtle.digest("SHA-256")`.
  Exchange and refresh are ~25 lines of `fetch` + `URLSearchParams`. `oauth4webapi` is not used.
- Credentials live in plaintext `auth.json` at mode `0600`, as a discriminated union
  `{type:"oauth",refresh,access,expires} | {type:"api",key} | {type:"wellknown"}`.
- `OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"` — a dummy `apiKey` goes to the SDK factory, the real
  bearer is injected via header. Confirms the approach in decision #5.
- Each OAuth provider ships **two modes**: browser loopback on the pinned port with a rendered
  success/error HTML page, and a device-code fallback for headless.
- They send `originator: "opencode"` in the authorize URL — identify yourself, don't impersonate.
- Model catalog is **fetched from models.dev** and cached to disk, never hardcoded.
- **Claude Pro/Max OAuth is not in the OSS tree.** i18n keys exist, `35b03e4cb3 claude oauth support`
  is in history from Jun 2025, but today only ChatGPT and opencode-console register OAuth methods.
  ChatGPT OAuth is copyable line-for-line; **Claude OAuth we own entirely** (see S3).

## Target tree

```
pingask/
  index.html
  package.json            # single, bun
  bun.lock
  biome.json
  src/
    main.tsx  app.tsx     # composition only
    ui/                   # dumb components
      spotlight.tsx  input.tsx  transcript.tsx
      message.tsx    history-list.tsx  settings/
    hooks/                # thin React bindings
      use-ask.ts  use-threads.ts  use-settings.ts
    core/                 # pure TS. no React, no Tauri. bun-testable.
      providers/  types.ts registry.ts catalog.ts
                  anthropic.ts openai.ts claude.ts
                  chatgpt.ts openrouter.ts ollama.ts
      auth/       pkce.ts oauth.ts store.ts
      threads/    model.ts repository.ts
      ask/        prompt.ts stream.ts
      settings/   schema.ts defaults.ts
    platform/             # ONLY place importing @tauri-apps/*
      window.ts shortcut.ts http.ts store.ts
      secrets.ts opener.ts oauth-server.ts
  src-tauri/
    src/lib.rs            # ~25 lines, never edited again
    tauri.conf.json  capabilities/default.json
```

`ref/{app,api}` held the v1 app and worker while v2 was written; deleted 2026-09-05, and
still in git history before that commit.

Files on disk:
```
~/Library/Application Support/me.tanlethanh.pingask/
  auth.json      { "claude": {type:'oauth',refresh,access,expires}, "openai": {type:'api',key} }
  settings.json  { keybinding, model, systemPrompt? }
  threads.json   [ Thread, ... ]
```

## Key interfaces

```ts
// core/providers/types.ts
type AuthDef =
  | { kind: 'apiKey'; help: string }
  | { kind: 'oauth'; clientId: string; issuer: string; authorizeUrl: string; tokenUrl: string
      redirect: { port: number; path: string }; scopes: string[]; extraAuthorizeParams?: Record<string,string> }
  | { kind: 'none' }

type Quirks = { headers?: Record<string,string>; baseURL?: string; systemPrefix?: string }

interface ProviderDef {
  id: string
  label: string
  auth: AuthDef
  quirks?: Quirks
  models: () => Promise<ModelDef[]>          // models.dev, cached
  createModel: (cred: Credential, modelId: string) => LanguageModel
}

// core/auth/store.ts
type Credential =
  | { type: 'oauth'; refresh: string; access: string; expires: number; accountId?: string }
  | { type: 'api'; key: string }
```

One generic OAuth flow in `core/auth/oauth.ts` is driven entirely by `AuthDef`. Adding a provider
never touches the auth flow.

## Spikes — do these before writing app code

| # | Question | Pass criteria | Fallback if it fails |
|---|----------|---------------|----------------------|
| S1 | ~~Does `plugin-http` stream SSE or buffer?~~ **PASSED 2026-09-05** | Verified in `node_modules/@tauri-apps/plugin-http/dist-js/index.js`: response body is a real `ReadableStream` whose `pull` invokes `plugin:http|fetch_read_body` per chunk, last-byte sentinel `1` closes; `abort` wired to `fetch_cancel_body` | n/a — fallback not needed. Note: the *request* body is fully buffered via `req.arrayBuffer()`, irrelevant for our small JSON posts. |
| S2 | ~~`bun build ./index.html` asset paths + dev server~~ **PASSED 2026-09-05** | `--public-path './'` emits relative `./index-*.js`/`.css`; dev server serves the HTML entry with HMR wiring | n/a — Vite not needed. **Gotcha found:** `--port` after the entry file is ignored (binds 3000). Must be `BUN_PORT=1420 bun ./index.html`. |
| S3 | Claude OAuth: exact endpoints, encoding, and whether the Claude Code system preamble is required | A `/v1/messages` call succeeds with our own prompt | Ship Claude via API key only; keep ChatGPT OAuth. **In progress**: the exchange returned 400 against a form-encoded body; now sent as JSON with `state`, still unconfirmed |
| S4 | `tauri-plugin-oauth` binding `:54545` / `:1455` while the real CLI is running | Clear error, not a hang | Device-code flow (opencode has one for ChatGPT) or paste fallback |
| S5 | ~~`@ai-sdk/anthropic@4` `headers` + `fetch` options~~ **PASSED 2026-09-05** | `createAnthropic({baseURL?, apiKey?, authToken?, headers?, fetch?, ...})` confirmed against the installed package | n/a |

Budget: **2–3 hours** for S1 + S2 together. Do not skip them; both can invalidate a core decision.

## Build order

| Phase | Work | Estimate |
|-------|------|----------|
| 0 | Spikes S1, S2 | 2–3h |
| 1 | Root bun project, `tauri.conf.json`, 25-line `lib.rs`, move old code to `ref/`, biome + tsc + bun test wiring | 2h |
| 2 | `platform/` layer — window, shortcut, http, store, opener, oauth-server | 2h |
| 3 | `core/` threads + settings + repository, with bun tests | 3h |
| 4 | Key-based providers (anthropic, openai, openrouter, ollama) + models.dev catalog | 3h |
| 5 | UI — spotlight, transcript, streaming render, window grow/cap | 6h |
| 6 | Lifecycle, hotkey, settings/onboarding | 4h |
| 7 | OAuth: ChatGPT first (copy opencode), then Claude (after S3) | 6h |
| 8 | Signing, notarization, updater feed | 6h |

**~34h ≈ 4–5 working days.** Phases 1–6 give a working app on API keys; 7 adds subscriptions.

## Verified so far

- Rust shell compiles clean with the 8-plugin set (`cargo check`, 56s). The v1 `Cargo.lock` had to be deleted — it pinned `tauri-runtime-wry 2.10.1` against a newer `wry`, which fails with `missing eval_script_with_callback`.
- Spike S2 passed; see the table above.
- Spike S1 passed; `plugin-http` streams chunk-by-chunk over IPC, so the ai SDK gets incremental deltas.

### S-Dock — hiding the Dock tile (2026-09-05)

PingAsk is hotkey-only, so it should be an accessory app like Raycast: no Dock tile, no Cmd-Tab entry.

- `LSUIElement` in `src-tauri/Info.plist` is **not sufficient**. tao's app delegate defaults to
  `ActivationPolicy::Regular` (`tao-0.35.3/src/platform_impl/macos/app_delegate.rs:107`) and applies it
  in `applicationDidFinishLaunching`, calling `NSApp setActivationPolicy:Regular` *after* the plist is
  read. The tile comes back.
- There is no `tauri.conf.json` key for the activation policy and no plugin exposing it to JS. The only
  route is `App::set_activation_policy`, which needs a `.setup()` closure — hence the amendment to
  decision #2.
- `Info.plist` is kept anyway: it stops the tile from appearing for the moment between launch and
  `setup()` running.
- Verified with `lsappinfo info -only ApplicationType <pid>` → `"UIElement"`.
- `tauri dev` runs the unbundled binary; the `.setup()` line covers it there too, but the icon artwork
  itself only appears in a bundled `.app`.


## Build status — 2026-09-05

All eight phases implemented. `bun run check` clean, `bun test` 153 passing, app verified running.

| Phase | State |
|-------|-------|
| 0 Spikes | Done. S1 and S2 both passed — see the spike table. |
| 1 Skeleton | Done. Root Tauri project, `ref/{app,api}`, biome + tsc + bun test wired. |
| 2 `platform/` | Done. 7 modules, 25-line `lib.rs`, capability allowlist. |
| 3 `core/` state | Done. Thread repository, settings store, ask pipeline, test fakes. |
| 4 Providers | Done. 6 providers + models.dev catalog + registry. |
| 5 UI | Done. 10 components, CSS with light/dark and reduced-motion. |
| 6 Integration | Done. 7 hooks + `app.tsx` lifecycle state machine. |
| 7 OAuth | Implemented. ChatGPT constants copied from opencode; **Claude constants remain unverified — spike S3 is still open.** |
| 8 Release | Done bar notarization. Updater keypair generated (`~/.tauri/pingask.key`, mode 600, outside the repo), pubkey in config, `createUpdaterArtifacts` on, signed `.tar.gz` + `.sig` produced, runbook in `docs/release.md`. **Notarization needs your Apple Developer credentials.** |

### Deviations from the decisions above

1. **Credential storage shape.** `KeyValueStore` has no enumeration, so `auth.json` is
   `{"credentials": {"claude": {...}}}` rather than provider ids at the top level. Gains an
   atomic write and a one-read `all()`.
2. **Threads persist on turn completion**, not only on Esc. Decision #10 only requires that a
   thread with an answer survives; saving earlier also means a crash cannot lose the answer that
   just arrived. Observable behaviour is unchanged.
3. **Claude OAuth uses `authToken`, not the dummy-key trick.** `@ai-sdk/anthropic@4` throws when
   `apiKey` and `authToken` are both set, and a dummy `apiKey` would put a bogus `x-api-key` on the
   wire beside the bearer. `authToken` emits exactly `Authorization: Bearer <access>` and nothing
   else — the same wire format opencode reaches by stripping headers in a fetch wrapper. They need
   the dummy key because their plugin host builds the provider generically; calling the factory
   directly, we don't. `OAUTH_DUMMY_KEY` still exists for providers that do need it.
4. **`FetchLike` is a structural call signature**, not `typeof globalThis.fetch`. The global type
   carries a static `preconnect` under @types/bun that no test double has. One cast lives in
   `core/providers/sdk-fetch.ts` for the ai-SDK factories, which still demand the global type.

### Things that bit us, recorded so they don't again

- The v1 `Cargo.lock` pinned `tauri-runtime-wry 2.10.1` against a newer `wry`: `missing
  eval_script_with_callback`. Deleting the lock and re-resolving fixed it.
- Registering `tauri_plugin_updater` **panics at startup** unless `plugins.updater` exists in
  `tauri.conf.json` with a real `pubkey`. There is no graceful degradation.
- Adding any `plugins` block to the config makes `tauri::generate_context!` expand to code that
  references `serde_json`, so `serde` and `serde_json` must stay in `Cargo.toml` even with zero
  custom Rust.
- `bun ./index.html --port N` silently ignores the flag and binds 3000. Use `BUN_PORT=N`.
- **Never pass `AbortSignal.timeout()` to the Tauri http plugin's fetch.** That signal fires even
  after the request has completed, and the plugin never removes the abort listeners it attaches:
  the late abort calls `fetch_cancel` and `fetch_cancel_body` against resources it already
  released, and the webview logs `The resource id N is invalid.` — twice, once per rid, for a
  request that actually succeeded. Use an `AbortController` with a timer cleared in a `finally`.
  Bit us on Ollama's `/api/tags` probe; `platform/http.ts` now warns callers.
- **`global-shortcut:default` grants nothing.** The plugin ships `permissions = []` deliberately
  ("shortcuts can be inherently dangerous"), so the capability must list
  `global-shortcut:allow-register` and `global-shortcut:allow-unregister-all` explicitly. With only
  `:default` the hotkey is denied at runtime and there is no way to summon the window at all —
  the app is unusable. Every other plugin's `:default` does cover what we call; this one is the
  exception.
- **`tauri-plugin-oauth` defines no `default` permission set.** Only `allow-start` and
  `allow-cancel` exist. `oauth:default` is not a valid identifier, and **the build does not reject
  it** — it passes straight through into `gen/schemas/capabilities.json`, so an invalid or
  empty-granting permission fails silently at runtime, not at build time. Check
  `gen/schemas/capabilities.json` against `gen/schemas/desktop-schema.json` when adding a plugin.
- `global-hotkey` (the standalone tauri-apps crate) is already a transitive dep of the plugin.
  Using it directly buys nothing and costs the zero-custom-Rust rule — it has no JS bindings.

### Verification performed

| Check | Result |
|-------|--------|
| `bun run check` (tsc 7 + biome) | Clean |
| `bun test` | 153 pass / 0 fail, 337 assertions, ~300ms |
| `cargo check` | Clean |
| `tauri dev` launch | App renders; panel, placeholder, key hints and the no-provider warning all correct (screenshot taken) |
| `tauri build` release | `PingAsk.app` 6.3 MB + `PingAsk_2.0.0_aarch64.dmg` 3.5 MB |
| Release bundle launch | Runs, no crash report |
| Updater artifacts | `PingAsk.app.tar.gz` 3.3 MB + a valid `.sig`, signed with the generated key |
| Code signature | `adhoc, linker-signed` — expected without a Developer ID cert |

**Not verified:** the global hotkey end-to-end. macOS refuses synthetic keystrokes from `osascript`
without Accessibility permission (`error 1002`), so the registration path was only checked by
reading the plugin API. Press ⌘⇧Space against a running build to confirm.

**Also unverified:** every network path. No provider was connected, so no real request has been
made through plugin-http to any vendor.

### ai SDK v7 facts worth remembering

- **`system` is deprecated in favour of `instructions`.** Both accept
  `string | SystemModelMessage | SystemModelMessage[]`, which is what makes multiple system blocks
  expressible — `buildSystemPrompt`'s `string[]` maps to `[{role:'system', content}]`.
- **Iterate `fullStream`, not `textStream`.** v7 deliberately keeps error parts off `textStream`,
  so a failure there surfaces only through the SDK's default handler, which just `console.error`s
  it. `askStream` takes `onError` and reads `fullStream` so failures become `AskError`s.
- `createOpenRouter(...)` bare call resolves to the *completion* overload — `.chat(id)` is required.

### Integration bugs caught before shipping

- The settings panel replaces the query field, so binding Escape to the input's `onKeyDown` left
  the panel with no keyboard handler at all — Escape did nothing while it was open. Escape and
  `⌘,` now live on a document listener.
- `message.tsx` marks safe links `data-external` on the contract that the app intercepts the
  click. Nothing did. An unintercepted click navigates the webview away from the app, which it
  cannot return from. `app.tsx` now catches those clicks and hands the href to the OS browser.

### macOS-native pass (2026-09-05)

Applied from the Apple design guidance. The load-bearing change is the first one.

1. **Real `NSVisualEffectView` vibrancy, via config not Rust.** `app.windows[0].windowEffects =
   { effects: ["hudWindow"], state: "active", radius: 20 }` in `tauri.conf.json`. `hudWindow` is
   the AppKit material for floating HUD panels — the closest thing to Spotlight's own surface.
   Verified by zeroing the CSS tint: the panel stayed a uniform material rather than showing the
   sharp desktop, which is the material and not a `backdrop-filter`.
2. **The CSS stopped carrying its own blur.** With a real material underneath, the old
   `blur(32px)` panel background was a translucent layer stacked on a translucent layer —
   what the HIG explicitly warns kills legibility. The CSS now only tints and saturates.
   **Raised to 0.85 on request (2026-09-05)**, from 0.34 light / 0.22 dark: at that alpha
   the CSS layer is the surface and `hudWindow` reads only as a faint wash at the edges.
   The native material is kept anyway — it still gives the window a rounded native backing
   and costs nothing — but going translucent again is a one-line change to
   `--pa-panel-bg`.
3. **Corner radius 14 → 20px**, matching `windowEffects.radius`. A mismatch shows as a seam
   between the AppKit-rounded material and the CSS-rounded content.
4. **The system accent colour**, via the `AccentColor` / `AccentColorText` CSS system colours
   behind an `@supports` guard, with the old literals as fallback. macOS users pick their accent
   and native apps follow it.
5. **Selection is an accent-tinted row.** First attempt filled it solid with the system
   accent, Finder-style; on a translucent HUD panel that was a slab of saturated blue
   fighting the material, and the on-accent secondary text lost most of its contrast.
   Now a 28% tint (20% in light), text in the normal palette. A grey wash would read as
   hover, so the accent stays — just as a tint, not a block.
6. **Press feedback is instant and on pointer-down.** `:active` states set
   `transition-duration: 0s`, because a transition on the way *in* is the lag that makes an
   interface feel dead. Fill changes, not scale: macOS buttons darken, they don't shrink.
7. **Size-specific tracking.** The query field went to 21px with `-0.022em` and tight leading;
   small text got slightly *positive* tracking. A single `letter-spacing` for every size is
   wrong somewhere.
8. **Vibrancy legibility.** Low-alpha grey dissolves into a translucent material, so small text
   gained weight rather than opacity, and the placeholder moved up one contrast step — it is the
   only content on screen when the panel is idle.
9. **`prefers-reduced-transparency` and `prefers-contrast: more`** now have real answers: the
   material goes fully opaque and the blur is dropped entirely, rather than staying half-frosted.
10. **Hairlines are 0.5px**, which is what AppKit draws on retina; 1px reads as a heavy rule.

**Bug this caught:** the global `:focus-visible` ring applied to the query field. That field is
borderless, full-bleed and focused from the moment the window opens, so its ring clipped into a
hard accent line across the whole panel. Spotlight shows no ring on its field — the caret is the
indicator. The rule now excludes `.pa-input`.

### Spotlight placement and stable search height (2026-09-05)

- **The panel is anchored high, not centred.** `platform/window.ts` `anchorTop()` centres it
  horizontally on the active monitor and puts the top edge at 20% of the `workArea` height —
  work area, so the menu bar and Dock are excluded. The y is clamped so a panel grown to its
  full 640px still fits, because the top edge is fixed once shown.
- **The top edge is the anchor on purpose.** The panel grows downward as answers arrive; a
  vertically centred window would slide the query field out from under the user on every turn.
  Verified that Tauri preserves the top-left across `setSize`, so growth really is downward.
- **Called on mount as well as on hotkey open.** A window shown any other way — first launch, a
  dev build with `visible: true` — would otherwise keep Tauri's `center: true` position.
- **`anchorTop` never moves the window on non-finite numbers.** `workArea` is a newer addition to
  the Monitor payload; destructuring it when absent produced `NaN` and threw the window somewhere
  off every display, with no decorations left to drag it back by. It now falls back to the full
  monitor bounds and refuses to move on a bad number.
- **The panel holds its height while the query narrows the list.** Without it the OS window
  resizes on every keystroke: the panel jitters under a fast typist and rows slide out from under
  the pointer. `.pa-listbox[data-reserve]` reserves `label + padding + rows x --pa-row-h`, with
  the row count set inline by `app.tsx`.
- **The reservation is arithmetic, not measurement.** The first attempt measured the idle list
  with `offsetHeight` and always got a too-small number: the panel body is `overflow: hidden` and
  the OS window had not yet grown to fit the list, so the box was still clipped. Rather than
  chase layout timing, both list lines now carry explicit line-heights, which makes a row exactly
  51px and the reservation pure CSS. Verified in Chrome against the real stylesheet: row 51px,
  label 23px, and a 4-row idle list and a 1-result search both 239px.
  `--pa-row-h` / `--pa-list-label-h` must stay in sync with `.pa-list-item` / `.pa-list-label`.
- The label slot renders in both states ("Recent" / "Results") so the two are the same shape.

### Model picker and settings header (2026-09-05)

- **The picker lists only providers you can actually reach.** `buildModelOptions` in
  `core/ask/select.ts` filters through the same `usableProviders` predicate `selectModel` uses,
  so a model behind a missing key is never offered — choosing it would have failed at ask time.
  Ollama, which needs no credential, appears exactly when it is running with models pulled,
  because its catalog comes back empty otherwise. The settings panel already renders
  "Connect a provider below to pick a model." for the empty case.
- **Catalogs are still loaded for every provider**, not just connected ones: models.dev is a
  single cached fetch, and pre-loading means connecting a provider reveals its models with no
  second round-trip.
- **`ModelOption` moved to `core/providers/types.ts`.** `hooks/use-models.ts` was importing it
  from `ui/settings/panel.tsx` — a hook depending on a UI module, backwards from the layering
  rule. Building the options is now a pure function with tests, and the hook is a thin binding.
- **The settings title is the panel's top edge.** `Spotlight` rendered its header slot
  unconditionally, so the settings view — which has no query field — carried a dead 56px band
  above its title. The slot now collapses when empty, and `.pa-settings-head` takes over the
  drag region the query header used to provide. Verified in Chrome against the real stylesheet:
  0px above the header, 52px tall, no header slot rendered.

### Model options — extended thinking (2026-09-05)

The first user-adjustable generation option, built so the next one is a field rather
than a refactor.

- **`ModelPrefs` is an object, not a boolean argument.** Adding verbosity or temperature
  later changes one type, not six provider signatures.
- **Off by default, deliberately.** Thinking trades seconds of latency and a pile of tokens
  for depth, and this app exists to put a short answer on screen immediately.
- **Support is discovered, not hardcoded.** models.dev publishes `reasoning: true` per model
  (and `reasoning_options`), so `ModelDef.reasoning` carries it and the toggle disables itself
  with an explanation when the selected model cannot reason.
- **Preferences are clamped against the model's real capability** in `buildProviderOptions`, so
  leaving the toggle on while switching models can never produce a request the API rejects.
  A model absent from the catalog counts as "cannot reason" — the safe, fast path.
- **Per-vendor mapping lives on `ProviderDef.providerOptions`**, one line per provider:
  Anthropic/Claude `{thinking:{type:'enabled',budgetTokens:2048}}`, OpenAI/ChatGPT
  `{reasoningEffort:'low'|'none'}`, OpenRouter `{reasoning:{enabled,effort}}`, Ollama `{think}`.
- **OpenAI gets an explicit `'none'` when the toggle is off.** Reasoning models default to a
  middling effort, which costs seconds on every quick lookup — this is what makes the default
  path fast rather than merely unconfigured.
- The 2048 budget is near Anthropic's 1024 minimum on purpose. The SDK falls back to the
  model's own `max_tokens` default, far above it, so the API's `max_tokens > budget_tokens`
  rule holds without us setting one.
- `ProviderOptions` is typed `Record<string, Record<string, JSONValue>>` using the SDK's own
  `JSONValue`, so a mapping that is not serialisable fails at the type level, not on the wire.
- The switch is a real checkbox with its painting replaced, so focus and keyboard behaviour are
  the platform's. Verified in Chrome: 34x20 track, 14px knob travel, and the on state resolves
  to the live system accent (`rgb(0, 117, 255)` here), not a hardcoded blue.

### Compact settings (2026-09-05)

Settings was ~760px against a 640px panel cap, so it always scrolled. Providers alone
were ~64% of that. Now **334px**, measured in Chrome against the real stylesheet.

- **One list idiom, not two.** A grouped card of hairline-separated rows, used for both
  the settings and the provider list. The previous pane had a grouped card *and* six
  individually bordered cards with gaps — two container languages in one view, which read
  as decoration rather than structure.
- **Providers are one line with the action on the line** (revised 2026-09-05). They were
  briefly a disclosure toggle: clicking anywhere opened a drawer that then held the real
  controls, which made every action two steps and gave the row a meaning ("expand") that
  was not what anyone came to do. Now the verb is named on the row — **Add/Edit** for a
  key, **Connect/Disconnect** for OAuth, nothing for Ollama. The key field is inline too:
  it takes the row where the masked value sits, so nothing opens below and every row
  stays 38px whatever state it is in. `auth.help` moved to the field's `title`, since a
  one-line row has nowhere to put a sentence.
- **Actions are icons, all neutral** (2026-09-05): `+` add key, pencil replace key,
  `✓`/`×` save and cancel, external-link connect, trash disconnect/remove. Each carries
  `aria-label` and `title`, since a glyph names nothing on its own.
  - **The actions are grouped.** With one gap across the whole row, the icon buttons'
    own padding made glyph-to-glyph 19px while text-to-glyph was 14px — the pair read as
    further from each other than from the value they act on. A wrapper with its own tight
    gap inverts that to 10px and 14px, and every row's last glyph lands in one column.
  - The masked key is four bullets, not eight: it stands for a key, it does not have to
    look like one.
  - Row actions use an `.pa-icon-btn--row` modifier rather than a
    `.pa-provider-row .pa-icon-btn` descendant — that form has the same shape as the
    history list's rules and reads as a specificity conflict although the two never
    match the same element.
- **Destructive actions go through a native confirm** instead of being marked with
  colour. `platform/dialog.ts` wraps `@tauri-apps/plugin-dialog`'s `confirm()`, and
  `app.tsx` owns the call — the panel lives in `ui/` and may not touch the platform, so
  it just calls `onDisconnect` and knows nothing about dialogs. The helper returns
  `false` if the dialog cannot be shown: a destructive action must not proceed because
  we failed to ask.
  - `confirm()` routes through `plugin:dialog|message`, which `dialog:default` grants.
    Checked rather than assumed — that default covers only `message`/`open`/`save`, and
    `ask`/`confirm` have no permissions of their own.
- Previously (superseded): **actions were inline text, not buttons in boxes.** A bordered control per row turned a
  list of providers into a list of buttons; the provider is the subject and the action is
  a verb beside it. Destructive ones (`Disconnect`, `Remove`) take the danger colour.
- **At most two verbs per state**: `Add` / `Edit`+`Remove` / `Save`+`Cancel` /
  `Connect` / `Disconnect`. Three at once (Save, Remove, Cancel) put blue-red-blue in a
  row where they competed for the same glance. `Remove` sits on the resting row next to
  `Edit`, which is also where OAuth puts `Disconnect` — one consistent home for
  destructive actions.
- **The key field is excluded from the global `:focus-visible` ring.** Its own border
  already turns accent on focus, so the ring stacked a second, much heavier indicator on
  top of the first. Same exclusion the query field has, for the same reason.
- The field uses `--pa-fill`, not `--pa-panel-bg`: at 0.85 the panel colour read as a
  hole punched in the row rather than a field sitting in it. It fills the row width so
  `Save`/`Cancel` land in the same column as every other row's actions.
- **Every provider is listed** (reverted 2026-09-05). They were briefly hidden behind an
  "Add provider…" row to save height — but once rows became a single line the whole pane
  measured 509px against the 640 cap, so there was nothing to save, and the step was
  hiding what the app supports. The model picker still lists only *connected* providers:
  that one is about what you can send a question to, which is a different question.
- **The three small settings became label-left / control-right rows** in one card, the way
  a System Settings pane is laid out. Three headed sections with their own hint paragraphs
  cost ~100px more for the same content.
- **One type scale, five named tokens** (`--pa-text-display/title/body/small/micro`). The
  stylesheet had eleven near-identical sizes — 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14,
  14.5, 21 — which is noise, not hierarchy. No literal `font-size` values remain.
  Raised one step on 2026-09-05: title 15, body 14, small 12.5, micro 10.5. A sixth token,
  `--pa-text-heading` (17px), was added for the settings pane title — `--pa-text-title` is
  doing double duty as the body size for assistant answers, so enlarging one heading
  through it would have quietly enlarged every reply. `display`
  stays at 21 — the query field had just been shortened, and growing its text would put
  the head height back.
- **Removed:** the dashed "+ Add provider" box, the green status dot on every row, the
  reserved 16px hint height, and helper text that restated its own control ("Slower, better
  on hard questions" under a switch labelled Extended thinking). The thinking sub-line now
  appears only when the model does not support it, which is the case worth explaining.
- The keybinding recorder's hint is transient — shown while recording, absent otherwise.
- **The recorder's control is a flat icon** (2026-09-05): a 20px keyboard glyph, no label
  and no pill. The old circle outline only meant "record" by audio/video convention and
  said nothing about pressing keys; the bordered "Record" button was a second object
  competing with the very keycaps it edits. The chord beside it already names the row.
  Recording state is the pulsing dot, tinted with `--pa-danger`, carrying what the word
  "Stop" used to. `aria-label`/`title` supply the name the visible label no longer does.
- The chord itself dropped its `+` separators and tightened to 21px caps: the glyphs read
  as one chord on their own, and the separators were about a third of the control's width.

### Row balance, pop-up button, vendor marks (2026-09-05)

- **Every row in both cards is 38px.** The settings card looked heavier than the provider
  card because its controls set the height: `.pa-kbd--lg` was 27px, `.pa-select` carried 8px
  of padding on top of a full-width box. Controls are now sized to sit inside the row rather
  than define it. The Extended thinking row is 44px only when its sub-line is present.
- **The model control hugs its label** — 117px, down from ~360px. A macOS pop-up button is
  sized to its content; a full-width select was the visually heaviest thing in the pane while
  saying the least. Capped at 230px with ellipsis for long model names.
- **Vendor marks in the provider rows**, from `@lobehub/icons-static-svg` (MIT). The mono set
  is already `fill="currentColor"` on a 24x24 grid, so each mark inherits the row's colour and
  size instead of carrying its own palette.
  - **Inlined, not fetched.** The Tauri CSP blocks remote assets at runtime, so
    `src/ui/provider-icons.tsx` is generated from the package — all five marks are ~7KB. It
    is generated output: regenerate from the package rather than hand-editing path data.
  - ChatGPT reuses the OpenAI mark; lobehub ships no separate one for the subscription.
  - The marks belong to their vendors and appear only to identify them.
- Settings content is 382px with three providers connected, still inside the 640px cap.

### Stale model lists (2026-09-05)

Reported: models pulled into Ollama did not appear until the app was restarted.

- **Root cause:** `useModels`' effect depended only on `[ports]`, so it ran once at mount.
  Ollama's list is a live call to the local daemon, and this app sits resident for days —
  so "restart it" was the only way to see a newly pulled model.
- **Fix:** the loader is shared between mount and an exposed `refresh()`, called when the
  window opens and when settings opens. A `runId` ref discards a slow probe that would
  otherwise overwrite a newer one.
- **Prerequisite: the cached catalog was 8.5MB on disk** (the whole models.dev api.json,
  4.3MB raw). Re-reading and re-parsing that on every window open would have put the fix
  on the hot path. It is now compacted to the five fields this module reads — 4.3MB →
  1.1MB — and memoised in memory. Providers are deliberately *not* filtered: scoping to
  the three used today gives 65KB but silently starves any provider added later.
- **The memo is keyed on `Ports`, not the module.** A process-wide memo hands one set of
  ports a catalog fetched through another — which is what a test suite looks like, and
  what a second `Ports` instance would look like at runtime. `inFlight` is keyed the same
  way. Ten tests failed the moment the module-level version went in, which is how this
  was caught.

**Separate bug found while reading that code:** `withDefault` rebuilt every entry from
`{id, label}`, so `reasoning` never survived into `ModelDef` — the extended-thinking
toggle was disabled for every catalog-sourced model, i.e. the feature shipped broken.
Fixed, with a regression test.

### Escape unwinds; up-arrow shortcut removed (2026-09-05)

- **Escape now steps back rather than out.** In a thread it returns to an empty panel;
  only an already-empty panel closes. Nothing is lost — a thread is persisted the moment
  its answer lands, so it is sitting in the recents list behind the panel you just
  cleared. This revises decision #10, which had Esc leave straight from a thread.
- **The ↑-opens-last-thread shortcut is gone**, hint and behaviour both. The recents list
  is already on screen, so ↑/↓ moving the selection *is* the interaction; jumping into the
  last thread instead fought it, and the hint spent a footer slot explaining a special
  case. `useThreads.last()` went with it rather than staying as an unused export.
- Footer now reads `esc back` in a thread and `esc close` on an empty panel — the hint
  names what the key does in that state, which was the point of making it a prop.

### Selection tint (2026-09-05)

Reported: the blue accent on a selected recent item looked wrong. Four things were:

- **A solid accent fill on a translucent material** is the one combination the vibrancy
  guidance warns against — it fights the surface instead of sitting on it.
- **`:active` used the same solid fill**, so merely pressing any row flashed a blue slab.
- **On-accent secondary text at 0.72 opacity** was barely legible; the preview line is the
  useful half of a history row.
- **A 6px pill inset 6px inside a 20px-radius panel** collided with the rim. Now a 10px
  pill inset 8px, which is the same corner family as its container.

`color-mix(in srgb, AccentColor 28%, transparent)` was verified to resolve in the webview
before committing to it — a system colour inside `color-mix` would otherwise drop the whole
declaration silently, leaving selection invisible.

### Footer model picker (2026-09-05)

- **Hint order reversed in a thread**: `esc back` then `⏎ follow up`, so the row reads
  left-to-right in the order Escape unwinds. Note the typing state still reads
  `⏎ ask` first — the two conventions now differ, which was the explicit request.
- **The model chip is a control, not a label.** It shows the provider mark plus the
  model name and changes the model inline; settings is no longer the only way.
- **It is a real `<select>`, stretched transparently over the chip.** macOS renders it as
  a native popup menu, so the menu itself, keyboard access, type-ahead and the checkmark
  on the current item all come from the platform. Painting the trigger ourselves is what
  allows the provider mark, which a native option list cannot show.
  - Verified the select covers the chip exactly, so the whole thing is the hit target —
    `elementFromPoint` at the chip's centre returns the select.
  - Focus lands on the select, but the ring is drawn on the chip via
    `:has(.pa-model-select:focus-visible)`, since the visible element is what the eye tracks.
  - **`:focus-visible` matches a `<select>` after a plain mouse click** — per spec, because
    it takes arrow-key input once focused. So the ring latched on and stayed lit after the
    native popup closed, reading as a stuck error state. Two fixes: the picker marks
    pointer-initiated focus with `data-pointer` and the ring selector excludes it
    (`:not([data-pointer])`), cleared on any key press so tabbing still shows a ring; and
    choosing a model blurs the select and returns focus to the query field, which is where
    typing belongs anyway.
  - Verified with `Element.matches()` rather than computed styles: a harness page driven
    remotely never holds OS focus, so `:focus`/`:focus-visible` never match there and any
    ring test on it is meaningless.
- `Footer` takes a `model?: ReactNode` slot rather than a label string, so it stays
  presentational and `app.tsx` composes the picker.

### Stable chrome across screens (2026-09-05)

- **One head height, `--pa-head-h`** (52px, raised to 56px on request), pinned on both
  `.pa-header` (the query field) and `.pa-settings-head`. A matching `--pa-foot-h` (42px)
  pins `.pa-footer` — its height had been emergent from padding, which is exactly how two
  screens drift apart. They are different elements on different screens, so a shared
  token is the only thing keeping content from shifting as you move between them.
- **The query field is shorter**: 17px of padding around 21px text made it 59px, the
  tallest thing in the panel — it was setting the head height rather than sitting inside
  it. Now 51px, under the 52px floor.
- **Settings carries the same footer rail.** It had none, so the bottom line vanished on
  the way in and reappeared on the way out; the panel's whole base moved for a screen
  that is otherwise the same object. It shows `esc back` and the gear, which closes.
- **The "Recent"/"Results" heading is gone**, along with `HistoryList`'s `label` prop, the
  `.pa-list-label` rule and the `--pa-list-label-h` token — the reserved-height
  arithmetic no longer pays for a row that is not drawn.
- Measured: head 52px on both screens with its bottom edge 52px from the panel top, and
  footer 41px on both.

### Larger base type (2026-09-05)

- Scale raised one step: body 13 → 14, small 11.5 → 12.5, micro 10 → 10.5, title 14 → 15.
  `display` deliberately unchanged, so the query field stays 51px and the head stays 52px.
- **Leading is tokenised too** — `--pa-lead-body` and `--pa-lead-small` replaced seven
  literal `line-height` values. Those line boxes are not cosmetic: `.pa-list-item`'s height
  is arithmetic (padding + title leading + 1px + preview leading), `--pa-row-h` is derived
  from it, and the search height reservation is derived from that. Bumping font sizes
  without moving the leading would have left rows cramped; moving leading without updating
  `--pa-row-h` would have desynced the reservation from the rows it reserves for.
- Verified after the change: `--pa-row-h: 53` matches all three measured rows exactly, the
  reservation lands on its formula (171px = 6·2 + 3·53), and head/input/footer are still
  52/51/41 — so the cross-screen stability from the previous change survives.

### Delete and undo a history item (2026-09-05)

- `⌘⌫` deletes the highlighted thread, `⌘Z` puts it back. Hints appear only when they
  apply: `⌘⌫ delete` while a row is highlighted, `⌘Z undo` while something is undoable.
  The list-state hints are built additively rather than branched, since the list is on
  screen while both typing and idle.
- **Contextual hints are appended, never inserted.** The first version put `⌘⌫ delete`
  ahead of `esc close`, so moving the highlight onto a row shoved the whole rail sideways
  and moving it off shoved it back — the footer flickered as you arrowed through history.
  Standing hints now keep their positions and contextual ones are added on the right.
- **Both chords already mean something in a text field**, so each is claimed narrowly:
  - `⌘⌫` is delete-to-line-start. It only bites while a row is highlighted — that is the
    signal the user is working the list, not the field.
  - `⌘Z` is the field's own undo. Thread-undo claims it only when the query is empty, so
    there is nothing typed to undo instead.
- **`restore` is index-based, not timestamp-based.** `save` stamps `updatedAt` and
  prepends, so reusing it for undo would resurrect the thread at the top with a fresh
  time — a new thread wearing the old one's contents. The first attempt sorted by
  `updatedAt` instead; a test caught it immediately, because several threads saved in the
  same millisecond tie and ties carry no ordering. `remove` now reports the index it
  removed from and `restore` splices it back there.
- The undo stack is cleared whenever the panel is freshened: an undo offered three
  openings later is a surprise, not a safety net.

### Active monitor and click-away dismiss (2026-09-05)

- **The panel follows the pointer, not the window.** `currentMonitor()` reports where the
  *window* is — which is where it was last shown — so on a two-display setup it kept
  reappearing on the first one. `anchorTop` now resolves the monitor from
  `cursorPosition()` via `monitorFromPoint()`, the same proxy for attention Spotlight and
  Raycast use, falling back to `currentMonitor()`.
  - Needs `core:window:allow-cursor-position` and `core:window:allow-monitor-from-point`;
    both confirmed present in the regenerated ACL. Worth checking, because the fallback
    swallows a permission denial and would silently degrade to the old behaviour.
- **Clicking away hides the panel**, via `onFocusChanged`. Two deliberate exceptions,
  both cases where hiding would destroy work rather than dismiss an idle panel:
  - **an answer still streaming** — `dismiss()` freshens, which resets the thread and
    aborts the request;
  - **an OAuth connect waiting on the browser** — which takes focus itself, so without the
    guard the panel would vanish the instant sign-in began.
  The guard reads through a ref so the listener does not need re-subscribing on every
  state change.

### Shortcuts stand down while recording (2026-09-05)

Recording a new global shortcut collided with the shortcut being recorded.

- **The OS layer was the real problem.** A chord registered with
  `tauri-plugin-global-shortcut` is consumed before the webview sees it — so the current
  binding could never be re-recorded, and pressing it mid-capture toggled the window out
  from under the recorder. `useHotkey` now takes `enabled = loaded && !recordingHotkey`,
  and its effect cleanup actually calls `unregisterAll()`. It did not before: flipping
  `enabled` off left the OS holding the binding, so the switch did nothing.
- **The recorder cannot release anything itself** — it lives in `ui/`, which may not touch
  the platform. It reports `onRecordingChange` up through `SettingsPanel` to `app.tsx`,
  which owns the hotkey. Unmounting reports `false`, so leaving settings mid-recording
  cannot strand the shortcut released.
- **The app's own document shortcuts also stand down.** The recorder calls
  `stopPropagation()`, which does reach far enough *because* React delegates to the root
  container rather than to `document` — but that is an implementation detail, and the
  wrong thing for `⌘.`/`Escape` to depend on. `app.tsx` checks the flag directly.

### Icons: Tabler (2026-09-05)

- **`src/ui/icons.tsx` is generated from Tabler's outline set (MIT)** — eleven icons,
  inlined. Not `@tabler/icons-react`: that ships 10,000 icons for an app that uses
  eleven. Regenerate from the package rather than hand-editing path data.
- **Why the hand-drawn set never looked balanced**: it was spread across 14/16/20
  viewBoxes with strokes from 1.3 to 1.5, so at one rendered size the glyphs differed
  ~25% in size and visibly in weight.
- **Equal bounding boxes was the wrong target.** After normalising every glyph onto a
  20-grid with matched extents they still looked uneven, and Tabler's own set measures a
  50% bbox spread (12–18 of 24) while reading as one family. Bbox is not optical size: a
  simple diagonal cross reads larger per unit area than a dense outlined object, so a
  designed set draws the `×` smaller on purpose. Uniform stroke plus that compensation is
  what makes a family — not equal boxes.
- `aria-hidden`/`focusable` are written on each element rather than folded into the
  shared attribute object: the a11y lint reads attributes statically and cannot see
  through a spread, so putting them there would pass review by hiding the evidence.
- `KeyIcon` went with the rewrite — nothing referenced it.

### "Connect a provider" stuck on with Ollama (2026-09-05)

- **Cause:** the footer warning asked "is any credential stored", but Ollama is
  `auth.kind: 'none'` and never stores one — so the check could not be satisfied by it
  however many local models were pulled and selected.
- **Fix:** key the warning on `models.active`, i.e. whether a model actually resolved.
  That is the same question `useAsk` asks before sending, so the footer and the ask path
  now agree by construction. It also covers a case the credential check missed: a key
  present but its catalog empty.
- The real defect was that `app.tsx` re-derived "are we ready" instead of asking
  `selectModel`, which already knew. The duplicate check is gone rather than corrected.

### Claude token exchange 400 (2026-09-05)

- **The error discarded the response body**, so every failure read as bare "400" and every
  fix was a guess. `postToken` now includes the server's explanation (trimmed to 300
  chars) — that is the durable fix here, independent of this particular bug.
- **Likely cause: encoding.** The generic flow was copied from opencode's OpenAI
  provider, which is form-encoded per OAuth 2. Anthropic's endpoint takes JSON and also
  echoes `state` on the exchange. `AuthDef` gained `tokenFormat` and
  `sendStateOnExchange`; the defaults keep every other provider exactly as it was.
- `readCallback` now splits a `code#state` parameter — Anthropic can return both in one
  value, and a code never legitimately contains `#`.
- **Still unverified.** S3 needs a real Claude account; the fix is the most probable
  reading of a 400, not a confirmed one. The improved error message is what makes the
  next attempt diagnosable rather than another guess.

### Esc closes; unasked questions persist (2026-09-05)

- **Esc no longer clears the field.** It was a rung on the ladder — text→clear — which
  meant two presses to dismiss a panel you had typed into. `⌘⌫` already clears a line
  natively, so the rung bought nothing and cost the obvious meaning of Escape.
- **A question typed but never asked survives the panel closing.** `freshen` clears the
  field only when a thread produced something; otherwise the text stays. The panel hides
  the moment you click away, and losing a half-written question because you went to look
  something up is the opposite of useful.
- The two changes are the same idea from both directions: closing the panel should never
  destroy what you were writing, whether you close it with Escape or by clicking away.
- Scope: in memory, so it survives hide/show but not a restart. Persisting a draft to
  disk would need a home in `settings.json` and a decision about when it goes stale.

### ChatGPT: a Codex-shaped request, and no silent empty turn (2026-09-05)

Reported as `AI_NoOutputGeneratedError: No output generated` on the first question through
a ChatGPT subscription. Two separate defects behind one symptom.

**The turn could fail invisibly.** `askStream` iterated `fullStream`, and a stream that
closes with neither text nor an error part left it returning `''` — an empty answer bubble
with nothing to explain it. The SDK does notice: it rejects `result.text` / `.steps` /
`.usage` with `NoOutputGeneratedError`. Those are promises we never read, so the failure
went nowhere we could see. `askStream` now treats no-text-no-error as a failed turn, and
`toAskError` appends `responseBody` when the SDK message omits it — the same lesson as
`describe()` in `auth/oauth.ts`, where discarding the body turned every 400 into a guess.

**The request was not what the Codex backend takes.** `chatgpt.ts` reached
`https://chatgpt.com/backend-api/codex/responses` with the right URL and auth but the wrong
body, measured against opencode's `packages/llm/src/providers/openai-options.ts`:

- `store: false` was missing. The endpoint stores nothing, and the Responses default is
  `true` — omitting it is not neutral. opencode pins it on every request it sends there.
- `include: ['reasoning.encrypted_content']` was missing. With no server-side state, the
  encrypted include is the only way a follow-up turn carries its reasoning.
- `reasoningEffort: 'none'` was borrowed from `openai.ts`. 'none' is an API-only effort;
  the efforts the Codex CLI exposes stop at 'minimal'. Now 'low' off, 'medium' on.
- `reasoningSummary` had to become explicit at that point: the SDK defaults any effort
  above 'none' to `'detailed'`, which OpenAI serves only to verified organisations.
  opencode's `'auto'` is what a consumer plan gets.
- `x-openai-internal-codex-residency` was missing for accounts pinned to a region. Read
  off the access token's `chatgpt_compute_residency` claim; `no_constraint` means send no
  header at all, not the literal string.
- `session-id` is now sent, as opencode does on every OpenAI request. We build a model per
  turn and have no id to hand down, so each turn is its own conversation — which is what
  the header means to a backend that keeps nothing.

JWT claim reading moved out of `auth/oauth.ts` into `auth/claims.ts`; account id and
residency are the same decode, and the signature is deliberately unverified for both (see
the file header for why that is safe here).

**Still a suspect if this does not fix it:** `originator: 'pingask'` (decision #15). Codex
CLI sends `codex_cli_rs`, opencode sends `opencode`. If OpenAI allowlists originators
rather than merely logging them, ours is not on the list — and the honest fix is then to
stop using the endpoint, not to impersonate a client that is.

### Anthropic: a budget nothing was going to spend (2026-09-05)

ChatGPT works after the Codex-shaped request; Claude Pro/Max still produces nothing. Put
a stub transport under `claudeProvider.createModel` and printed what actually goes on the
wire, and the body was wrong in one place:

```
{ "model": "claude-sonnet-4-6", "max_tokens": 128000, "system": [...], "stream": true }
```

Anthropic makes `max_tokens` mandatory, so omitting it does not mean "no ceiling" — the
SDK fills in the model's absolute one. 128k is two orders of magnitude past a
hundred-word answer, and past what Anthropic serves without the 128k-output beta header,
so the request can be turned away for a budget nothing was ever going to spend. It also
costs the subscription path more than the API-key path, because a subscription is metered
on Anthropic's side against what the request reserves.

`Quirks` gained `maxOutputTokens`, set to 8192 for both Anthropic providers. Per provider,
not global: the Codex endpoint wants no ceiling at all — opencode clears `maxOutputTokens`
there explicitly — and that path now works, so it does not get to change. The SDK adds the
thinking budget on top (`max_tokens` becomes 10240 with thinking on), which satisfies
Anthropic's `max_tokens > budget_tokens` rule without a second constant.

The header side of the same request is confirmed good: `Authorization: Bearer`, the
`oauth-2025-04-20` beta, no `x-api-key`, and the Claude Code preamble as system block 0.
Deliberately not added: `claude-code-20250219` to the beta list. It is a plausible guess,
but Anthropic rejects an unknown beta value outright, so guessing there trades a
half-working path for a certainly-broken one. S3 still owns proving it.

**Unreproduced:** the `AI_NoOutputGeneratedError` *unhandled rejection*. Six failure
shapes were driven through the real Anthropic provider under `bun` — 400 with a JSON body,
401, an SSE `error` event, an empty body, a truncated stream, a non-SSE 200 — and every
one surfaced as a normal `AskError` with the vendor's own words, none leaked a rejection.
The SDK's own path looks closed too: `rejectResultPromises` calls `markPromiseAsHandled`
on each promise it rejects. So the source is something the harness does not reproduce, and
the next move is the app's visible error line rather than another reading of the SDK.

### Anthropic refuses us as a browser (2026-09-05)

The visible error, once `toAskError` started carrying the response body:

```
CORS requests must set 'anthropic-dangerous-direct-browser-access' header
{"type":"error","error":{"type":"authentication_error", ...}}
```

An `authentication_error` that has nothing to do with the token. Decision #5 routes every
request through the Rust transport specifically so there is no CORS — but no CORS is not
the same as no `Origin`, and tauri-plugin-http forwards the webview's origin on every
request. Anthropic gates on the header's presence, so it classified us as a browser and
refused before reading the credential. Nothing about the OAuth work was wrong; the
request never got that far.

`anthropic-dangerous-direct-browser-access: true` now sits in both Anthropic providers'
quirks. The name warns about shipping a key inside a web page, where every visitor's
browser would carry it — here the key lives on one machine in the user's own app, so the
danger it names does not exist. That is true of these two providers and nowhere else, so
the header stays in their quirks rather than becoming a transport-wide default.

This was already written down. `platform/http.ts` said Anthropic needs the header — filed
under `webviewFetch`, as a property of the retreat path rather than of Anthropic. The
comment now says it about the transport we actually use.

### Nothing fails silently (2026-09-05)

The `AI_NoOutputGeneratedError` unhandled rejection outlived three fixes, and it kept
outliving them because a rejection nobody awaited prints one line to a console the user
does not have open and then the app carries on as if the turn had never happened. That is
the defect worth fixing first — not the rejection, the silence around it.

**`useUnhandled`** takes the window's `unhandledrejection` and `error` events, calls
`preventDefault()` on the rejection — we take responsibility for it, so the webview stops
printing its own bare line — and hands the failure to `useAsk.report`, which attaches it
to the turn that has nothing to show. Only that turn: a rejection arriving late must not
overwrite an answer that already streamed in, or an error the catch in `ask` already
wrote, because both of those know more about what happened than a stray rejection does.

**`core/ask/failure.ts`** splits one thrown thing into two audiences. The summary says
what to do and never quotes a status code; the detail walks the whole cause chain —
through both `cause` and `lastError`, because the SDK wraps a retry around an API error
around a fetch failure and only one of the three says anything useful, and which one
changes per provider. The vendor's `responseBody` goes in verbatim. Cycles terminate.

**The bubble** now carries both: the sentence, then the detail in a small mono block,
selectable, scrolling inside its own 128px box so a stack trace cannot decide how tall the
window is. `Message.errorDetail` is optional — threads written before this have no detail
and render exactly as they did.

What this does not do is fix the rejection. It makes the next report carry the name, the
status, the URL and the vendor's body instead of one generic line, which is what every
round of this has actually been short of.

### The transport remembers what the error forgot (2026-09-05)

Surfacing the failure was not enough: the detail came back as one line.

```
AI_NoOutputGeneratedError: No output generated. Check the stream for errors.
```

That is everything the error has. It carries no cause, no status, no URL and no body — it
is the SDK saying a stream produced nothing, which is a description of the silence rather
than of the request. Walking the cause chain finds nothing to walk.

So the account comes from the only layer that always has one. `core/net/trace.ts` wraps a
`FetchLike` and remembers the last exchange: method, URL, status, content-type, how many
bytes reached the reader, and the first of them. It watches the body rather than reading
it — the bytes are counted as they pass through a TransformStream — so a traced request
still streams exactly as it did, which matters because reading it to describe it would
mean the answer appears only once the model has finished writing it.

One tracer per turn, created in `useAsk` and held in a ref past the end of the turn, so a
rejection arriving after `ask` returned is still described. `describeFailure` takes the
trace as a second argument and appends it. The same failure now reads:

```
AI_NoOutputGeneratedError: No output generated. Check the stream for errors.

POST https://api.anthropic.com/v1/messages → 200 text/event-stream, 0 bytes
```

Which answers the question three rounds of guessing could not: whether the request was
sent, what came back, and whether anything at all arrived on the stream.

### We are not a browser (2026-09-05)

The trace paid for itself immediately. Second attempt, with the browser-access header in
place:

```
AI_APICallError: CORS requests are not allowed for this Organization because of its
settings. (401 https://api.anthropic.com/v1/messages)

POST https://api.anthropic.com/v1/messages → 401 Unauthorized application/json, 270 bytes
```

A different refusal, and the one that names the real problem. The header answered "yes,
this browser accepts the risk"; the account's answer is that it does not permit browser
traffic at all. There is no header that argues with that — and there should not be, because
the premise is false. Nothing here goes through a browser.

The premise came from tauri-plugin-http, which appends the webview's `Origin` to every
request as part of behaving like the page would. That is what made Anthropic classify a
desktop app as cross-origin browser traffic and apply an organisation policy about
browsers to it.

The plugin has an escape hatch for exactly this, and it is two-sided:

- `commands.rs` removes `Origin` when its value is empty — "Some services do not like
  Origin header so this way we can remove it in explicit way".
- That branch is `cfg!(feature = "unsafe-headers")`. Without the feature `Origin` is on the
  fetch-spec forbidden list, so our empty value is stripped and the webview origin is
  appended anyway — the state we started in.

So both halves ship: `src-tauri/Cargo.toml` enables `unsafe-headers`, and
`core/net/origin.ts` sets an empty `Origin` on every request, unless a caller set one
itself. The feature lifts the forbidden-header guard for all our requests, which is worth
saying out loud — every header that reaches the plugin is written by this codebase, and the
alternative was a transport that misrepresents what the app is.

Applied at the transport rather than in Anthropic's quirks, because the claim being
withdrawn is the transport's, not Anthropic's: any vendor may reasonably apply browser
rules to something that says it is a browser. `anthropic-dangerous-direct-browser-access`
is gone with it. It was an answer to a question that is no longer asked, and keeping it
would leave two mechanisms for one thing, only one of which works.

### Known gaps

- **Spike S3 (Claude OAuth) is unresolved.** The constants in `core/providers/claude.ts` are
  educated guesses, and whether the Claude Code system preamble is required is unknown. Sign-in
  with Claude should be treated as untested until someone runs it against a real account.
- **Bundle is 1.7 MB minified** because every provider is imported eagerly. opencode lazy-imports
  each `@ai-sdk/*` package inside its provider; doing the same here would cut the initial payload
  substantially. Worth doing before the first real release.
- No UI tests. Deliberate — decision #17 scoped tests to `core/`.

## Risks

1. **Subscription OAuth is against Anthropic's and OpenAI's terms.** Your account, your call — opencode
   does it for ChatGPT. Realistic consequences are account action and silent breakage when endpoints
   rotate. Mitigation: API keys are the default path (#3), so the app never hard-depends on OAuth.
2. **Claude OAuth is unproven here** — opencode dropped it from OSS, so there is no reference to copy.
   Treat S3 as genuinely uncertain.
3. **Pinned ports collide** with a running Claude Code / Codex CLI. See S4.
4. **`@ai-sdk/*` majors move fast** (v3→v4 within months). Pin exact versions like opencode does.
5. **Full-Bun bundling with Tauri is not a well-trodden path.** S2 exists for this; Vite is the retreat.

## Rules that keep this clean

1. `@tauri-apps/*` imports **only** inside `src/platform/`. Enforce with a biome rule.
2. `src/core/` has no React and no Tauri import — if it can't run under plain `bun test`, it's in the wrong layer.
3. `src-tauri/src/lib.rs` is append-only for `.plugin()` lines. A `#[tauri::command]` means a decision was reversed.
4. Adding a provider = one new file in `core/providers/` + one registry entry. Nothing else.
5. `core/auth/store.ts` is the only reader/writer of `auth.json`.
