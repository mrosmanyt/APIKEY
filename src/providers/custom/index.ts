/**
 * Custom OpenAI-compatible endpoint. Covers OpenRouter, Groq, DeepSeek, Together, Mistral,
 * Ollama, LM Studio, vLLM and anything else implementing POST {baseUrl}/chat/completions.
 */
import { ProviderError } from '../errors'
import { fetchWithRetry, trimSlash } from '../http'
import { bearerHeaders, listOpenAIModels, streamOpenAIChat } from '../shared/openai-compatible'
import type { ProviderAdapter, ProviderContext } from '../types'

const ID = 'custom'

export function customBaseUrl(ctx: ProviderContext): string {
  const url = trimSlash((ctx.config.baseUrl ?? '').trim())
  if (!/^https?:\/\//i.test(url)) {
    throw new ProviderError({
      kind: 'not_configured',
      providerId: ID,
      message: 'Enter a valid base URL (e.g. https://openrouter.ai/api/v1) in Settings › API Keys.'
    })
  }
  return url
}

export const customAdapter: ProviderAdapter = {
  id: ID,
  name: 'Custom (OpenAI-compatible)',
  description:
    'Any OpenAI-compatible API: OpenRouter, Groq, DeepSeek, Together, Mistral, Ollama, LM Studio…',
  keyUrl: 'https://openrouter.ai/keys',
  keyPlaceholder: 'Your key (any text for local servers without auth)',
  configFields: [
    {
      key: 'baseUrl',
      label: 'Base URL',
      placeholder: 'https://openrouter.ai/api/v1',
      required: true,
      type: 'url',
      help: 'The URL that ends before /chat/completions. Ollama: http://localhost:11434/v1'
    },
    {
      key: 'model',
      label: 'Default model name',
      placeholder: 'e.g. deepseek-chat, llama-3.3-70b-versatile, openai/gpt-4o',
      required: true
    },
    { key: 'displayName', label: 'Display name (optional)', placeholder: 'e.g. OpenRouter' }
  ],

  async testKey(ctx) {
    const base = customBaseUrl(ctx)
    try {
      await listOpenAIModels(ctx, ID, base)
      return
    } catch (err) {
      // Some compatible servers do not implement /models — fall back to a 1-token completion.
      if (
        !(err instanceof ProviderError) ||
        (err.kind !== 'model_not_found' && err.kind !== 'bad_request')
      )
        throw err
    }
    const model = ctx.config.model?.trim()
    if (!model)
      throw new ProviderError({
        kind: 'not_configured',
        providerId: ID,
        message: 'Enter a default model name.'
      })
    await fetchWithRetry(ctx, ID, `${base}/chat/completions`, {
      method: 'POST',
      headers: bearerHeaders(ctx.apiKey),
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 })
    })
  },

  async listModels(ctx, capability) {
    if (capability !== 'chat') return []
    const models = await listOpenAIModels(ctx, ID, customBaseUrl(ctx))
    return models.map((m) => ({ ...m, vision: true }))
  },

  chat: {
    // The configured default model is injected by the registry (see getProviderInfo).
    models: [],
    stream: (ctx, req, handlers) =>
      streamOpenAIChat(ctx, req, handlers, { providerId: ID, baseUrl: customBaseUrl(ctx) })
  }
}
