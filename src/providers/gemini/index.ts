/**
 * Google Gemini API — https://ai.google.dev/api
 * Chat (streamGenerateContent, SSE), images (Gemini image models + Imagen), video (Veo, long-running).
 */
import type { ChatRequest, ImageModelInfo, ModelInfo, VideoModelInfo } from '@shared/types'
import { contentPolicyError, ProviderError } from '../errors'
import { fetchWithRetry, readSse, requestJson } from '../http'
import { imageAttachments, textWithAttachments } from '../shared/messages'
import type { ImageGenerateRequest, ImageOutput, ProviderAdapter, ProviderContext } from '../types'

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const ID = 'gemini'

const CHAT_MODELS: ModelInfo[] = [
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', vision: true },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', vision: true },
  { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite', vision: true },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', vision: true }
]

const GEMINI_IMAGE_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9']
const IMAGEN_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4']

const IMAGE_MODELS: ImageModelInfo[] = [
  {
    id: 'gemini-2.5-flash-image',
    name: 'Gemini 2.5 Flash Image',
    sizes: GEMINI_IMAGE_RATIOS,
    maxCount: 4,
    supportsNegativePrompt: false
  },
  {
    id: 'imagen-4.0-generate-001',
    name: 'Imagen 4',
    sizes: IMAGEN_RATIOS,
    maxCount: 4,
    supportsNegativePrompt: false
  },
  {
    id: 'imagen-4.0-ultra-generate-001',
    name: 'Imagen 4 Ultra',
    sizes: IMAGEN_RATIOS,
    maxCount: 1,
    supportsNegativePrompt: false
  },
  {
    id: 'imagen-4.0-fast-generate-001',
    name: 'Imagen 4 Fast',
    sizes: IMAGEN_RATIOS,
    maxCount: 4,
    supportsNegativePrompt: false
  },
  {
    id: 'imagen-3.0-generate-002',
    name: 'Imagen 3',
    sizes: IMAGEN_RATIOS,
    maxCount: 4,
    supportsNegativePrompt: true
  }
]

const VIDEO_MODELS: VideoModelInfo[] = [
  {
    id: 'veo-3.0-generate-001',
    name: 'Veo 3',
    sizes: ['16:9', '9:16'],
    supportsImageInput: true,
    imageInputBeta: true
  },
  {
    id: 'veo-3.0-fast-generate-001',
    name: 'Veo 3 Fast',
    sizes: ['16:9', '9:16'],
    supportsImageInput: true,
    imageInputBeta: true
  },
  {
    id: 'veo-2.0-generate-001',
    name: 'Veo 2',
    sizes: ['16:9', '9:16'],
    durations: [5, 6, 7, 8],
    supportsImageInput: true,
    imageInputBeta: true
  }
]

export function geminiHeaders(apiKey: string) {
  return { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' }
}

type Part = { text: string } | { inline_data: { mime_type: string; data: string } }

export function buildGeminiChatBody(req: ChatRequest) {
  const contents = req.messages.map((m) => {
    const parts: Part[] = []
    for (const img of imageAttachments(m.attachments)) {
      parts.push({ inline_data: { mime_type: img.mime, data: img.dataBase64! } })
    }
    parts.push({ text: textWithAttachments(m.content, m.attachments) || ' ' })
    return { role: m.role === 'assistant' ? 'model' : 'user', parts }
  })
  const body: Record<string, unknown> = { contents }
  if (req.systemPrompt?.trim()) body.systemInstruction = { parts: [{ text: req.systemPrompt }] }
  const generationConfig: Record<string, unknown> = {}
  if (req.temperature !== undefined) generationConfig.temperature = req.temperature
  if (req.maxTokens) generationConfig.maxOutputTokens = req.maxTokens
  if (Object.keys(generationConfig).length) body.generationConfig = generationConfig
  return body
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string
        thought?: boolean
        inlineData?: { mimeType: string; data: string }
      }>
    }
    finishReason?: string
  }>
  promptFeedback?: { blockReason?: string }
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
}

const BLOCKED = new Set([
  'SAFETY',
  'PROHIBITED_CONTENT',
  'BLOCKLIST',
  'SPII',
  'IMAGE_SAFETY',
  'RECITATION'
])

