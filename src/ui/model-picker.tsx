import { type ModelOption, type ModelRef, parseModelRef } from '../core/providers/types.ts'
import { ChevronDownIcon } from './icons.tsx'
import { ModelSelect } from './model-select.tsx'
import { PROVIDER_ICONS } from './provider-icons.tsx'

export interface ModelPickerProps {
  models: readonly ModelOption[]
  selected?: ModelRef
  /** Human label for `selected`; the chip shows this, not the raw ref. */
  label?: string
  onSelect: (ref: ModelRef) => void
  /** Called once the picker is finished with the keyboard, so focus can go home. */
  onDone?: () => void
}

/**
 * The active model in the footer, and a way to change it without opening settings.
 *
 * The `<select>` sits transparently over the chip; the visible chip is only paint —
 * which is what lets it carry the provider mark, something a native option list cannot
 * show.
 */
export function ModelPicker({ models, selected, label, onSelect, onDone }: ModelPickerProps) {
  if (models.length === 0) return null

  const Mark = selected ? PROVIDER_ICONS[parseModelRef(selected).provider] : undefined

  return (
    <span className="pa-model-picker">
      {Mark ? <Mark size={12} className="pa-model-mark" /> : null}
      <span className="pa-model-name">{label ?? 'Choose a model'}</span>
      <ChevronDownIcon size={10} className="pa-model-caret" />
      <ModelSelect
        className="pa-model-select"
        models={models}
        value={selected}
        onSelect={onSelect}
        placeholder="Choose a model…"
        // The query field is where typing belongs; leaving focus on the chip both strands
        // the caret and keeps the ring lit.
        blurOnSelect
        onDone={onDone}
      />
    </span>
  )
}
