import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react'
import type { Ports } from './core/ports.ts'
import type { Settings } from './core/settings/schema.ts'
import type { Thread } from './core/threads/model.ts'
import { type UseAsk, useAsk } from './hooks/use-ask.ts'
import { type UseCredentials, useCredentials } from './hooks/use-credentials.ts'
import { type UseModels, useModels } from './hooks/use-models.ts'
import { type Page, useNavigation } from './hooks/use-navigation.ts'
import { usePanelWindow } from './hooks/use-panel-window.ts'
import { usePorts } from './hooks/use-ports.ts'
import { useSettings } from './hooks/use-settings.ts'
import { useShortcuts } from './hooks/use-shortcuts.ts'
import { type UseThreads, useThreads } from './hooks/use-threads.ts'
import { useUnhandled } from './hooks/use-unhandled.ts'
import { appWindow } from './platform/index.ts'

/**
 * The shell: one window, one set of services, and the few pieces of state that outlive a
 * page. State belongs here only if more than one page needs it — the question text does,
 * because it survives launcher → thread; a highlighted history row does not.
 */
export interface AppValue {
  ports: Ports
  settings: Settings
  save: (patch: Partial<Settings>) => Promise<void>
  credentials: UseCredentials
  models: UseModels
  threads: UseThreads
  ask: UseAsk

  page: Page
  /** A question has been asked, or a thread picked: go read it. */
  goToThread: () => void

  /**
   * Why the panel cannot answer anything yet, if it cannot — the rail shows this where
   * the model chip goes.
   *
   * Undefined while that is still unknown: the credential store and the catalogs load
   * asynchronously, and without this the warning appeared and vanished on every launch of
   * a perfectly configured app.
   */
  providerWarning?: string

  question: string
  setQuestion: (value: string) => void
  /** The query field, so an action that ends in it can put the caret back. */
  inputRef: RefObject<HTMLInputElement | null>

  openSettings: () => void
  closeSettings: () => void
  /**
   * The keybinding recorder is capturing a chord, so every key belongs to it. It stops
   * propagation itself, but only because React delegates to the root container rather
   * than to document — the wrong thing for a shortcut to depend on.
   */
  recordingHotkey: boolean
  setRecordingHotkey: (recording: boolean) => void

  /** Back to the opening state, keeping an unasked question. */
  freshen: () => void
  /** Hide the window. Esc on the launcher, and every click away. */
  dismiss: () => Promise<void>
  /** Measured panel height, wired to the OS window. */
  onHeightChange: (px: number) => void
}

const AppContext = createContext<AppValue | undefined>(undefined)

/** The shell's state and services. Pages pull what they need; nothing is passed down. */
export const useApp = (): AppValue => {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp must be used inside <AppProvider>')
  return value
}

export function AppProvider({ children }: { children: ReactNode }) {
  const ports = usePorts()
  const { settings, loaded, save } = useSettings(ports)
  const credentials = useCredentials(ports)

  const [question, setQuestion] = useState('')
  const [recordingHotkey, setRecordingHotkey] = useState(false)
  const nav = useNavigation()
  const inputRef = useRef<HTMLInputElement>(null)

  const threads = useThreads(ports, question)
  const models = useModels(ports, credentials.credentials, settings.model)

  const ask = useAsk({
    ports,
    settings,
    modelRef: models.active,
    modelCatalog: models.models,
    ensure: credentials.ensure,
    // As soon as a turn finishes rather than on Esc: decision #10 only requires that a
    // thread with an answer survives, but this also means a crash cannot lose one.
    onPersist: useCallback(
      (thread: Thread) => {
        if (thread.messages.some((message) => message.role === 'assistant' && message.text)) {
          void threads.persist(thread)
        }
      },
      [threads.persist],
    ),
  })

  // Anything that escapes lands on the turn it belongs to, rather than one line in a
  // console the user does not have open.
  useUnhandled(ask.report)

  /*
   * A fresh window every time the hotkey brings it up (decision #10), except a question
   * typed but not yet asked: the panel hides the moment you click away, and losing a
   * half-written question because you went to look something up is the opposite of
   * useful. Anything that reached a thread is cleared — that conversation is in the
   * recents list now.
   */
  const freshen = useCallback(() => {
    nav.reset()
    if (ask.thread.messages.length > 0) setQuestion('')
    ask.reset()
  }, [ask.reset, ask.thread.messages.length, nav.reset])

  const goToThread = useCallback(() => nav.push('thread'), [nav.push])

  /*
   * Keyed on whether a model resolved, not on whether a credential is stored. Ollama
   * needs no credential, so a check for one could never be satisfied by it however many
   * models were pulled — and this also covers a key that is present but whose catalog
   * came back empty.
   */
  const providerWarning =
    credentials.loaded && models.loaded && !models.active
      ? 'Connect a provider to start asking'
      : undefined

  const openSettings = useCallback(() => {
    credentials.clearError()
    // Opening settings is the moment a stale provider list is visible.
    models.refresh()
    nav.push('settings')
  }, [credentials.clearError, models.refresh, nav.push])

  const closeSettings = useCallback(() => {
    credentials.clearError()
    nav.back()
  }, [credentials.clearError, nav.back])

  const { dismiss } = usePanelWindow({
    ports,
    keybinding: settings.keybinding,
    // Released while recording: a chord the OS already owns never reaches the webview, so
    // the current binding could not be re-recorded and pressing it would toggle the
    // window out from under the recorder.
    hotkeyEnabled: loaded && !recordingHotkey,
    busy: ask.streaming || credentials.busyProviderId !== undefined,
    freshen,
    onShown: () => {
      // The app stays resident for days: a model pulled into Ollama an hour ago should be
      // there when the window comes up, not after a restart.
      models.refresh()
      inputRef.current?.focus()
    },
  })

  // The one key that belongs to the shell rather than to a page. Everything else — Esc
  // above all — is bound by whichever page has to answer for it.
  useShortcuts([
    {
      key: '.',
      meta: true,
      when: !recordingHotkey,
      run: () => (nav.page === 'settings' ? closeSettings() : openSettings()),
    },
  ])

  return (
    <AppContext.Provider
      value={{
        ports,
        settings,
        save,
        credentials,
        models,
        threads,
        ask,
        page: nav.page,
        goToThread,
        providerWarning,
        question,
        setQuestion,
        inputRef,
        openSettings,
        closeSettings,
        recordingHotkey,
        setRecordingHotkey,
        freshen,
        dismiss,
        onHeightChange: (px: number) => void appWindow.setContentHeight(px),
      }}
    >
      {children}
    </AppContext.Provider>
  )
}
