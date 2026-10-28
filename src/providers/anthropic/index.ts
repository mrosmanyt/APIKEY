/**
 * Anthropic Claude — https://docs.anthropic.com/en/api/messages
 * Chat via the Messages API with SSE streaming. Vision via base64 image blocks.
 */
import type { ChatRequest, ModelInfo } from '@shared/types'
import { contentPolicyError, ProviderError } from '../errors'
import { fetchWithRetry, readSse, requestJson } from '../http'
import { imageAttachments, textWithAttachments } from '../shared/messages'
import type { ProviderAdapter, ProviderContext } from '../types'

export const ANTHROPIC_BASE = 'https://api.anthropic.com/v1'
export const ANTHROPIC_VERSION = '2023-06-01'
const ID = 'anthropic'
const DEFAULT_MAX_TOKENS = 4096

const CHAT_MODELS: ModelInfo[] = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', vision: true, contextWindow: 200_000 },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', vision: true, contextWindow: 200_000 },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', vision: true, contextWindow: 200_000 },
  { id: 'claude-opus-4-1', name: 'Claude Opus 4.1', vision: true, contextWindow: 200_000 },
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', vision: true, contextWindow: 200_000 },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', vision: true, contextWindow: 200_000 }
]

export function anthropicHeaders(apiKey: string) {
  return {
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    'content-type': 'application/json'
  }
}

type Block =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

export function buildAnthropicBody(req: ChatRequest) {
  const messages = req.messages.map((m) => {
    const text = textWithAttachments(m.content, m.attachments)
    const images = imageAttachments(m.attachments)
    if (m.role === 'user' && images.length > 0) {
      const content: Block[] = [
        ...images.map((img): Block => ({
          type: 'image',
          source: { type: 'base64', media_type: img.mime, data: img.dataBase64! }
        })),
        { type: 'text', text: text || ' ' }
      ]
      return { role: m.role, content }
    }
    return { role: m.role, content: text || ' ' }
  })
  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens || DEFAULT_MAX_TOKENS,
    messages,
    stream: true
  }
  if (req.systemPrompt?.trim()) body.system = req.systemPrompt
  // Anthropic accepts temperature in [0, 1].
  if (req.temperature !== undefined) body.temperature = Math.min(1, Math.max(0, req.temperature))
  return body
}

interface AnthropicEvent {
  type: string
  message?: { usage?: { input_tokens?: number; output_tokens?: number } }
  delta?: { type?: string; text?: string; stop_reason?: string }
  usage?: { output_tokens?: number; input_tokens?: number }
  error?: { type?: string; message?: string }
}

async function streamChat(
  ctx: ProviderContext,
  req: ChatRequest,
  handlers: { onDelta: (t: string) => void }
) {
  const res = await fetchWithRetry(ctx, ID, `${ANTHROPIC_BASE}/messages`, {
    method: 'POST',
    headers: anthropicHeaders(ctx.apiKey),
    body: JSON.stringify(buildAnthropicBody(req))
  })
  let inputTokens: number | undefined
  let outputTokens: number | undefined
  let finishReason: string | undefined
  let gotText = false

  await readSse(res, (ev) => {
    let data: AnthropicEvent
    try {
      data = JSON.parse(ev.data) as AnthropicEvent
    } catch {
      return
    }
    switch (data.type) {
      case 'message_start':
        inputTokens = data.message?.usage?.input_tokens
        outputTokens = data.message?.usage?.output_tokens
        break
      case 'content_block_delta':
        if (data.delta?.type === 'text_delta' && data.delta.text) {
          gotText = true
          handlers.onDelta(data.delta.text)
        }
        break
      case 'message_delta':
        if (data.usage?.output_tokens !== undefined) outputTokens = data.usage.output_tokens
        if (data.usage?.input_tokens !== undefined) inputTokens = data.usage.input_tokens
        if (data.delta?.stop_reason) finishReason = data.delta.stop_reason
        break
      case 'message_stop':
        return 'stop'
      case 'error': {
        const t = data.error?.type ?? ''
        throw new ProviderError({
          kind: t === 'overloaded_error' || t === 'rate_limit_error' ? 'rate_limit' : 'server',
          providerId: ID,
          message: data.error?.message ?? 'Stream error',
          details: ev.data
        })
      }
    }
  })
  if (!gotText && finishReason === 'refusal') {
    throw contentPolicyError(ID, 'Claude declined to respond to this request (refusal).')
  }
  return { usage: { inputTokens, outputTokens }, finishReason }
}

export const anthropicAdapter: ProviderAdapter = {
  id: ID,
  name: 'Anthropic Claude',
  description: 'Claude chat models with vision support.',
  keyUrl: 'https://console.anthropic.com/settings/keys',
  keyPlaceholder: 'sk-ant-...',

  async testKey(ctx) {
    await requestJson(ctx, ID, `${ANTHROPIC_BASE}/models?limit=1`, {
      method: 'GET',
      headers: anthropicHeaders(ctx.apiKey)
    })
  },

  async listModels(ctx, capability) {
    if (capability !== 'chat') return []
    const json = await requestJson<{ data?: Array<{ id: string; display_name?: string }> }>(
      ctx,
      ID,
      `${ANTHROPIC_BASE}/models?limit=100`,
      { method: 'GET', headers: anthropicHeaders(ctx.apiKey) }
    )
    return (json.data ?? []).map((m) => ({ id: m.id, name: m.display_name, vision: true }))
  },

  chat: { models: CHAT_MODELS, stream: streamChat }
}
