import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { UsageStore } from '../src/main/storage/usage'
import {
  costOf,
  DEFAULT_PRICES,
  estimateTokens,
  findPrice,
  formatUsd,
  monthKey,
  monthlyCosts
} from '../src/shared/pricing'
import type { PriceRow } from '../src/shared/types'
import { attachmentTokens, formatTokens, sizeWarning } from '../src/renderer/src/lib/tokens'
import { tmpDir } from './helpers/fakes'

const row = (providerId: string, model: string, input: number, output: number): PriceRow => ({
  id: `${providerId}:${model}`,
  providerId,
  model,
  input,
  output
})

describe('price lookup', () => {
  const table = [
    row('openai', '*', 9, 9),
    row('openai', 'gpt-4o*', 2.5, 10),
    row('openai', 'gpt-4o-mini', 0.15, 0.6),
    row('ollama', '*', 0, 0)
  ]

  it('prefers exact, then the longest prefix, then *', () => {
    expect(findPrice(table, 'openai', 'gpt-4o-mini')).toMatchObject({
      input: 0.15,
      output: 0.6,
      source: 'table'
    })
    expect(findPrice(table, 'openai', 'gpt-4o-2024-08-06')).toMatchObject({ input: 2.5 })
    expect(findPrice(table, 'openai', 'o3')).toMatchObject({ input: 9 })
    expect(findPrice(table, 'ollama', 'llama3.2')).toMatchObject({ input: 0, output: 0 })
  })

  it('falls back to provider-reported pricing, else unknown', () => {
    expect(findPrice(table, 'openrouter', 'a/b', { pricing: { input: 3, output: 15 } })).toEqual({
      input: 3,
      output: 15,
      source: 'provider'
    })
    expect(findPrice(table, 'anthropic', 'claude-x')).toBeUndefined()
  })

  it('computes cost per 1M tokens', () => {
    expect(
      costOf(
        { inputTokens: 1_000_000, outputTokens: 500_000 },
        { input: 2.5, output: 10, source: 'table' }
      )
    ).toBeCloseTo(7.5)
    expect(
      costOf(
        { inputTokens: 1200, outputTokens: 300 },
        { input: 0.15, output: 0.6, source: 'table' }
      )
    ).toBeCloseTo(0.00036)
  })

  it('ships sensible defaults with unique ids and no negative prices', () => {
    expect(new Set(DEFAULT_PRICES.map((r) => r.id)).size).toBe(DEFAULT_PRICES.length)
    expect(DEFAULT_PRICES.every((r) => r.input >= 0 && r.output >= 0)).toBe(true)
    expect(findPrice(DEFAULT_PRICES, 'openai', 'gpt-4o')).toBeDefined()
    expect(findPrice(DEFAULT_PRICES, 'anthropic', 'claude-sonnet-4-5-20250929')).toBeDefined()
  })

  it('formats dollars', () => {
    expect(formatUsd(0)).toBe('$0')
    expect(formatUsd(0.00001)).toBe('<$0.0001')
    expect(formatUsd(0.0042)).toBe('$0.0042')
    expect(formatUsd(0.123)).toBe('$0.123')
    expect(formatUsd(12.345)).toBe('$12.35')
  })

  it('estimates tokens and month keys', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100)
    expect(monthKey(new Date(2026, 0, 15))).toBe('2026-01')
  })
})

describe('monthly usage and costs', () => {
  it('records per month / provider / model and computes totals from the price table', () => {
    const store = new UsageStore(path.join(tmpDir(), 'usage.json'))
    const oct = new Date(2026, 9, 3)
    store.record('openai', 'chat', {
      model: 'gpt-4o-mini',
      usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      now: oct
    })
    store.record('openai', 'chat', {
      model: 'gpt-4o-mini',
      usage: { inputTokens: 1_000_000 },
      now: oct
    })
    store.record('openai', 'chat', {
      model: 'mystery-model',
      usage: { inputTokens: 10, outputTokens: 10, estimated: true },
      now: oct
    })
    store.record('openai', 'chat', { model: 'gpt-4o-mini', error: true, now: oct }) // errors are not billed
    store.record('openai', 'chat', {
      model: 'gpt-4o-mini',
      usage: { inputTokens: 5 },
      now: new Date(2026, 8, 1)
    })

    const m = store.monthly()
    expect(Object.keys(m).sort()).toEqual(['2026-09', '2026-10'])
    expect(m['2026-10'].openai['gpt-4o-mini']).toEqual({
      requests: 2,
      inputTokens: 2_000_000,
      outputTokens: 1_000_000
    })
    expect(m['2026-10'].openai['mystery-model'].estimated).toBe(true)

    const [openai] = monthlyCosts(m, '2026-10', [row('openai', 'gpt-4o-mini', 0.15, 0.6)])
    expect(openai.cost).toBeCloseTo(0.3 + 0.6)
    expect(openai.requests).toBe(3)
    expect(openai.unpricedModels).toEqual(['mystery-model'])
    expect(openai.estimated).toBe(true)
    // Editing a price updates past months.
    expect(monthlyCosts(m, '2026-10', [row('openai', 'gpt-4o-mini', 1, 1)])[0].cost).toBeCloseTo(3)
    expect(monthlyCosts(m, '2030-01', [])).toEqual([])

    store.reset()
    expect(store.monthly()).toEqual({})
  })
})

describe('context size warning', () => {
  it('estimates attachment tokens and warns above 80% of the window', () => {
    const att = (chars: number) => ({
      id: 'a',
      name: 'f',
      mime: 'text/plain',
      kind: 'text' as const,
      size: chars,
      text: 'x'.repeat(chars)
    })
    expect(attachmentTokens([att(4000), att(400)])).toBe(1100)
    expect(sizeWarning(1000, 128_000).level).toBe('ok')
    expect(sizeWarning(50_000, 128_000).level).toBe('info')
    expect(sizeWarning(110_000, 128_000)).toEqual({
      level: 'too_large',
      tokens: 110_000,
      limit: 128_000,
      assumed: false
    })
    expect(sizeWarning(110_000, 1_000_000).level).toBe('info')
    expect(sizeWarning(110_000, undefined)).toMatchObject({ level: 'too_large', assumed: true })
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(1200)).toBe('1.2k')
    expect(formatTokens(1_000_000)).toBe('1M')
  })
})
