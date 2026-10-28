import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  cronMatches,
  nextCronTime,
  parseCron,
  scheduleToCron,
  validateCron
} from '../../src/main/automation/cron'
import {
  csvToRecords,
  detectDelimiter,
  parseCsv,
  splitItems,
  txtLines
} from '../../src/main/automation/csv'
import { exportPack, importPack, nextStepId } from '../../src/main/automation/io'
import {
  checkRead,
  checkUrl,
  checkWrite,
  isInside,
  resolveStepPath,
  runsInLastHour
} from '../../src/main/automation/safety'
import { validateWorkflow, zWorkflow } from '../../src/main/automation/schema'
import {
  clockVars,
  renderTemplate,
  rowVars,
  templateVariables
} from '../../src/main/automation/template'
import { applyDefaults, TEMPLATES } from '../../src/main/automation/templates'
import { DEFAULT_AUTOMATION_SETTINGS } from '../../src/shared/automation'
import { wf } from './helpers'

describe('cron', () => {
  it('parses fields and matches times', () => {
    const c = parseCron('*/15 9-17 * * 1-5')
    expect(cronMatches(c, new Date(2026, 9, 28, 9, 30))).toBe(true) // Wed
    expect(cronMatches(c, new Date(2026, 9, 28, 9, 31))).toBe(false)
    expect(cronMatches(c, new Date(2026, 10, 1, 10, 0))).toBe(false) // Sunday
    expect(cronMatches(parseCron('0 0 * * 7'), new Date(2026, 10, 1, 0, 0))).toBe(true) // 7 = Sunday
  })

  it('computes the next run strictly after now', () => {
    expect(nextCronTime('0 * * * *', new Date(2026, 9, 28, 10, 0, 30))).toEqual(
      new Date(2026, 9, 28, 11, 0)
    )
    expect(nextCronTime('30 18 * * *', new Date(2026, 9, 28, 19, 0))).toEqual(
      new Date(2026, 9, 29, 18, 30)
    )
    expect(nextCronTime('0 9 * * 1', new Date(2026, 9, 28, 12, 0))).toEqual(
      new Date(2026, 10, 2, 9, 0)
    ) // next Monday
    expect(nextCronTime('0 0 29 2 *', new Date(2026, 0, 1))).toEqual(new Date(2028, 1, 29, 0, 0)) // leap day
    expect(nextCronTime('0 0 1 1 *', new Date(2026, 5, 1))).toEqual(new Date(2027, 0, 1, 0, 0))
  })

  it('treats day-of-month OR day-of-week like standard cron', () => {
    const c = parseCron('0 12 1 * 5') // the 1st, or any Friday
    expect(cronMatches(c, new Date(2026, 9, 1, 12, 0))).toBe(true)
    expect(cronMatches(c, new Date(2026, 9, 30, 12, 0))).toBe(true) // Friday
    expect(cronMatches(c, new Date(2026, 9, 29, 12, 0))).toBe(false)
  })

  it('builds expressions from presets and validates', () => {
    expect(scheduleToCron({ type: 'schedule', preset: 'hourly', minute: 15 })).toBe('15 * * * *')
    expect(scheduleToCron({ type: 'schedule', preset: 'daily', time: '07:05' })).toBe('5 7 * * *')
    expect(scheduleToCron({ type: 'schedule', preset: 'weekly', time: '18:30', weekday: 5 })).toBe(
      '30 18 * * 5'
    )
    expect(scheduleToCron({ type: 'schedule', preset: 'custom', cron: ' 0 6 * * * ' })).toBe(
      '0 6 * * *'
    )
    expect(validateCron('0 6 * * *')).toBeUndefined()
    expect(validateCron('61 * * * *')).toMatch(/out of range/)
    expect(validateCron('* * *')).toMatch(/5 fields/)
    expect(validateCron('a * * * *')).toMatch(/Invalid/)
  })
})

