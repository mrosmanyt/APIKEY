import { en, type Dictionary } from './en'

type Join<K, P> = K extends string ? (P extends string ? `${K}.${P}` : never) : never
type Leaves<T> = T extends string
  ? never
  : { [K in keyof T]: T[K] extends string ? K : Join<K, Leaves<T[K]>> }[keyof T]
export type TranslationKey = Leaves<Dictionary>

const dictionaries: Record<string, Dictionary> = { en }
export const LANGUAGES: Array<{ code: string; name: string }> = [{ code: 'en', name: 'English' }]

let current: Dictionary = en

export function setLanguage(code: string): void {
  current = dictionaries[code] ?? en
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
