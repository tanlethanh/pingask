import { useEffect, useRef, useState } from 'react'
import {
  type Credential,
  type ModelOption,
  type ModelRef,
  type ProviderDef,
  type ProviderId,
  parseModelRef,
} from '../../core/providers/types.ts'
import {
  BackIcon,
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  ExternalIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from '../icons.tsx'
import { ModelSelect } from '../model-select.tsx'
import { PROVIDER_ICONS } from '../provider-icons.tsx'
import { KeybindingRecorder } from './keybinding-recorder.tsx'

/** Row actions are drawn at one size rather than each icon's own default. */
const ACTION_ICON = 18

/** All the panel needs from a provider. A real `ProviderDef` satisfies it as-is. */
export type ProviderView = Pick<ProviderDef, 'id' | 'label' | 'auth'>

export interface SettingsPanelProps {
  keybinding: string
  onKeybindingChange: (accelerator: string) => void
  /** Passed straight through to the recorder; see KeybindingRecorderProps. */
  onRecordingChange?: (recording: boolean) => void

  models: readonly ModelOption[]
  selectedModel?: ModelRef
  onSelectModel: (ref: ModelRef) => void

  /** Extended thinking. Off by default; see ModelPrefs.thinking. */
  thinking: boolean
  onThinkingChange: (on: boolean) => void
  /** False when the selected model cannot reason — the toggle explains itself. */
  thinkingSupported: boolean

  providers: readonly ProviderView[]
  credentials: Partial<Record<ProviderId, Credential>>
  /** API-key providers pass the typed key; OAuth providers pass nothing. */
  onConnect: (providerId: ProviderId, apiKey?: string) => void
  onDisconnect: (providerId: ProviderId) => void

  /** Provider mid-flow — its row goes busy. */
  busyProviderId?: ProviderId
  error?: string
  onClose: () => void
}

const isConnected = (credential: Credential | undefined): boolean =>
  credential !== undefined && credential.type !== 'none'

const maskKey = (credential: Credential | undefined): string => {
  if (credential?.type !== 'api') return ''
  const tail = credential.key.slice(-4)
  // Four bullets, not eight: this stands for a key, it does not have to look like one.
  return `••••${tail}`
}

interface ProviderRowProps {
  provider: ProviderView
  credential: Credential | undefined
  busy: boolean
  onConnect: (providerId: ProviderId, apiKey?: string) => void
  onDisconnect: (providerId: ProviderId) => void
}

/**
 * One provider, one line, with its action named on the line — Add/Edit for a key,
 * Connect/Disconnect for OAuth. Only the key field, which needs somewhere to type, opens.
 */
function ProviderRow({ provider, credential, busy, onConnect, onDisconnect }: ProviderRowProps) {
  const [editing, setEditing] = useState(false)
  const [draftKey, setDraftKey] = useState('')
  const keyRef = useRef<HTMLInputElement>(null)

  // A ref rather than autoFocus, which only fires on first mount and so would miss the
  // second time a row is opened.
  useEffect(() => {
    if (editing) keyRef.current?.focus()
  }, [editing])
  const connected = isConnected(credential)
  const { auth } = provider
  const Mark = PROVIDER_ICONS[provider.id]

  const close = () => {
    setEditing(false)
    setDraftKey('')
  }

  const submitKey = () => {
    const key = draftKey.trim()
    if (!key) return
    onConnect(provider.id, key)
    close()
  }

  const state = busy
    ? 'Waiting…'
    : auth.kind === 'none'
      ? 'local'
      : connected
        ? auth.kind === 'apiKey'
          ? maskKey(credential)
          : 'connected'
        : ''

  return (
    <div className="pa-provider">
      <div className="pa-provider-row">
        <Mark size={15} className="pa-provider-mark" />
        <span className="pa-provider-name">{provider.label}</span>

        {editing && auth.kind === 'apiKey' ? (
          <>
            {/* The field takes the row: the key belongs where its value already is. */}
            <input
              ref={keyRef}
              className="pa-text-input pa-provider-input"
              type="password"
              value={draftKey}
              placeholder={connected ? 'Replace key…' : auth.placeholder}
              title={auth.help}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setDraftKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  // Otherwise this closes the whole settings pane.
                  event.stopPropagation()
                  close()
                  return
                }
                if (event.key !== 'Enter') return
                event.preventDefault()
                submitKey()
              }}
              aria-label={`${provider.label} API key`}
            />
            <span className="pa-provider-actions">
              <button
                className="pa-icon-btn pa-icon-btn--row"
                type="button"
                disabled={busy || draftKey.trim().length === 0}
                onClick={submitKey}
                aria-label={`Save ${provider.label} API key`}
                title="Save"
              >
                <CheckIcon size={ACTION_ICON} />
              </button>
              <button
                className="pa-icon-btn pa-icon-btn--row"
                type="button"
                onClick={close}
                aria-label="Cancel"
                title="Cancel"
              >
                <CloseIcon size={ACTION_ICON} />
              </button>
            </span>
          </>
        ) : (
          <>
            <span className="pa-provider-state">{state}</span>

            <span className="pa-provider-actions">
              {auth.kind === 'apiKey' ? (
                <button
                  className="pa-icon-btn pa-icon-btn--row"
                  type="button"
                  disabled={busy}
                  onClick={() => setEditing(true)}
                  aria-label={
                    connected
                      ? `Replace ${provider.label} API key`
                      : `Add ${provider.label} API key`
                  }
                  title={connected ? 'Replace key' : 'Add key'}
                >
                  {connected ? <PencilIcon size={ACTION_ICON} /> : <PlusIcon size={ACTION_ICON} />}
                </button>
              ) : null}

              {auth.kind === 'oauth' && !connected ? (
                <button
                  className="pa-icon-btn pa-icon-btn--row"
                  type="button"
                  disabled={busy}
                  onClick={() => onConnect(provider.id)}
                  aria-label={`Connect ${provider.label}`}
                  title="Connect"
                >
                  <ExternalIcon size={ACTION_ICON} />
                </button>
              ) : null}

              {connected && auth.kind !== 'none' ? (
                <button
                  className="pa-icon-btn pa-icon-btn--row"
                  type="button"
                  disabled={busy}
                  onClick={() => onDisconnect(provider.id)}
                  aria-label={
                    auth.kind === 'apiKey'
                      ? `Remove ${provider.label} API key`
                      : `Disconnect ${provider.label}`
                  }
                  title={auth.kind === 'apiKey' ? 'Remove key' : 'Disconnect'}
                >
                  <TrashIcon size={ACTION_ICON} />
                </button>
              ) : null}
            </span>
          </>
        )}
      </div>
    </div>
  )
}

