/**
 * OpenRouter — https://openrouter.ai/docs (OpenAI-compatible gateway to hundreds of models).
 * Its model list reports prices, which feed the cost estimates automatically.
 */
import type { ModelInfo } from '@shared/types'
import { requestJson } from '../http'
import { compatProvider } from '../shared/compat-provider'
import { bearerHeaders } from '../shared/openai-compatible'
import type { ProviderAdapter } from '../types'

export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'
const ID = 'openrouter'
const HEADERS = { 'X-Title': 'AI Hub' }

interface OpenRouterModel {
  id: string
  name?: string
  context_length?: number
  pricing?: { prompt?: string; completion?: string }
  architecture?: { input_modalities?: string[]; output_modalities?: string[] }
}

/** OpenRouter prices are USD per token as strings; convert to USD per 1M tokens. */
export function mapOpenRouterModel(m: OpenRouterModel): ModelInfo {
  const perM = (v?: string) =>
    v !== undefined && Number.isFinite(Number(v)) ? Number(v) * 1_000_000 : undefined
  const input = perM(m.pricing?.prompt)
  const output = perM(m.pricing?.completion)
  return {
    id: m.id,
    name: m.name,
    contextWindow: m.context_length,
    vision: m.architecture?.input_modalities?.includes('image') ?? undefined,
    ...(input !== undefined && output !== undefined && input >= 0 && output >= 0
      ? {
          pricing: { input: Math.round(input * 1e6) / 1e6, output: Math.round(output * 1e6) / 1e6 }
        }
      : {})
  }
}

const base = compatProvider({
  id: ID,
  name: 'OpenRouter',
  description:
    'One key for hundreds of models (GPT, Claude, Gemini, Llama, DeepSeek…) with live prices.',
  keyUrl: 'https://openrouter.ai/keys',
  keyPlaceholder: 'sk-or-...',
  baseUrl: OPENROUTER_BASE,
  // TODO(verify): /auth/key returns the key's limits/credits and requires a valid key.
  testPath: '/auth/key',
  includeStreamUsage: true,
  extraHeaders: HEADERS,
  models: [
    { id: 'openrouter/auto', name: 'Auto (best model for the prompt)', vision: true },
    { id: 'openai/gpt-4o-mini', name: 'OpenAI GPT-4o mini', vision: true, contextWindow: 128_000 },
    {
      id: 'anthropic/claude-sonnet-4.5',
      name: 'Anthropic Claude Sonnet 4.5',
      vision: true,
      contextWindow: 200_000
    },
    {
      id: 'google/gemini-2.5-flash',
      name: 'Google Gemini 2.5 Flash',
      vision: true,
      contextWindow: 1_000_000
    },
    {
      id: 'meta-llama/llama-3.3-70b-instruct',
      name: 'Meta Llama 3.3 70B',
      vision: false,
      contextWindow: 128_000
    },
    { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3', vision: false, contextWindow: 64_000 }
  ]
})

export const openrouterAdapter: ProviderAdapter = {
  ...base,
  async listModels(ctx, capability) {
    if (capability !== 'chat') return []
    const json = await requestJson<{ data?: OpenRouterModel[] }>(
      ctx,
      ID,
      `${OPENROUTER_BASE}/models`,
      {
        method: 'GET',
        headers: bearerHeaders(ctx.apiKey, HEADERS)
      }
    )
    return (json.data ?? [])
      .filter(
        (m) =>
          !m.architecture?.output_modalities || m.architecture.output_modalities.includes('text')
      )
      .map(mapOpenRouterModel)
      .sort((a, b) => a.id.localeCompare(b.id))
  }
}
