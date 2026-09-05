import { useState } from 'react'
import type { ModelOption, ModelRef } from '../core/providers/types.ts'
import { openPickerOnEnter } from './open-picker.ts'

export interface ModelSelectProps {
  models: readonly ModelOption[]
  value?: ModelRef
  onSelect: (ref: ModelRef) => void
  className: string
  /** Shown as the leading option while nothing is selected. */
  placeholder: string
  disabled?: boolean
  /** Drop focus after a pick — for a chip that only borrows it from the query field. */
  blurOnSelect?: boolean
  /** Runs after a pick, once focus has been dealt with. */
  onDone?: () => void
}

const groupByProvider = (models: readonly ModelOption[]): Map<string, ModelOption[]> => {
  const groups = new Map<string, ModelOption[]>()
  for (const model of models) {
    const bucket = groups.get(model.providerLabel)
    if (bucket) bucket.push(model)
    else groups.set(model.providerLabel, [model])
  }
  return groups
}

/**
 * The native `<select>` behind every model chooser. macOS renders it as a popup menu, so
 * keyboard access, type-ahead and the checkmark on the current item come for free;
 * callers paint whatever sits over or beside it.
 *
 * `data-pointer` marks a focus that arrived by click. `:focus-visible` matches a
 * `<select>` even then — per spec, because it takes arrow keys once focused — so the ring
 * latched on and outlived the popup it came from. Any key clears the flag, so Tab still
 * rings.
 */
export function ModelSelect({
  models,
  value,
  onSelect,
  className,
  placeholder,
  disabled = false,
  blurOnSelect = false,
  onDone,
}: ModelSelectProps) {
  const [byPointer, setByPointer] = useState(false)

  return (
    <select
      className={className}
      data-pointer={byPointer ? '' : undefined}
      value={value ?? ''}
      disabled={disabled}
      onPointerDown={() => setByPointer(true)}
      onKeyDown={(event) => {
        setByPointer(false)
        openPickerOnEnter(event)
      }}
      onBlur={() => setByPointer(false)}
      onChange={(event) => {
        onSelect(event.target.value as ModelRef)
        if (blurOnSelect) event.target.blur()
        onDone?.()
      }}
      aria-label="Model"
    >
      {value === undefined ? <option value="">{placeholder}</option> : null}
      {[...groupByProvider(models)].map(([providerLabel, options]) => (
        <optgroup label={providerLabel} key={providerLabel}>
          {options.map((option) => (
            <option value={option.ref} key={option.ref}>
              {option.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
