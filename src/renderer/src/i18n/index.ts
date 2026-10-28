import { en, type Dictionary } from './en'
import { ur } from './ur'

type Join<K, P> = K extends string ? (P extends string ? `${K}.${P}` : never) : never
type Leaves<T> = T extends string
  ? never
  : { [K in keyof T]: T[K] extends string ? K : Join<K, Leaves<T[K]>> }[keyof T]
export type TranslationKey = Leaves<Dictionary>

const dictionaries: Record<string, Dictionary> = { en, ur }

export interface Language {
  code: string
  /** Name in the language itself. */
  name: string
  dir: 'ltr' | 'rtl'
}

export const LANGUAGES: Language[] = [
  { code: 'en', name: 'English', dir: 'ltr' },
  { code: 'ur', name: 'اردو (Urdu)', dir: 'rtl' }
]

let current: Dictionary = en

export function languageDir(code: string): 'ltr' | 'rtl' {
  return LANGUAGES.find((l) => l.code === code)?.dir ?? 'ltr'
}

/** Switch the UI language; also sets <html lang> and dir (right-to-left for Urdu). */
export function setLanguage(code: string): void {
  current = dictionaries[code] ?? en
  if (typeof document !== 'undefined') {
    const lang = dictionaries[code] ? code : 'en'
    document.documentElement.lang = lang
    document.documentElement.dir = languageDir(lang)
  }
}

function lookup(dict: Dictionary, key: string): string | undefined {
  let node: unknown = dict
  for (const part of key.split('.')) {
    if (node && typeof node === 'object') node = (node as Record<string, unknown>)[part]
    else return undefined
  }
  return typeof node === 'string' ? node : undefined
}

/** Translate a key, with {placeholder} interpolation. Falls back to English, then the key. */
export function t(key: TranslationKey, vars?: Record<string, string | number>): string {
  const raw = lookup(current, key) ?? lookup(en, key) ?? key
  if (!vars) return raw
  return raw.replace(/\{(\w+)\}/g, (_, name: string) =>
    name in vars ? String(vars[name]) : `{${name}}`
  )
}

/** Translate a dynamic key (e.g. built from an enum) — falls back to the key itself. */
export function tDynamic(key: string, vars?: Record<string, string | number>): string {
  return t(key as TranslationKey, vars)
}
