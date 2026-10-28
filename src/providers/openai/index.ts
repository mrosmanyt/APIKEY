/**
 * OpenAI — https://platform.openai.com/docs/api-reference
 * Chat (Chat Completions, streaming), Images (gpt-image / DALL·E), TTS, STT, Video (Sora).
 */
import type { Capability, ImageModelInfo, ModelInfo, VideoModelInfo } from '@shared/types'
import { ProviderError } from '../errors'
import { fetchWithRetry, requestBinary, requestJson } from '../http'
import {
  bearerHeaders,
  listOpenAIModels,
  streamOpenAIChat,
  transcribeOpenAICompatible,
  type OpenAICompatOptions
} from '../shared/openai-compatible'
import type { ImageGenerateRequest, ImageInput, ProviderAdapter, ProviderContext } from '../types'

export const OPENAI_BASE = 'https://api.openai.com/v1'
const ID = 'openai'

/** Reasoning models (o-series, gpt-5 family) only accept the default temperature. */
export function openaiSupportsTemperature(model: string): boolean {
  return !/^(o\d|gpt-5)/i.test(model)
}

const chatOpts: OpenAICompatOptions = {
  providerId: ID,
  baseUrl: OPENAI_BASE,
  useMaxCompletionTokens: true,
  includeStreamUsage: true,
  supportsTemperature: openaiSupportsTemperature
}

const CHAT_MODELS: ModelInfo[] = [
  { id: 'gpt-5', name: 'GPT-5', vision: true, contextWindow: 400_000 },
  { id: 'gpt-5-mini', name: 'GPT-5 mini', vision: true, contextWindow: 400_000 },
  { id: 'gpt-5-nano', name: 'GPT-5 nano', vision: true, contextWindow: 400_000 },
  { id: 'gpt-4.1', name: 'GPT-4.1', vision: true, contextWindow: 1_047_576 },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 mini', vision: true, contextWindow: 1_047_576 },
  { id: 'gpt-4o', name: 'GPT-4o', vision: true, contextWindow: 128_000 },
  { id: 'gpt-4o-mini', name: 'GPT-4o mini', vision: true, contextWindow: 128_000 },
  { id: 'o4-mini', name: 'o4-mini', vision: true, contextWindow: 200_000 },
  { id: 'o3', name: 'o3', vision: true, contextWindow: 200_000 }
]

export const OPENAI_IMAGE_MODELS: ImageModelInfo[] = [
  {
    id: 'gpt-image-1',
    name: 'GPT Image 1',
    sizes: ['1024x1024', '1536x1024', '1024x1536', 'auto'],
    maxCount: 4,
    supportsNegativePrompt: false,
    supportsReference: true
  },
  {
    id: 'gpt-image-1-mini',
    name: 'GPT Image 1 mini',
    sizes: ['1024x1024', '1536x1024', '1024x1536', 'auto'],
    maxCount: 4,
    supportsNegativePrompt: false,
    supportsReference: true
  },
  {
    id: 'dall-e-3',
    name: 'DALL·E 3',
    sizes: ['1024x1024', '1792x1024', '1024x1792'],
    maxCount: 1,
    supportsNegativePrompt: false
  },
  {
    id: 'dall-e-2',
    name: 'DALL·E 2',
    sizes: ['1024x1024', '512x512', '256x256'],
    maxCount: 4,
    supportsNegativePrompt: false
  }
]

const VIDEO_MODELS: VideoModelInfo[] = [
  {
    id: 'sora-2',
    name: 'Sora 2',
    sizes: ['1280x720', '720x1280'],
    durations: [4, 8, 12],
    supportsImageInput: true
  },
  {
    id: 'sora-2-pro',
    name: 'Sora 2 Pro',
    sizes: ['1280x720', '720x1280', '1792x1024', '1024x1792'],
    durations: [4, 8, 12],
    supportsImageInput: true
  }
]

const NON_CHAT =
  /(embedding|tts|whisper|transcribe|dall-e|image|moderation|realtime|audio|davinci|babbage|sora|search|computer-use|codex)/i