describe('csv / txt', () => {
  it('parses quotes, escaped quotes, newlines and BOM', () => {
    expect(parseCsv('﻿prompt,size\n"a cat, sleeping",1024\n"say ""hi""\nplease",512\n')).toEqual([
      ['prompt', 'size'],
      ['a cat, sleeping', '1024'],
      ['say "hi"\nplease', '512']
    ])
  })

  it('detects ; and tab delimiters (Excel in many locales)', () => {
    expect(detectDelimiter('prompt;size\na;b')).toBe(';')
    expect(detectDelimiter('a\tb\tc')).toBe('\t')
    expect(csvToRecords('Prompt;Style\nA dog;oil\n\nA cat;\n').records).toEqual([
      { Prompt: 'A dog', Style: 'oil' },
      { Prompt: 'A cat', Style: '' }
    ])
  })

  it('handles empty/duplicate headers and TXT/loop lists', () => {
    expect(csvToRecords('a,,a\n1,2,3').columns).toEqual(['a', 'col2', 'a_3'])
    expect(txtLines('  one \r\n\r\ntwo\n')).toEqual(['one', 'two'])
    expect(splitItems('["x", {"y":1}]', 'json')).toEqual(['x', '{"y":1}'])
    expect(splitItems('a, b ,,c', 'comma')).toEqual(['a', 'b', 'c'])
    expect(() => splitItems('{"a":1}', 'json')).toThrow(/not a JSON array/)
  })
})

describe('templating', () => {
  it('renders variables, reports missing ones and lists references', () => {
    const r = renderTemplate('Hi {{ input }} – {{step1.output}} {{nope}}', {
      input: 'Ann',
      'step1.output': 'ok'
    })
    expect(r).toEqual({ text: 'Hi Ann – ok ', missing: ['nope'] })
    expect(templateVariables('{{a}} {{b.c}} {{a}}')).toEqual(['a', 'b.c'])
    expect(rowVars({ 'Image Prompt': 'x' })).toEqual({ 'row.image_prompt': 'x' })
    expect(clockVars(new Date(2026, 0, 5, 7, 8, 9))).toEqual({
      date: '2026-01-05',
      time: '07-08',
      datetime: '2026-01-05_07-08-09'
    })
  })
})

describe('safety', () => {
  const out = path.resolve('/data/out')
  it('resolves relative paths inside output/automation and detects outside writes', () => {
    expect(resolveStepPath('a/b.txt', out)).toBe(path.join(out, 'automation', 'a', 'b.txt'))
    expect(resolveStepPath('"/x/y.txt"', out)).toBe(path.normalize('/x/y.txt'))
    expect(() => resolveStepPath('  ', out)).toThrow(/empty/)
    expect(isInside(out, path.join(out, 'x'))).toBe(true)
    expect(isInside(out, path.resolve('/data/outside'))).toBe(false)
    expect(isInside(out, path.join(out, '..', 'evil'))).toBe(false)
    expect(
      checkWrite(path.join(out, 'x.txt'), out, { writeFolders: [], httpHosts: [] })
    ).toBeUndefined()
    expect(
      checkWrite(path.resolve('/docs/r.txt'), out, { writeFolders: [], httpHosts: [] })
    ).toEqual({ kind: 'write', target: path.resolve('/docs') })
    expect(
      checkWrite(path.resolve('/docs/sub/r.txt'), out, {
        writeFolders: [path.resolve('/docs')],
        httpHosts: []
      })
    ).toBeUndefined()
    expect(checkRead(path.resolve('/app/data/keys.json'), path.resolve('/app'))).toMatch(/private/)
    // An output folder chosen inside the app folder stays usable.
    expect(
      checkRead(path.resolve('/app/out/x.txt'), path.resolve('/app'), path.resolve('/app/out'))
    ).toBeUndefined()
  })

  it('checks URLs', () => {
    const perms = { writeFolders: [], httpHosts: ['api.example.com'] }
    expect(checkUrl('https://api.example.com/x', perms)).toEqual({ host: 'api.example.com' })
    expect(checkUrl('https://evil.example.com/x', perms).approval).toEqual({
      kind: 'http',
      target: 'evil.example.com'
    })
    // Loopback is a host like any other: it needs approval too.
    expect(checkUrl('http://127.0.0.1:5000/', perms).approval).toEqual({
      kind: 'http',
      target: '127.0.0.1:5000'
    })
    expect(checkUrl('file:///etc/passwd', perms).error).toMatch(/http/)
    expect(checkUrl('https://user:pw@api.example.com', perms).error).toMatch(/credentials/)
    expect(checkUrl('not a url', perms).error).toMatch(/valid URL/)
  })

  it('counts runs in the last hour', () => {
    const now = 10_000_000
    expect(runsInLastHour([now - 1000, now - 3_599_000, now - 3_700_000], now)).toBe(2)
  })
})

