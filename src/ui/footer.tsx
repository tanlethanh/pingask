import type { ReactNode } from 'react'
import { AlertIcon, PowerIcon, SettingsIcon } from './icons.tsx'

export interface KeyHint {
  /** Display strings, e.g. ['esc'] or ['⌘', '⏎']. Rendered as separate keycaps. */
  keys: readonly string[]
  label: string
}

interface FooterBase {
  /**
   * Contextual hints. Esc means different things per state (PLAN #10), so the page hands
   * the right set down — this never computes it.
   */
  hints: readonly KeyHint[]
  /** The model chip, composed by the page. Hidden while `warning` is set. */
  model?: ReactNode
  /** Something needs attention — no credentials yet, say. Flags the gear. */
  warning?: string
}

/**
 * The rail's right-hand control is one button with two jobs, never both: the gear on the
 * main view, and quit once settings is already open. A union rather than two optional
 * handlers, so a caller cannot ask for both and get whichever render order picks.
 */
export type FooterProps = FooterBase &
  (
    | { onOpenSettings: () => void; onQuit?: never; version?: never }
    /**
     * `version` rides with quit because it belongs to the same page: settings names no
     * model, so the chip slot is free for it. Undefined until the lookup resolves.
     */
    | { onQuit: () => void; version?: string; onOpenSettings?: never; warning?: never }
  )

/** The thin bottom rail: key hints on the left, model and one action on the right. */
export function Footer({ hints, model, onOpenSettings, onQuit, version, warning }: FooterProps) {
  return (
    <div className="pa-footer">
      <div className="pa-hints">
        {hints.map((hint) => (
          <span className="pa-hint" key={`${hint.keys.join('+')}-${hint.label}`}>
            {hint.keys.map((key) => (
              <kbd className="pa-kbd" key={key}>
                {key}
              </kbd>
            ))}
            {hint.label}
          </span>
        ))}
      </div>
      <div className="pa-footer-right">
        {warning ? <span className="pa-model pa-model--warning">{warning}</span> : model}
        {/* Where the model chip sits on the other pages: settings has no model to name,
            so the slot carries the one fact you come here to read instead. */}
        {version ? <span className="pa-version">Pingask {version}</span> : null}
        {onQuit ? (
          <button
            className="pa-icon-btn pa-icon-btn--lg"
            type="button"
            onClick={onQuit}
            aria-label="Quit Pingask"
            title="Quit"
          >
            <PowerIcon />
          </button>
        ) : (
          <button
            className={
              warning
                ? 'pa-icon-btn pa-icon-btn--lg pa-icon-btn--warning'
                : 'pa-icon-btn pa-icon-btn--lg'
            }
            type="button"
            onClick={onOpenSettings}
            aria-label="Settings"
            title={warning ?? 'Settings'}
          >
            {warning ? <AlertIcon /> : <SettingsIcon />}
          </button>
        )}
      </div>
    </div>
  )
}