export function filterOpenAIModels(models: ModelInfo[], capability: Capability): ModelInfo[] {
  switch (capability) {
    case 'chat':
      return models
        .filter((m) => /^(gpt|o\d|chatgpt)/i.test(m.id) && !NON_CHAT.test(m.id))
        .map((m) => ({ ...m, vision: true }))
    case 'image':
      return models.filter((m) => /(dall-e|gpt-image)/i.test(m.id))
    case 'tts':
      return models.filter((m) => /tts/i.test(m.id))
    case 'stt':
      return models.filter((m) => /(whisper|transcribe)/i.test(m.id))
    case 'video':
      return models.filter((m) => /sora/i.test(m.id))
    default:
      return []
  }
}

export function buildOpenAIImageBody(req: ImageGenerateRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    prompt: req.prompt,
    n: Math.max(1, req.count)
  }
  if (req.size) body.size = req.size
  // gpt-image models always return base64 and reject response_format.
  if (!/^gpt-image/.test(req.model)) body.response_format = 'b64_json'
  return body
}

type ImagesResponse = { data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }> }

const fileOf = (img: ImageInput, _name: string) =>
  new Blob([new Uint8Array(img.data)], { type: img.mime })

/** Multipart body for /images/edits (gpt-image models, reference image + prompt). */
export function buildOpenAIEditForm(
  req: ImageGenerateRequest & { reference: ImageInput }
): FormData {
  const form = new FormData()
  form.append('model', req.model)
  form.append('prompt', req.prompt)
  form.append('n', String(Math.max(1, req.count)))
  if (req.size && req.size !== 'auto') form.append('size', req.size)
  form.append(
    'image',
    fileOf(req.reference, 'reference'),
    `reference.${req.reference.mime.split('/')[1] ?? 'png'}`
  )
  return form
}

async function generateImages(ctx: ProviderContext, req: ImageGenerateRequest) {
  let json: ImagesResponse
  if (req.reference) {
    if (!OPENAI_IMAGE_MODELS.find((m) => m.id === req.model)?.supportsReference) {
      throw new ProviderError({
        kind: 'unsupported',
        providerId: ID,
        message: `${req.model} cannot use a reference image. Choose GPT Image 1.`
      })
    }
    json = await requestJson<ImagesResponse>(ctx, ID, `${OPENAI_BASE}/images/edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ctx.apiKey}` },
      body: buildOpenAIEditForm({ ...req, reference: req.reference })
    })
  } else {
    json = await requestJson<ImagesResponse>(ctx, ID, `${OPENAI_BASE}/images/generations`, {
      method: 'POST',
      headers: bearerHeaders(ctx.apiKey),
      body: JSON.stringify(buildOpenAIImageBody(req))
    })
  }
  return decodeImages(ctx, json)
}

async function decodeImages(ctx: ProviderContext, json: ImagesResponse) {
  const out = []
  for (const item of json.data ?? []) {
    if (item.b64_json) {
      out.push({
        data: Buffer.from(item.b64_json, 'base64'),
        mime: 'image/png',
        revisedPrompt: item.revised_prompt
      })
    } else if (item.url) {
      const bin = await requestBinary(ctx, ID, item.url, { method: 'GET' })
      out.push({ data: bin.data, mime: bin.mime, revisedPrompt: item.revised_prompt })
    }
  }
  if (out.length === 0) {
    throw new ProviderError({
      kind: 'unknown',
      providerId: ID,
      message: 'No images were returned.'
    })
  }
  return out
}

interface SoraVideo {
  id: string
  status: 'queued' | 'in_progress' | 'completed' | 'failed'
  progress?: number
  error?: { message?: string; code?: string } | null
}

