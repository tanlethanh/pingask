import type { KeyboardEvent, Ref } from 'react'

export interface InputProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  /** Bubbles up arrow/escape keys so the parent can drive list selection. */
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
  disabled?: boolean
  placeholder?: string
  ref?: Ref<HTMLInputElement>
}

/** The query field. The parent owns focus; this just renders and reports. */
export function Input({
  value,
  onChange,
  onSubmit,
  onKeyDown,
  disabled = false,
  placeholder = 'Ask anything…',
  ref,
}: InputProps) {
  return (
    <form
      className="pa-input-form"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <input
        ref={ref}
        className="pa-input"
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        aria-label="Ask anything"
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        data-gramm="false"
        data-gramm_editor="false"
        data-enable-grammarly="false"
        data-1p-ignore
        data-lpignore="true"
        data-form-type="other"
      />
    </form>
  )
}
