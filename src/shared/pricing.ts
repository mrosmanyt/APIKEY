/**
 * Cost estimates. Prices are USD per 1 million tokens and live in an editable table in
 * Settings. The defaults below are APPROXIMATE list prices at the time of writing — providers
 * change them, so the UI always labels costs as estimates and lets the user edit the table.
 */
import type { ModelInfo, ModelUsage, MonthlyUsage, PriceRow, TokenUsage } from './types'

type Seed = [providerId: string, model: string, input: number, output: number]

const SEEDS: Seed[] = [
  ['openai', 'gpt-5', 1.25, 10],
  ['openai', 'gpt-5-mini', 0.25, 2],
  ['openai', 'gpt-5-nano', 0.05, 0.4],
  ['openai', 'gpt-4.1', 2, 8],
  ['openai', 'gpt-4.1-mini', 0.4, 1.6],
  ['openai', 'gpt-4o', 2.5, 10],
  ['openai', 'gpt-4o-mini', 0.15, 0.6],
  ['openai', 'o3', 2, 8],
  ['openai', 'o4-mini', 1.1, 4.4],
  ['anthropic', 'claude-opus-4-1*', 15, 75],
  ['anthropic', 'claude-sonnet-4-5*', 3, 15],
  ['anthropic', 'claude-haiku-4-5*', 1, 5],
  ['gemini', 'gemini-2.5-pro', 1.25, 10],
  ['gemini', 'gemini-2.5-flash', 0.3, 2.5],
  ['gemini', 'gemini-2.5-flash-lite', 0.1, 0.4],
  ['gemini', 'gemini-2.0-flash', 0.1, 0.4],
  ['xai', 'grok-4', 3, 15],
  ['xai', 'grok-4-fast', 0.2, 0.5],
  ['xai', 'grok-3', 3, 15],
  ['xai', 'grok-3-mini', 0.3, 0.5],
  ['xai', 'grok-code-fast-1', 0.2, 1.5],
  ['deepseek', 'deepseek-chat', 0.27, 1.1],
  ['deepseek', 'deepseek-reasoner', 0.55, 2.19],
  ['mistral', 'mistral-large-latest', 2, 6],
  ['mistral', 'mistral-medium-latest', 0.4, 2],
  ['mistral', 'mistral-small-latest', 0.1, 0.3],
  ['mistral', 'codestral-latest', 0.3, 0.9],
  ['groq', 'llama-3.3-70b-versatile', 0.59, 0.79],
  ['groq', 'llama-3.1-8b-instant', 0.05, 0.08],
  // Local models cost nothing.
  ['ollama', '*', 0, 0]
]

export const DEFAULT_PRICES: PriceRow[] = SEEDS.map(([providerId, model, input, output]) => ({
  id: `default:${providerId}:${model}`,
  providerId,
  model,
  input,
  output
}))

export interface Price {
  input: number
  output: number
  source: 'table' | 'provider'
}

/** Specificity: exact match > longest prefix ("gpt-4o*") > "*". */
function matchScore(pattern: string, model: string): number {
  if (pattern === model) return 10_000
  if (pattern === '*') return 1
  if (pattern.endsWith('*') && model.startsWith(pattern.slice(0, -1))) return 1 + pattern.length
  return 0
}

/**
 * Find the price for a model: the user's table first, then pricing reported by the provider's
 * model list (e.g. OpenRouter). Returns undefined when unknown.
 */
export function findPrice(
  table: PriceRow[],
  providerId: string,
  model: string,
  modelInfo?: Pick<ModelInfo, 'pricing'>
): Price | undefined {
  let best: PriceRow | undefined
  let bestScore = 0
  for (const row of table) {
    if (row.providerId !== providerId) continue
    const score = matchScore(row.model.trim(), model)
    if (score > bestScore) {
      best = row
      bestScore = score
    }
  }
  if (best) return { input: best.input, output: best.output, source: 'table' }
  if (modelInfo?.pricing) return { ...modelInfo.pricing, source: 'provider' }
  return undefined
}

export function costOf(
  usage: Pick<TokenUsage, 'inputTokens' | 'outputTokens'>,
  price: Price
): number {
  return (
    ((usage.inputTokens ?? 0) * price.input + (usage.outputTokens ?? 0) * price.output) / 1_000_000
  )
}

/** Rough token estimate used when a provider reports no usage (~4 characters per token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function monthKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export interface ProviderMonthCost {
  providerId: string
  requests: number
  inputTokens: number
  outputTokens: number
  /** USD; only models with a known price contribute. */
  cost: number
  /** Models used this month without a known price. */
  unpricedModels: string[]
  estimated: boolean
  models: Array<ModelUsage & { model: string; cost?: number }>
}

export function monthlyCosts(
  monthly: MonthlyUsage,
  month: string,
  table: PriceRow[],
  modelInfo: (providerId: string, model: string) => Pick<ModelInfo, 'pricing'> | undefined = () =>
    undefined
): ProviderMonthCost[] {
  const byProvider = monthly[month] ?? {}
  return Object.entries(byProvider)
    .map(([providerId, models]) => {
      const out: ProviderMonthCost = {
        providerId,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        unpricedModels: [],
        estimated: false,
        models: []
      }
      for (const [model, u] of Object.entries(models)) {
        out.requests += u.requests
        out.inputTokens += u.inputTokens
        out.outputTokens += u.outputTokens
        out.estimated ||= Boolean(u.estimated)
        const price = findPrice(table, providerId, model, modelInfo(providerId, model))
        const cost = price ? costOf(u, price) : undefined
        if (cost === undefined) out.unpricedModels.push(model)
        else out.cost += cost
        out.models.push({ ...u, model, cost })
      }
      out.models.sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))
      return out
    })
    .sort((a, b) => b.cost - a.cost)
}

/** "$0.0042", "<$0.0001", "$12.34" */
export function formatUsd(value: number): string {
  if (value === 0) return '$0'
  if (value < 0.0001) return '<$0.0001'
  if (value < 0.01) return `$${value.toFixed(4)}`
  if (value < 1) return `$${value.toFixed(3)}`
  return `$${value.toFixed(2)}`
}
