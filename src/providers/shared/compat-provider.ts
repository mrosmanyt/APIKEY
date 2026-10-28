/**
 * Factory for providers that expose an OpenAI-compatible Chat Completions API at a fixed base
 * URL (OpenRouter, Groq, DeepSeek, Mistral, …). Adding one is a single call to this function.
 */
import type { ModelInfo } from '@shared/types'
import { requestJson, trimSlash } from '../http'
import type { ProviderAdapter } from '../types'
import { bearerHeaders, listOpenAIModels, streamOpenAIChat } from './openai-compatible'

export interface CompatProviderOptions {
  id: string
  name: string
  description: string
  keyUrl: string
  keyPlaceholder: string
  baseUrl: string
  models: ModelInfo[]
  /** Path (relative to baseUrl) of a cheap authenticated GET used to test the key. */
  testPath?: string
  /** Send stream_options.include_usage (only for servers known to accept it). */
  includeStreamUsage?: boolean
  extraHeaders?: Record<string, string>
  /** Filter the live /models list for the chat capability. */
  isChatModel?: (id: string) => boolean
  beta?: boolean
}

export function compatProvider(o: CompatProviderOptions): ProviderAdapter {
  const known = new Map(o.models.map((m) => [m.id, m]))
  return {
    id: o.id,
    name: o.name,
    description: o.description,
    keyUrl: o.keyUrl,
    keyPlaceholder: o.keyPlaceholder,
    beta: o.beta,
    async testKey(ctx) {
      await requestJson(ctx, o.id, `${trimSlash(o.baseUrl)}${o.testPath ?? '/models'}`, {
        method: 'GET',
        headers: bearerHeaders(ctx.apiKey, o.extraHeaders)
      })
    },
    async listModels(ctx, capability) {
      if (capability !== 'chat') return []
      const all = await listOpenAIModels(ctx, o.id, o.baseUrl, o.extraHeaders)
      return all
        .filter((m) => (o.isChatModel ? o.isChatModel(m.id) : true))
        .map((m) => ({ ...known.get(m.id), ...m, name: m.name ?? known.get(m.id)?.name }))
    },
    chat: {
      models: o.models,
      stream: (ctx, req, handlers) =>
        streamOpenAIChat(ctx, req, handlers, {
          providerId: o.id,
          baseUrl: o.baseUrl,
          includeStreamUsage: o.includeStreamUsage,
          extraHeaders: o.extraHeaders
        })
    }
  }
}
