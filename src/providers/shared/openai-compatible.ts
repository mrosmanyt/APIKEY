/**
 * Shared implementation for providers that speak the OpenAI Chat Completions protocol
 * (OpenAI, xAI, and any custom OpenAI-compatible endpoint: OpenRouter, Groq, DeepSeek,
 * Ollama, LM Studio, vLLM ...).
 */
import type { ChatRequest, ModelInfo } from '@shared/types'
import { contentPolicyError, ProviderError } from '../errors'
import { fetchWithRetry, readSse, requestJson, trimSlash } from '../http'
import type { ChatResult, ChatStreamHandlers, ProviderContext } from '../types'
import { imageAttachments, textWithAttachments } from './messages'

export interface OpenAICompatOptions {
  providerId: string
  baseUrl: string
  /** Use max_completion_tokens instead of max_tokens (OpenAI's newer models). */
  useMaxCompletionTokens?: boolean
  /** Ask the server to include token usage in the final stream chunk. */
  includeStreamUsage?: boolean
  /** Return false for models that reject the temperature parameter. */
  supportsTemperature?: (model: string) => boolean
  extraHeaders?: Record<string, string>
}

type OAContentPart =
  { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

export interface OAMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | OAContentPart[]
}

export function buildOpenAIMessages(req: ChatRequest): OAMessage[] {
  const out: OAMessage[] = []
  if (req.systemPrompt?.trim()) out.push({ role: 'system', content: req.systemPrompt })
  for (const m of req.messages) {
    const text = textWithAttachments(m.content, m.attachments)
    const images = imageAttachments(m.attachments)
    if (m.role === 'user' && images.length > 0) {
      out.push({
        role: 'user',
        content: [
          { type: 'text', text },
          ...images.map((img): OAContentPart => ({
            type: 'image_url',
            image_url: { url: `data:${img.mime};base64,${img.dataBase64}` }
          }))
        ]
      })
    } else {
      out.push({ role: m.role, content: text })
    }
  }
  return out
}

export function buildOpenAIChatBody(req: ChatRequest, opts: OpenAICompatOptions) {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: buildOpenAIMessages(req),
    stream: true
  }
  if (opts.includeStreamUsage) body.stream_options = { include_usage: true }
  const tempOk = opts.supportsTemperature ? opts.supportsTemperature(req.model) : true
  if (req.temperature !== undefined && tempOk) body.temperature = req.temperature
  if (req.maxTokens) {
    body[opts.useMaxCompletionTokens ? 'max_completion_tokens' : 'max_tokens'] = req.maxTokens
  }
  return body
}

export function bearerHeaders(apiKey: string, extra?: Record<string, string>) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    ...(extra ?? {})
  }
}

interface OAStreamChunk {
  choices?: Array<{
    delta?: { content?: string | null; refusal?: string | null }
    finish_reason?: string | null
  }>
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null
  error?: { message?: string }
}

export async function streamOpenAIChat(
  ctx: ProviderContext,
  req: ChatRequest,
  handlers: ChatStreamHandlers,
  opts: OpenAICompatOptions
): Promise<ChatResult> {
  const url = `${trimSlash(opts.baseUrl)}/chat/completions`
  const res = await fetchWithRetry(ctx, opts.providerId, url, {
    method: 'POST',
    headers: bearerHeaders(ctx.apiKey, opts.extraHeaders),
    body: JSON.stringify(buildOpenAIChatBody(req, opts))
  })

  const result: ChatResult = {}
  let refusal = ''
  let gotText = false
  await readSse(res, (ev) => {
    if (ev.data === '[DONE]') return 'stop'
    let chunk: OAStreamChunk
    try {
      chunk = JSON.parse(ev.data) as OAStreamChunk
    } catch {
      return
    }
    if (chunk.error) {
      throw new ProviderError({
        kind: 'server',
        providerId: opts.providerId,
        message: chunk.error.message ?? 'Stream error',
        details: ev.data
      })
    }
    const choice = chunk.choices?.[0]
    const delta = choice?.delta
    if (delta?.content) {
      gotText = true
      handlers.onDelta(delta.content)
    }
    if (delta?.refusal) refusal += delta.refusal
    if (choice?.finish_reason) result.finishReason = choice.finish_reason
    if (chunk.usage) {
      result.usage = {
        inputTokens: chunk.usage.prompt_tokens,
        outputTokens: chunk.usage.completion_tokens
      }
    }
  })

  if (!gotText && (refusal || result.finishReason === 'content_filter')) {
    throw contentPolicyError(
      opts.providerId,
      refusal || 'The provider blocked this response (content filter).'
    )
  }
  return result
}

export async function listOpenAIModels(
  ctx: ProviderContext,
  providerId: string,
  baseUrl: string,
  extraHeaders?: Record<string, string>
): Promise<ModelInfo[]> {
  const json = await requestJson<{ data?: Array<{ id: string; name?: string }> }>(
    ctx,
    providerId,
    `${trimSlash(baseUrl)}/models`,
    { method: 'GET', headers: bearerHeaders(ctx.apiKey, extraHeaders) }
  )
  return (json.data ?? [])
    .map((m) => ({ id: m.id, name: m.name }))
    .sort((a, b) => a.id.localeCompare(b.id))
}
