import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { KeyboardIcon } from '../icons.tsx'

const isMac = (): boolean =>
  typeof navigator !== 'undefined' &&
  (navigator.platform?.includes('Mac') || navigator.userAgent.includes('Mac'))

/** "Alt+P" → ["⌥", "P"]. Ported from v1. */
export const formatAccelerator = (accelerator: string): string[] =>
  accelerator
    .split('+')
    .filter(Boolean)
    .map((key) => {
      if (key === 'CmdOrCtrl') return isMac() ? '⌘' : 'Ctrl'
      if (key === 'Cmd' || key === 'Super' || key === 'Meta') return '⌘'
      if (key === 'Ctrl' || key === 'Control') return 'Ctrl'
      if (key === 'Alt' || key === 'Option') return '⌥'
      if (key === 'Shift') return '⇧'
      return key
    })

/**
 * The physical key, independent of what the modifiers turned it into.
 *
 * macOS composes with Option: ⌥P arrives as `event.key === 'π'`, ⌥N as a dead key, and no
 * accelerator parser accepts `Alt+Π`. `event.code` is the key's position, so ⌥P is `KeyP`
 * either way.
 */
const physicalKey = (event: KeyboardEvent<HTMLElement>): string | undefined => {
  const code = event.code
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F[0-9]{1,2}$/.test(code)) return code
  if (code === 'Space') return 'Space'
  if (code === 'Minus') return '-'
  if (code === 'Equal') return '='
  if (code === 'Comma') return ','
  if (code === 'Period') return '.'
  if (code === 'Slash') return '/'
  if (code === 'Backslash') return '\\'
  if (code === 'Semicolon') return ';'
  if (code === 'Quote') return "'"
  if (code === 'BracketLeft') return '['
  if (code === 'BracketRight') return ']'
  if (code === 'Backquote') return '`'
  if (code.startsWith('Arrow')) return code.slice(5)
  if (['Enter', 'Tab', 'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'PageDown'].includes(code))
    return code

  // Unknown physical key: fall back to the character, which is right for layouts
  // this table does not cover.
  const key = event.key
  if (!key || ['Meta', 'Control', 'Alt', 'Shift'].includes(key)) return undefined
  return key === ' ' ? 'Space' : key.length === 1 ? key.toUpperCase() : key
}

/**
 * A keydown → Tauri accelerator string. Returns null for "cancel" (Escape) and
 * undefined while the chord is still incomplete (modifiers only). Ported from v1.
 */
export const acceleratorFromEvent = (
  event: KeyboardEvent<HTMLElement>,
): string | null | undefined => {
  if (event.key === 'Escape') return null

  const keys: string[] = []
  // Control and Command are kept apart: collapsing both into CmdOrCtrl means a chord
  // recorded with Ctrl registers as ⌘ on macOS, so the default Control+P could never be
  // re-entered here. `CmdOrCtrl` for Command assumes macOS (decision #17).
  if (event.ctrlKey) keys.push('Control')
  if (event.metaKey) keys.push('CmdOrCtrl')
  if (event.altKey) keys.push('Alt')
  if (event.shiftKey) keys.push('Shift')

  const main = physicalKey(event)
  if (main !== undefined) keys.push(main)

  // A bare key is not a global shortcut — at least one modifier is required.
  return keys.length > 1 ? keys.join('+') : undefined
}

export interface KeybindingRecorderProps {
  /** Current accelerator, e.g. "Alt+P". */
  value: string
  onChange: (accelerator: string) => void
  disabled?: boolean
  /**
   * Fires as recording starts and stops. The global shortcut has to be released while
   * recording — the OS consumes a registered chord before the webview sees it — and this
   * component cannot unregister anything itself; it lives in ui/.
   */
  onRecordingChange?: (recording: boolean) => void
}

/** Captures a chord and emits a Tauri accelerator string. */
export function KeybindingRecorder({
  value,
  onChange,
  disabled = false,
  onRecordingChange,
}: KeybindingRecorderProps) {
  const [recording, setRecording] = useState(false)
  const notify = useRef(onRecordingChange)
  notify.current = onRecordingChange

  useEffect(() => {
    notify.current?.(recording)
  }, [recording])

  // Leaving settings mid-recording must not strand the shortcut in the released state.
  useEffect(() => () => notify.current?.(false), [])
  const inputRef = useRef<HTMLInputElement | null>(null)
  const keys = formatAccelerator(value)

  const stop = () => {
    setRecording(false)
    inputRef.current?.blur()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!recording) return
    event.preventDefault()
    event.stopPropagation()

    const accelerator = acceleratorFromEvent(event)
    if (accelerator === null) {
      stop()
      return
    }
    if (accelerator === undefined) return

    onChange(accelerator)
    // Let the finished chord land on screen before dropping out of record mode.
    setTimeout(stop, 300)
  }

  return (
    <>
      {/* Only while recording: a standing hint restates the button and costs a line. */}
      {recording ? <p className="pa-inline-hint">Press modifiers + a key. Esc cancels.</p> : null}
      <div className={recording ? 'pa-field is-recording' : 'pa-field'}>
        <div className="pa-chord">
          {keys.length === 0 ? <span className="pa-chord-empty">Not set</span> : null}
          {/* No "+" between caps: the glyphs already read as one chord. */}
          {keys.map((key) => (
            <kbd className="pa-kbd pa-kbd--lg" key={key}>
              {key}
            </kbd>
          ))}
        </div>

        <button
          className={recording ? 'pa-record is-recording' : 'pa-record'}
          type="button"
          disabled={disabled}
          // Keep focus in the hidden input so "Stop" is not swallowed by the blur.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => (recording ? stop() : inputRef.current?.focus())}
          aria-label={recording ? 'Stop recording shortcut' : 'Record shortcut'}
          title={recording ? 'Stop recording' : 'Record shortcut'}
        >
          {recording ? <span className="pa-recording-dot" /> : <KeyboardIcon size={20} />}
        </button>

        <input
          ref={inputRef}
          className="pa-visually-hidden"
          type="text"
          readOnly
          tabIndex={-1}
          aria-label="Keybinding recorder"
          onFocus={() => setRecording(true)}
          onBlur={() => setRecording(false)}
          onKeyDown={handleKeyDown}
        />
      </div>
    </>
  )
}
