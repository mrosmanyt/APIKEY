import { describe, expect, it } from 'vitest'
import { matchShortcut, SCREEN_ORDER, shortcutHelp } from '../src/renderer/src/lib/shortcuts'

describe('keyboard shortcuts', () => {
  it('maps the documented shortcuts', () => {
    expect(matchShortcut({ key: 'n', code: 'KeyN', ctrlKey: true })).toEqual({ type: 'newChat' })
    expect(matchShortcut({ key: 'Escape', code: 'Escape' })).toEqual({ type: 'stop' })
    expect(matchShortcut({ key: 'l', code: 'KeyL', ctrlKey: true })).toEqual({ type: 'focusInput' })
    expect(matchShortcut({ key: ',', code: 'Comma', ctrlKey: true })).toEqual({
      type: 'goto',
      page: 'settings'
    })
    expect(matchShortcut({ key: '/', code: 'Slash', ctrlKey: true })).toEqual({ type: 'help' })
    expect(matchShortcut({ key: 'F1', code: 'F1' })).toEqual({ type: 'help' })
  })

  it('switches screens with Ctrl+1…8 (top row and numpad) in sidebar order', () => {
    SCREEN_ORDER.forEach((page, i) => {
      expect(matchShortcut({ key: String(i + 1), code: `Digit${i + 1}`, ctrlKey: true })).toEqual({
        type: 'goto',
        page
      })
    })
    expect(matchShortcut({ key: '2', code: 'Numpad2', ctrlKey: true })).toEqual({
      type: 'goto',
      page: 'images'
    })
    expect(matchShortcut({ key: '9', code: 'Digit9', ctrlKey: true })).toBeUndefined()
  })

  it('works with non-Latin keyboard layouts (physical key codes)', () => {
    // Urdu layout: the N key produces "ن" but e.code is still KeyN.
    expect(matchShortcut({ key: 'ن', code: 'KeyN', ctrlKey: true })).toEqual({ type: 'newChat' })
  })

  it('supports ⌘ on macOS and ignores unrelated combos', () => {
    expect(matchShortcut({ key: 'n', code: 'KeyN', metaKey: true })).toEqual({ type: 'newChat' })
    expect(matchShortcut({ key: 'n', code: 'KeyN' })).toBeUndefined()
    expect(matchShortcut({ key: 'n', code: 'KeyN', ctrlKey: true, shiftKey: true })).toBeUndefined()
    expect(matchShortcut({ key: 'n', code: 'KeyN', ctrlKey: true, altKey: true })).toBeUndefined()
    expect(matchShortcut({ key: 'c', code: 'KeyC', ctrlKey: true })).toBeUndefined() // copy stays native
    expect(matchShortcut({ key: 'Escape', code: 'Escape', ctrlKey: true })).toBeUndefined()
  })

  it('lists every shortcut on the help screen', () => {
    const rows = shortcutHelp()
    expect(rows.filter((r) => r.label === 'goTo')).toHaveLength(8)
    expect(rows.find((r) => r.label === 'newChat')!.keys).toEqual(['Ctrl', 'N'])
    expect(shortcutHelp(true).find((r) => r.label === 'newChat')!.keys).toEqual(['⌘', 'N'])
  })
})