async function streamChat(
  ctx: ProviderContext,
  req: ChatRequest,
  handlers: { onDelta: (t: string) => void }
) {
  const url = `${GEMINI_BASE}/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`
  const res = await fetchWithRetry(ctx, ID, url, {
    method: 'POST',
    headers: geminiHeaders(ctx.apiKey),
    body: JSON.stringify(buildGeminiChatBody(req))
  })
  let usage: { inputTokens?: number; outputTokens?: number } | undefined
  let finishReason: string | undefined
  let blockReason: string | undefined
  let gotText = false
  await readSse(res, (ev) => {
    let data: GeminiResponse
    try {
      data = JSON.parse(ev.data) as GeminiResponse
    } catch {
      return
    }
    if (data.promptFeedback?.blockReason) blockReason = data.promptFeedback.blockReason
    const cand = data.candidates?.[0]
    for (const part of cand?.content?.parts ?? []) {
      if (part.text && !part.thought) {
        gotText = true
        handlers.onDelta(part.text)
      }
    }
    if (cand?.finishReason) finishReason = cand.finishReason
    if (data.usageMetadata) {
      usage = {
        inputTokens: data.usageMetadata.promptTokenCount,
        outputTokens: data.usageMetadata.candidatesTokenCount
      }
    }
  })
  if (!gotText && (blockReason || (finishReason && BLOCKED.has(finishReason)))) {
    throw contentPolicyError(ID, `Gemini blocked this request (${blockReason ?? finishReason}).`)
  }
  return { usage, finishReason }
}

async function generateWithGeminiImage(
  ctx: ProviderContext,
  req: ImageGenerateRequest
): Promise<ImageOutput[]> {
  const url = `${GEMINI_BASE}/models/${encodeURIComponent(req.model)}:generateContent`
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      ...(req.size && req.size !== 'default' ? { imageConfig: { aspectRatio: req.size } } : {})
    }
  }
  const out: ImageOutput[] = []
  for (let i = 0; i < Math.max(1, req.count); i++) {
    const json = await requestJson<GeminiResponse>(ctx, ID, url, {
      method: 'POST',
      headers: geminiHeaders(ctx.apiKey),
      body: JSON.stringify(body)
    })
    const cand = json.candidates?.[0]
    const parts = cand?.content?.parts ?? []
    const images = parts.filter((p) => p.inlineData?.data)
    if (images.length === 0) {
      const reason = json.promptFeedback?.blockReason ?? cand?.finishReason
      if (reason && (BLOCKED.has(reason) || reason !== 'STOP')) {
        throw contentPolicyError(
          ID,
          `Gemini did not return an image (${reason}).`,
          JSON.stringify(json).slice(0, 2000)
        )
      }
      const text = parts
        .map((p) => p.text)
        .filter(Boolean)
        .join(' ')
      throw new ProviderError({
        kind: 'unknown',
        providerId: ID,
        message: text || 'No image returned.'
      })
    }
    for (const p of images)
      out.push({ data: Buffer.from(p.inlineData!.data, 'base64'), mime: p.inlineData!.mimeType })
  }
  return out
}

export function buildImagenBody(req: ImageGenerateRequest) {
  const parameters: Record<string, unknown> = { sampleCount: Math.max(1, req.count) }
  if (req.size && req.size !== 'default') parameters.aspectRatio = req.size
  if (req.negativePrompt?.trim()) parameters.negativePrompt = req.negativePrompt
  return { instances: [{ prompt: req.prompt }], parameters }
}

async function generateWithImagen(
  ctx: ProviderContext,
  req: ImageGenerateRequest
): Promise<ImageOutput[]> {
  const url = `${GEMINI_BASE}/models/${encodeURIComponent(req.model)}:predict`
  const json = await requestJson<{
    predictions?: Array<{
      bytesBase64Encoded?: string
      mimeType?: string
      raiFilteredReason?: string
    }>
  }>(ctx, ID, url, {
    method: 'POST',
    headers: geminiHeaders(ctx.apiKey),
    body: JSON.stringify(buildImagenBody(req))
  })
  const preds = json.predictions ?? []
  const out = preds
    .filter((p) => p.bytesBase64Encoded)
    .map((p) => ({
      data: Buffer.from(p.bytesBase64Encoded!, 'base64'),
      mime: p.mimeType ?? 'image/png'
    }))
  if (out.length === 0) {
    const filtered = preds.find((p) => p.raiFilteredReason)?.raiFilteredReason
    throw contentPolicyError(
      ID,
      filtered ?? 'No images returned (the prompt may have been filtered).'
    )
  }
  return out
}

interface VeoOperation {
  name?: string
  done?: boolean
  error?: { message?: string }
  response?: {
    generateVideoResponse?: {
      generatedSamples?: Array<{ video?: { uri?: string } }>
      raiMediaFilteredReasons?: string[]
    }
  }
}