export const openaiAdapter: ProviderAdapter = {
  id: ID,
  name: 'OpenAI',
  description:
    'GPT chat models, GPT Image / DALL·E, text-to-speech, Whisper transcription and Sora video.',
  keyUrl: 'https://platform.openai.com/api-keys',
  keyPlaceholder: 'sk-...',

  async testKey(ctx) {
    await requestJson(ctx, ID, `${OPENAI_BASE}/models`, {
      method: 'GET',
      headers: bearerHeaders(ctx.apiKey)
    })
  },

  async listModels(ctx, capability) {
    return filterOpenAIModels(await listOpenAIModels(ctx, ID, OPENAI_BASE), capability)
  },

  chat: {
    models: CHAT_MODELS,
    stream: (ctx, req, handlers) => streamOpenAIChat(ctx, req, handlers, chatOpts)
  },

  image: {
    models: OPENAI_IMAGE_MODELS,
    generate: generateImages,
    variationModel: 'dall-e-2',
    /** DALL·E 2 variations (input must be a square PNG under 4 MB). */
    async vary(ctx, image, count) {
      const form = new FormData()
      form.append('model', 'dall-e-2')
      form.append('image', fileOf(image, 'image'), 'image.png')
      form.append('n', String(Math.min(4, Math.max(1, count))))
      form.append('size', '1024x1024')
      form.append('response_format', 'b64_json')
      const json = await requestJson<ImagesResponse>(ctx, ID, `${OPENAI_BASE}/images/variations`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ctx.apiKey}` },
        body: form
      })
      return decodeImages(ctx, json)
    }
  },

  tts: {
    models: [
      { id: 'gpt-4o-mini-tts', name: 'GPT-4o mini TTS' },
      { id: 'tts-1', name: 'TTS-1' },
      { id: 'tts-1-hd', name: 'TTS-1 HD' }
    ],
    voices: [
      'alloy',
      'ash',
      'ballad',
      'coral',
      'echo',
      'fable',
      'nova',
      'onyx',
      'sage',
      'shimmer',
      'verse'
    ].map((v) => ({ id: v, name: v.charAt(0).toUpperCase() + v.slice(1) })),
    async synthesize(ctx, req) {
      const { data } = await requestBinary(ctx, ID, `${OPENAI_BASE}/audio/speech`, {
        method: 'POST',
        headers: bearerHeaders(ctx.apiKey),
        body: JSON.stringify({
          model: req.model,
          voice: req.voice,
          input: req.text,
          response_format: 'mp3'
        })
      })
      return { data, mime: 'audio/mpeg' }
    }
  },

  stt: {
    models: [
      { id: 'gpt-4o-transcribe', name: 'GPT-4o Transcribe' },
      { id: 'gpt-4o-mini-transcribe', name: 'GPT-4o mini Transcribe' },
      { id: 'whisper-1', name: 'Whisper' }
    ],
    transcribe: (ctx, req) => transcribeOpenAICompatible(ctx, ID, OPENAI_BASE, req)
  },

  video: {
    models: VIDEO_MODELS,
    async submit(ctx, req) {
      const form = new FormData()
      form.append('model', req.model)
      form.append('prompt', req.prompt)
      if (req.size) form.append('size', req.size)
      if (req.durationSeconds) form.append('seconds', String(req.durationSeconds))
      if (req.image) {
        const ext = req.image.mime.split('/')[1] ?? 'png'
        form.append(
          'input_reference',
          new Blob([new Uint8Array(req.image.data)], { type: req.image.mime }),
          `reference.${ext}`
        )
      }
      const json = await requestJson<SoraVideo>(ctx, ID, `${OPENAI_BASE}/videos`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ctx.apiKey}` },
        body: form
      })
      return { jobId: json.id }
    },
    async poll(ctx, jobId) {
      const json = await requestJson<SoraVideo>(
        ctx,
        ID,
        `${OPENAI_BASE}/videos/${encodeURIComponent(jobId)}`,
        {
          method: 'GET',
          headers: bearerHeaders(ctx.apiKey)
        }
      )
      const status =
        json.status === 'in_progress'
          ? 'running'
          : json.status === 'completed'
            ? 'completed'
            : json.status
      return { status, progress: json.progress, error: json.error?.message }
    },
    async download(ctx, jobId) {
      const res = await fetchWithRetry(
        ctx,
        ID,
        `${OPENAI_BASE}/videos/${encodeURIComponent(jobId)}/content`,
        { method: 'GET', headers: { Authorization: `Bearer ${ctx.apiKey}` } }
      )
      return { data: Buffer.from(await res.arrayBuffer()), mime: 'video/mp4' }
    }
  }
}
