/**
 * xAI Grok — https://docs.x.ai/docs/api-reference
 * Chat is OpenAI-compatible. Image generation via /images/generations.
 */
import type { ImageModelInfo, ModelInfo, VideoModelInfo } from '@shared/types'
import { ProviderError } from '../errors'
import { requestBinary, requestJson } from '../http'
import {
  bearerHeaders,
  listOpenAIModels,
  streamOpenAIChat,
  type OpenAICompatOptions
} from '../shared/openai-compatible'
import type { ProviderAdapter } from '../types'

export const XAI_BASE = 'https://api.x.ai/v1'
const ID = 'xai'

const chatOpts: OpenAICompatOptions = {
  providerId: ID,
  baseUrl: XAI_BASE,
  includeStreamUsage: true
}

const CHAT_MODELS: ModelInfo[] = [
  { id: 'grok-4', name: 'Grok 4', vision: true, contextWindow: 256_000 },
  { id: 'grok-4-fast', name: 'Grok 4 Fast', vision: true, contextWindow: 2_000_000 },
  { id: 'grok-3', name: 'Grok 3', contextWindow: 131_072 },
  { id: 'grok-3-mini', name: 'Grok 3 mini', contextWindow: 131_072 },
  { id: 'grok-code-fast-1', name: 'Grok Code Fast', contextWindow: 256_000 }
]

const IMAGE_MODELS: ImageModelInfo[] = [
  // xAI's image endpoint does not accept a size parameter; "default" means provider default.
  {
    id: 'grok-2-image',
    name: 'Grok 2 Image',
    sizes: ['default'],
    maxCount: 4,
    supportsNegativePrompt: false
  }
]

/**
 * TODO(verify): xAI video generation ("Grok Imagine") API details could not be confirmed
 * against official documentation while building this app. The adapter below follows the
 * same async job pattern as xAI's other endpoints and is flagged `experimental` so the UI
 * labels it "Beta". If it fails, check https://docs.x.ai and adjust VIDEO_* below.
 */
const VIDEO_MODELS: VideoModelInfo[] = [
  { id: 'grok-imagine-video', name: 'Grok Imagine Video (beta)', supportsImageInput: true }
]
const VIDEO_SUBMIT_PATH = '/videos/generations' // TODO(verify)
const VIDEO_STATUS_PATH = (id: string) => `/videos/${encodeURIComponent(id)}` // TODO(verify)

interface XaiVideoStatus {
  status?: string
  progress?: number
  video?: { url?: string }
  url?: string
  error?: { message?: string } | string
}

export const xaiAdapter: ProviderAdapter = {
  id: ID,
  name: 'xAI Grok',
  description: 'Grok chat models, Grok image generation and Grok video (beta).',
  keyUrl: 'https://console.x.ai',
  keyPlaceholder: 'xai-...',

  async testKey(ctx) {
    await requestJson(ctx, ID, `${XAI_BASE}/models`, {
      method: 'GET',
      headers: bearerHeaders(ctx.apiKey)
    })
  },

  async listModels(ctx, capability) {
    const all = await listOpenAIModels(ctx, ID, XAI_BASE)
    if (capability === 'image')
      return all.filter((m) => /image/i.test(m.id) && !/video/i.test(m.id))
    if (capability === 'video') return all.filter((m) => /video/i.test(m.id))
    if (capability === 'chat')
      return all
        .filter((m) => !/(image|video|imagine|embed)/i.test(m.id))
        .map((m) => ({ ...m, vision: true }))
    return []
  },

  chat: { models: CHAT_MODELS, stream: (ctx, req, h) => streamOpenAIChat(ctx, req, h, chatOpts) },

  image: {
    models: IMAGE_MODELS,
    async generate(ctx, req) {
      const json = await requestJson<{
        data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>
      }>(ctx, ID, `${XAI_BASE}/images/generations`, {
        method: 'POST',
        headers: bearerHeaders(ctx.apiKey),
        body: JSON.stringify({
          model: req.model,
          prompt: req.prompt,
          n: Math.max(1, req.count),
          response_format: 'b64_json'
        })
      })
      const out = []
      for (const item of json.data ?? []) {
        if (item.b64_json) {
          out.push({
            data: Buffer.from(item.b64_json, 'base64'),
            mime: 'image/jpeg',
            revisedPrompt: item.revised_prompt
          })
        } else if (item.url) {
          const bin = await requestBinary(ctx, ID, item.url, { method: 'GET' })
          out.push({ ...bin, revisedPrompt: item.revised_prompt })
        }
      }
      if (out.length === 0)
        throw new ProviderError({
          kind: 'unknown',
          providerId: ID,
          message: 'No images were returned.'
        })
      return out
    }
  },

  video: {
    models: VIDEO_MODELS,
    experimental: true,
    async submit(ctx, req) {
      const body: Record<string, unknown> = { model: req.model, prompt: req.prompt }
      if (req.image)
        body.image = { url: `data:${req.image.mime};base64,${req.image.data.toString('base64')}` }
      const json = await requestJson<{ request_id?: string; id?: string }>(
        ctx,
        ID,
        `${XAI_BASE}${VIDEO_SUBMIT_PATH}`,
        {
          method: 'POST',
          headers: bearerHeaders(ctx.apiKey),
          body: JSON.stringify(body)
        }
      )
      const jobId = json.request_id ?? json.id
      if (!jobId)
        throw new ProviderError({ kind: 'unknown', providerId: ID, message: 'No job id returned.' })
      return { jobId }
    },
    async poll(ctx, jobId) {
      const json = await requestJson<XaiVideoStatus>(
        ctx,
        ID,
        `${XAI_BASE}${VIDEO_STATUS_PATH(jobId)}`,
        {
          method: 'GET',
          headers: bearerHeaders(ctx.apiKey)
        }
      )
      const url = json.video?.url ?? json.url
      const s = (json.status ?? '').toLowerCase()
      if (url || s === 'done' || s === 'completed' || s === 'succeeded')
        return { status: 'completed', resultRef: url }
      if (s === 'failed' || s === 'error' || s === 'expired')
        return {
          status: 'failed',
          error: typeof json.error === 'string' ? json.error : json.error?.message
        }
      return {
        status: s === 'pending' || s === 'queued' ? 'queued' : 'running',
        progress: json.progress
      }
    },
    async download(ctx, _jobId, resultRef) {
      if (!resultRef)
        throw new ProviderError({
          kind: 'unknown',
          providerId: ID,
          message: 'No video URL returned.'
        })
      const bin = await requestBinary(ctx, ID, resultRef, { method: 'GET' })
      return { data: bin.data, mime: 'video/mp4' }
    }
  }
}
