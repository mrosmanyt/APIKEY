import { afterEach, describe, expect, it } from 'vitest'
import { languageDir, LANGUAGES, setLanguage, t, tDynamic } from '../src/renderer/src/i18n'
import { en } from '../src/renderer/src/i18n/en'
import { ur } from '../src/renderer/src/i18n/ur'
import { TEMPLATES } from '../src/main/automation/templates'
import { DEFAULT_SETTINGS } from '../src/shared/defaults'

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
  it('has every English key (names the missing ones)', () => {
    const missing = Object.keys(EN).filter((key) => typeof UR[key] !== 'string')
    expect(missing, `Missing from ur.ts: ${missing.join(', ')}`).toEqual([])
  })

  it('translates the Automation screen, including the safety hints', () => {
    const automationKeys = Object.keys(EN).filter(
      (k) =>
        k.startsWith('automation.') || k.startsWith('settings.automation') || k === 'nav.automation'
    )
    expect(automationKeys.length).toBeGreaterThan(150)
    for (const key of automationKeys) expect(UR[key], key).not.toBe(EN[key])
    // The safety texts mention local services and redirects; the Urdu must say so too.
    expect(UR['automation.urlHint']).toContain('localhost')
    expect(UR['automation.urlHint']).toMatch(/ری ڈائریکٹ/)
    expect(UR['automation.noPermissions']).toMatch(/مقامی سروس/)
  })

  it('has every workflow template, with English matching the main process', () => {
    for (const tpl of TEMPLATES)
      for (const field of ['name', 'description', 'howTo'] as const) {
        const key = `automation.tpl.${tpl.id}.${field}`
        expect(EN[key], key).toBe(tpl[field])
        expect(UR[key], key).toMatch(/[؀-ۿ]/)
      }
    const ids = new Set(
      Object.keys(EN)
        .filter((k) => k.startsWith('automation.tpl.'))
        .map((k) => k.split('.')[2])
    )
    expect([...ids].sort()).toEqual(TEMPLATES.map((t) => t.id).sort())
  })

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

describe('Automation defaults', () => {
  it('is off by default, with every background feature off too', () => {
    const a = DEFAULT_SETTINGS.automation
    expect(a.enabled).toBe(false)
    expect(a.runInTray).toBe(false)
    expect(a.startWithWindows).toBe(false)
    expect(a.webhookEnabled).toBe(false)
  })
})