describe('schema, templates and packs', () => {
  it('validates step ids and goto targets', () => {
    const ok = wf([
      {
        id: 'a',
        type: 'condition',
        left: 'x',
        operator: 'isEmpty',
        ifTrue: { action: 'goto', stepId: 'b' },
        ifFalse: { action: 'next' }
      },
      { id: 'b', type: 'delay', seconds: 1 }
    ])
    expect(zWorkflow.safeParse(ok).success).toBe(true)
    expect(validateWorkflow(ok)).toEqual([])
    expect(
      validateWorkflow(
        wf([
          { id: 'a', type: 'delay', seconds: 1 },
          { id: 'a', type: 'delay', seconds: 2 }
        ])
      )[0]
    ).toMatch(/Duplicate/)
    expect(
      validateWorkflow(
        wf([
          {
            id: 'a',
            type: 'condition',
            left: '',
            operator: 'isEmpty',
            ifTrue: { action: 'goto', stepId: 'zz' },
            ifFalse: { action: 'next' }
          }
        ])
      )[0]
    ).toMatch(/same list/)
    expect(zWorkflow.safeParse(wf([{ id: '1bad', type: 'delay', seconds: 1 }])).success).toBe(false)
    expect(
      nextStepId([
        { id: 'step1', type: 'delay', seconds: 1 },
        { id: 'loop', type: 'loop', items: '', steps: [{ id: 'step2', type: 'delay', seconds: 1 }] }
      ])
    ).toBe('step3')
  })

  it('ships the 5 requested templates, all valid', () => {
    expect(TEMPLATES.map((t) => t.name)).toEqual([
      'Blog post plus cover image',
      'Bulk image generation from CSV',
      'Transcribe a folder of audio files',
      'Translate text files',
      'Daily summary of a text file'
    ])
    for (const t of TEMPLATES) {
      const w = wf(t.workflow.steps, { ...t.workflow, enabled: false })
      expect(zWorkflow.safeParse(w).success, t.id).toBe(true)
      expect(validateWorkflow(w), t.id).toEqual([])
    }
    const replaced = applyDefaults(TEMPLATES[0].workflow.steps, {
      llm: { providerId: 'anthropic', model: 'claude-x' },
      image: { providerId: 'gemini', model: 'imagen' }
    })
    expect(
      replaced
        .filter((s) => s.type === 'llm')
        .every((s) => s.type === 'llm' && s.providerId === 'anthropic')
    ).toBe(true)
    expect(replaced.find((s) => s.type === 'image')).toMatchObject({
      providerId: 'gemini',
      model: 'imagen'
    })
  })

  it('exports packs without approvals and imports them disabled with fresh ids', () => {
    const original = wf([{ id: 'step1', type: 'http', method: 'GET', url: 'https://x.com' }], {
      permissions: { writeFolders: ['/secret'], httpHosts: ['x.com'] },
      enabled: true
    })
    const text = JSON.stringify(exportPack([original]))
    expect(text).not.toContain('permissions')
    expect(text).not.toContain('/secret')
    const { workflows, skipped } = importPack(text)
    expect(skipped).toEqual([])
    expect(workflows[0]).toMatchObject({
      name: original.name,
      enabled: false,
      permissions: { writeFolders: [], httpHosts: [] }
    })
    expect(workflows[0].id).not.toBe(original.id)
    // Even a hand-edited pack that includes permissions does not get them.
    const sneaky = JSON.stringify({
      format: 'ai-hub-workflows',
      version: 1,
      workflows: [{ ...original }]
    })
    expect(importPack(sneaky).workflows[0].permissions).toEqual({ writeFolders: [], httpHosts: [] })
  })

  it('rejects bad packs and skips bad workflows', () => {
    expect(() => importPack('nope')).toThrow(/valid JSON/)
    expect(() => importPack('{"format":"other"}')).toThrow(/not an AI Hub workflow pack/)
    expect(() => importPack('{"format":"ai-hub-workflows","version":9,"workflows":[]}')).toThrow(
      /newer version/
    )
    const r = importPack(
      JSON.stringify({
        format: 'ai-hub-workflows',
        version: 1,
        workflows: [{ name: 'Broken', steps: [{ id: 'x', type: 'rm -rf' }] }]
      })
    )
    expect(r.workflows).toEqual([])
    expect(r.skipped[0]).toMatch(/^Broken/)
  })

  it('is off by default with safe defaults', () => {
    expect(DEFAULT_AUTOMATION_SETTINGS).toMatchObject({
      enabled: false,
      startWithWindows: false,
      webhookEnabled: false,
      runInTray: false
    })
  })
})
