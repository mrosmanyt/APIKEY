/**
 * Global keyboard shortcuts. Matching uses physical key codes (e.code) so shortcuts work with
 * any keyboard layout (e.g. Urdu). Ctrl on Windows/Linux, ⌘ on macOS.
 */
import type { Page } from './pages'

export type ShortcutAction =
  | { type: 'newChat' }
  | { type: 'stop' }
  | { type: 'focusInput' }
  | { type: 'help' }
  | { type: 'goto'; page: Page }

/** Screen order for Ctrl+1 … Ctrl+8 (matches the sidebar). */
export const SCREEN_ORDER: Page[] = [
  'chat',
  'images',
  'video',
  'audio',
  'code',
  'history',
  'prompts',
  'settings'
]

export interface KeyLike {
  key: string
  code?: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}

export function matchShortcut(e: KeyLike): ShortcutAction | undefined {
  const mod = Boolean(e.ctrlKey || e.metaKey)
  if (e.altKey) return undefined
  if (!mod && !e.shiftKey && e.key === 'Escape') return { type: 'stop' }
  if (!mod && e.key === 'F1') return { type: 'help' }
  if (!mod || e.shiftKey) return undefined
  const code = e.code ?? ''
  const digit =
    /^(?:Digit|Numpad)([1-8])$/.exec(code)?.[1] ?? (/^[1-8]$/.test(e.key) ? e.key : undefined)
  if (digit) return { type: 'goto', page: SCREEN_ORDER[Number(digit) - 1] }
  if (code === 'KeyN' || (!code && e.key.toLowerCase() === 'n')) return { type: 'newChat' }
  if (code === 'KeyL' || (!code && e.key.toLowerCase() === 'l')) return { type: 'focusInput' }
  if (code === 'Comma' || e.key === ',') return { type: 'goto', page: 'settings' }
  if (code === 'Slash' || e.key === '/') return { type: 'help' }
  return undefined
}

/** Rows for the help screen: key caps + i18n label key (+ optional screen for "Go to"). */
export interface ShortcutHelpRow {
  keys: string[]
  label:
    'newChat' | 'send' | 'newline' | 'stop' | 'focusInput' | 'goTo' | 'settings' | 'help' | 'close'
  screen?: Page
}

export function shortcutHelp(mac = false): ShortcutHelpRow[] {
  const mod = mac ? '⌘' : 'Ctrl'
  return [
    { keys: [mod, 'N'], label: 'newChat' },
    { keys: ['Enter'], label: 'send' },
    { keys: ['Shift', 'Enter'], label: 'newline' },
    { keys: ['Esc'], label: 'stop' },
    { keys: [mod, 'L'], label: 'focusInput' },
    ...SCREEN_ORDER.map((page, i) => ({
      keys: [mod, String(i + 1)],
      label: 'goTo' as const,
      screen: page
    })),
    { keys: [mod, ','], label: 'settings' },
    { keys: [mod, '/'], label: 'help' },
    { keys: ['F1'], label: 'help' },
    { keys: ['Esc'], label: 'close' }
  ]
}

export const SHORTCUT_EVENT = 'aihub:shortcut'

export function emitShortcut(action: ShortcutAction): void {
  window.dispatchEvent(new CustomEvent(SHORTCUT_EVENT, { detail: action }))
}
