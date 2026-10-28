import { afterEach, describe, expect, it } from 'vitest'
import { languageDir, LANGUAGES, setLanguage, t, tDynamic } from '../src/renderer/src/i18n'
import { en } from '../src/renderer/src/i18n/en'
import { ur } from '../src/renderer/src/i18n/ur'

type Tree = { [k: string]: string | Tree }

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out[key] = v
    else Object.assign(out, flatten(v, key))
  }
  return out
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
const EN = flatten(en as unknown as Tree)
const UR = flatten(ur as unknown as Tree)

// Strings that are legitimately the same in every language.
const UNTRANSLATED = new Set(['app.name', 'license.placeholder', 'settings.techInfo'])

afterEach(() => setLanguage('en'))

describe('Urdu translation', () => {
  it('has exactly the same keys as English', () => {
    expect(Object.keys(UR).sort()).toEqual(Object.keys(EN).sort())
  })

  it('keeps every {placeholder}', () => {
    for (const key of Object.keys(EN)) {
      expect(placeholders(UR[key]), key).toEqual(placeholders(EN[key]))
    }
  })

  it('is actually translated into Urdu script', () => {
    const arabicScript = /[؀-ۿ]/
    for (const [key, value] of Object.entries(UR)) {
      expect(value.trim(), key).not.toBe('')
      if (!UNTRANSLATED.has(key)) expect(arabicScript.test(value), `${key}: ${value}`).toBe(true)
    }
  })

  it('is selectable and right-to-left', () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual(['en', 'ur'])
    expect(languageDir('ur')).toBe('rtl')
    expect(languageDir('en')).toBe('ltr')
    expect(languageDir('xx')).toBe('ltr')
  })

  it('translates with interpolation and falls back safely', () => {
    setLanguage('ur')
    expect(t('nav.settings')).toBe('ترتیبات')
    expect(t('onboarding.stepOf', { n: 2, total: 3 })).toBe('مرحلہ 2 از 3')
    expect(tDynamic('missing.key')).toBe('missing.key')
    setLanguage('xx') // unknown language -> English
    expect(t('nav.settings')).toBe('Settings')
  })
})