export const geminiAdapter: ProviderAdapter = {
  id: ID,
  name: 'Google Gemini',
  description: 'Gemini chat models, Gemini image / Imagen image generation and Veo video.',
  keyUrl: 'https://aistudio.google.com/app/apikey',
  keyPlaceholder: 'AIza...',

  async testKey(ctx) {
    await requestJson(ctx, ID, `${GEMINI_BASE}/models?pageSize=1`, {
      method: 'GET',
      headers: geminiHeaders(ctx.apiKey)
    })
  },

  async listModels(ctx, capability) {
    const json = await requestJson<{
      models?: Array<{ name: string; displayName?: string; supportedGenerationMethods?: string[] }>
    }>(ctx, ID, `${GEMINI_BASE}/models?pageSize=1000`, {
      method: 'GET',
      headers: geminiHeaders(ctx.apiKey)
    })
    const models = (json.models ?? []).map((m) => ({
      id: m.name.replace(/^models\//, ''),
      name: m.displayName,
      methods: m.supportedGenerationMethods ?? []
    }))
    const pick = (f: (m: (typeof models)[number]) => boolean) =>
      models
        .filter(f)
        .map((m) => ({ id: m.id, name: m.name, vision: capability === 'chat' ? true : undefined }))
    switch (capability) {
      case 'chat':
        return pick(
          (m) =>
            m.methods.includes('generateContent') &&
            /gemini|gemma/i.test(m.id) &&
            !/(image|tts|embedding|live)/i.test(m.id)
        )
      case 'image':
        return pick((m) => /imagen/i.test(m.id) || (/gemini/i.test(m.id) && /image/i.test(m.id)))
      case 'video':
        return pick((m) => /veo/i.test(m.id))
      default:
        return []
    }
  },

  chat: { models: CHAT_MODELS, stream: streamChat },

  image: {
    models: IMAGE_MODELS,
    generate: (ctx, req) =>
      /^imagen/i.test(req.model) ? generateWithImagen(ctx, req) : generateWithGeminiImage(ctx, req)
  },

  video: {
    models: VIDEO_MODELS,
    async submit(ctx, req) {
      const instance: Record<string, unknown> = { prompt: req.prompt }
      // TODO(verify): image-to-video payload shape. The Gemini API docs show
      // { image: { bytesBase64Encoded, mimeType } } for predictLongRunning instances.
      if (req.image)
        instance.image = {
          bytesBase64Encoded: req.image.data.toString('base64'),
          mimeType: req.image.mime
        }
      const parameters: Record<string, unknown> = {}
      if (req.size) parameters.aspectRatio = req.size
      if (req.durationSeconds) parameters.durationSeconds = req.durationSeconds
      const json = await requestJson<VeoOperation>(
        ctx,
        ID,
        `${GEMINI_BASE}/models/${encodeURIComponent(req.model)}:predictLongRunning`,
        {
          method: 'POST',
          headers: geminiHeaders(ctx.apiKey),
          body: JSON.stringify({ instances: [instance], parameters })
        }
      )
      if (!json.name)
        throw new ProviderError({
          kind: 'unknown',
          providerId: ID,
          message: 'No operation name returned.'
        })
      return { jobId: json.name }
    },
    async poll(ctx, jobId) {
      // jobId is an operation name like "models/veo-3.0-generate-001/operations/abc123"
      const json = await requestJson<VeoOperation>(ctx, ID, `${GEMINI_BASE}/${jobId}`, {
        method: 'GET',
        headers: geminiHeaders(ctx.apiKey)
      })
      if (!json.done) return { status: 'running' }
      if (json.error) return { status: 'failed', error: json.error.message }
      const resp = json.response?.generateVideoResponse
      const uri = resp?.generatedSamples?.[0]?.video?.uri
      if (!uri) {
        return {
          status: 'failed',
          error:
            resp?.raiMediaFilteredReasons?.join('; ') ||
            'No video returned (it may have been filtered).'
        }
      }
      return { status: 'completed', resultRef: uri }
    },
    async download(ctx, _jobId, resultRef) {
      if (!resultRef)
        throw new ProviderError({ kind: 'unknown', providerId: ID, message: 'Missing video URI.' })
      const res = await fetchWithRetry(ctx, ID, resultRef, {
        method: 'GET',
        headers: { 'x-goog-api-key': ctx.apiKey },
        redirect: 'follow'
      })
      return { data: Buffer.from(await res.arrayBuffer()), mime: 'video/mp4' }
    }
  }
}
