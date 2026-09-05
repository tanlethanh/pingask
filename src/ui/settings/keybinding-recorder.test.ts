import { describe, expect, test } from 'bun:test'
import type { KeyboardEvent } from 'react'
import { acceleratorFromEvent } from './keybinding-recorder.tsx'

/** Only the fields the parser reads. */
const press = (init: {
  code: string
  key: string
  altKey?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
}) => init as unknown as KeyboardEvent<HTMLElement>

describe('acceleratorFromEvent', () => {
  test('reads the physical key, not what Option composed it into', () => {
    // macOS turns ⌥P into "π". Reading event.key would store "Alt+Π".
    expect(acceleratorFromEvent(press({ code: 'KeyP', key: 'π', altKey: true }))).toBe('Alt+P')
  })

  test('handles the default binding', () => {
    expect(acceleratorFromEvent(press({ code: 'KeyP', key: 'p', ctrlKey: true }))).toBe('Control+P')
  })

  test('keeps Control and Command apart', () => {
    // Collapsing both into CmdOrCtrl would record a Ctrl chord as ⌘ on macOS, and the
    // default Control+P could never be re-entered through the recorder.
    expect(acceleratorFromEvent(press({ code: 'KeyP', key: 'p', metaKey: true }))).toBe(
      'CmdOrCtrl+P',
    )
    expect(
      acceleratorFromEvent(press({ code: 'KeyP', key: 'p', ctrlKey: true, metaKey: true })),
    ).toBe('Control+CmdOrCtrl+P')
  })

  test('orders modifiers Control, Cmd, Alt, Shift', () => {
    const accelerator = acceleratorFromEvent(
      press({ code: 'KeyK', key: 'k', metaKey: true, altKey: true, shiftKey: true }),
    )
    expect(accelerator).toBe('CmdOrCtrl+Alt+Shift+K')
  })

  test('maps Space and digits by position', () => {
    expect(acceleratorFromEvent(press({ code: 'Space', key: ' ', metaKey: true }))).toBe(
      'CmdOrCtrl+Space',
    )
    expect(acceleratorFromEvent(press({ code: 'Digit1', key: '¡', altKey: true }))).toBe('Alt+1')
  })

  test('Escape cancels', () => {
    expect(acceleratorFromEvent(press({ code: 'Escape', key: 'Escape' }))).toBeNull()
  })

  test('a bare key is not a global shortcut', () => {
    expect(acceleratorFromEvent(press({ code: 'KeyP', key: 'p' }))).toBeUndefined()
  })

  test('modifiers alone leave the chord incomplete', () => {
    expect(
      acceleratorFromEvent(press({ code: 'AltLeft', key: 'Alt', altKey: true })),
    ).toBeUndefined()
  })
})