/** Settings: shortcut, model, providers. Knows nothing about how auth works. */
export function SettingsPanel({
  thinking,
  onThinkingChange,
  thinkingSupported,
  keybinding,
  onKeybindingChange,
  onRecordingChange,
  models,
  selectedModel,
  onSelectModel,
  providers,
  credentials,
  onConnect,
  onDisconnect,
  busyProviderId,
  error,
  onClose,
}: SettingsPanelProps) {
  /*
   * A native <select> cannot draw anything inside its own options, so the provider mark
   * sits beside the closed control — where it does the work that matters, saying which
   * of the six providers is about to answer. The open menu groups by provider label,
   * which is the same information in words.
   */
  const SelectedMark = selectedModel
    ? PROVIDER_ICONS[parseModelRef(selectedModel).provider]
    : undefined

  const row = (provider: ProviderView) => (
    <ProviderRow
      key={provider.id}
      provider={provider}
      credential={credentials[provider.id]}
      busy={busyProviderId === provider.id}
      onConnect={onConnect}
      onDisconnect={onDisconnect}
    />
  )

  return (
    <div className="pa-settings">
      {/* The topmost element here, so it carries the drag region that the query-field
          header provides on the other pages. */}
      <div className="pa-settings-head" data-tauri-drag-region>
        <button
          className="pa-icon-btn pa-icon-btn--back"
          type="button"
          onClick={onClose}
          aria-label="Back"
        >
          <BackIcon size={21} />
        </button>
        <span className="pa-settings-title">Settings</span>
      </div>

      <div className="pa-settings-scroll">
        {/* One grouped card of label-left / control-right rows, the way a System Settings
            pane is laid out. Standalone sections cost ~100px more for the same content. */}
        <div className="pa-group">
          <div className="pa-group-row">
            <span className="pa-group-label">Shortcut</span>
            <div className="pa-group-control">
              <KeybindingRecorder
                value={keybinding}
                onChange={onKeybindingChange}
                onRecordingChange={onRecordingChange}
              />
            </div>
          </div>

          <div className="pa-group-row">
            <span className="pa-group-label">Model</span>
            <div className="pa-group-control">
              <div className="pa-select-wrap">
                {SelectedMark ? <SelectedMark size={14} className="pa-select-mark" /> : null}
                <ModelSelect
                  className={SelectedMark ? 'pa-select pa-select--marked' : 'pa-select'}
                  models={models}
                  value={selectedModel}
                  onSelect={onSelectModel}
                  disabled={models.length === 0}
                  placeholder={models.length === 0 ? 'Connect a provider first' : 'Choose a model…'}
                />
                <ChevronDownIcon className="pa-select-caret" />
              </div>
            </div>
          </div>

          <label className="pa-group-row">
            <span className="pa-group-text">
              <span className="pa-group-label">Extended thinking</span>
              <span className="pa-group-sub">
                {thinkingSupported
                  ? 'Slower, better on hard questions.'
                  : 'Not supported by this model.'}
              </span>
            </span>
            <span className="pa-group-control">
              <input
                type="checkbox"
                className="pa-toggle-input"
                checked={thinking && thinkingSupported}
                disabled={!thinkingSupported}
                onChange={(event) => onThinkingChange(event.target.checked)}
              />
              <span className="pa-toggle-track" aria-hidden="true">
                <span className="pa-toggle-knob" />
              </span>
            </span>
          </label>
        </div>

        <div className="pa-section">
          <div className="pa-section-label">Providers</div>
          {/* All of them, always: six one-line rows fit inside the panel's cap, and
              hiding the unconfigured ones hides what the app supports. */}
          <div className="pa-providers">{providers.map(row)}</div>
        </div>

        {error ? <div className="pa-error">{error}</div> : null}
      </div>
    </div>
  )
}
