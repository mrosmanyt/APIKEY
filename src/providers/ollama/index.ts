/**
 * Ollama — https://github.com/ollama/ollama/blob/main/docs/api.md
 * Local models on this PC. No API key: the provider is "connected" by testing the server.
 * Chat uses Ollama's OpenAI-compatible endpoint ({baseUrl}/v1/chat/completions); the model
 * list comes from the native GET /api/tags.
 */
import { ProviderError } from '../errors'
import { requestJson, trimSlash } from '../http'
import { streamOpenAIChat } from '../shared/openai-compatible'
import type { ProviderAdapter, ProviderContext } from '../types'

const ID = 'ollama'
export const OLLAMA_DEFAULT_URL = 'http://localhost:11434'

export function ollamaBase(ctx: ProviderContext): string {
  const url = trimSlash((ctx.config.baseUrl ?? '').trim() || OLLAMA_DEFAULT_URL).replace(
    /\/v1$/,
    ''
  )
  if (!/^https?:\/\//i.test(url)) {
    throw new ProviderError({
      kind: 'not_configured',
      providerId: ID,
      message: 'Enter a valid Ollama URL, e.g. http://localhost:11434'
    })
  }
  return url
}

async function tags(ctx: ProviderContext) {
  try {
    return await requestJson<{
      models?: Array<{ name: string; model?: string; details?: { families?: string[] } }>
    }>({ ...ctx, maxRetries: 0 }, ID, `${ollamaBase(ctx)}/api/tags`, { method: 'GET' })
  } catch (err) {
    if (err instanceof ProviderError && err.kind === 'network') {
      throw new ProviderError({
        kind: 'network',
        providerId: ID,
        message: 'Could not reach Ollama. Is it installed and running? (https://ollama.com)',
        details: err.details
      })
    }
    throw err
  }
}

export const ollamaAdapter: ProviderAdapter = {
  id: ID,
  name: 'Ollama (local)',
  description: 'Run open models locally on this PC with Ollama — free, private, no API key.',
  keyUrl: 'https://ollama.com/download',
  keyPlaceholder: 'No key needed',
  keyOptional: true,
  configFields: [
    {
      key: 'baseUrl',
      label: 'Ollama URL',
      placeholder: OLLAMA_DEFAULT_URL,
      type: 'url',
      help: 'Leave empty for the default (Ollama on this PC).'
    }
  ],
  async testKey(ctx) {
    await tags(ctx)
  },
  async listModels(ctx, capability) {
    if (capability !== 'chat') return []
    const json = await tags(ctx)
    return (json.models ?? [])
      .map((m) => ({
        id: m.model ?? m.name,
        name: m.name,
        vision: m.details?.families?.some((f) => /clip|vision|mllama/i.test(f)) || undefined
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
  },
  chat: {
    // Filled from the local server after "Test connection" (see AiService.testKey).
    models: [],
    stream: (ctx, req, handlers) =>
      streamOpenAIChat(ctx, req, handlers, { providerId: ID, baseUrl: `${ollamaBase(ctx)}/v1` })
  }
}
