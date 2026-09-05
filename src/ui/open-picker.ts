import type { KeyboardEvent } from 'react'

/**
 * Enter opens a `<select>`'s native menu.
 *
 * macOS opens a pop-up button with Space or an arrow key and does nothing on Enter, since
 * inside a form that key submits. Neither select here is in a form, and Enter is what
 * people press on the control they just tabbed to.
 *
 * `showPicker()` needs user activation, which a keydown is. It throws when the engine has
 * no picker; the arrow keys still change the value in place.
 */
export const openPickerOnEnter = (event: KeyboardEvent<HTMLSelectElement>): void => {
  if (event.key !== 'Enter') return
  const select = event.currentTarget
  if (!('showPicker' in select)) return
  event.preventDefault()
  try {
    select.showPicker()
  } catch {
    // No menu to open. The select keeps focus and its value is unchanged.
  }
}
