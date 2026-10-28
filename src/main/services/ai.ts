/**
 * Main-process AI service. This is the ONLY place that reads plain-text API keys and calls
 * provider adapters. The renderer only ever receives results and redacted errors.
 */
import fs from 'node:fs'
import path from 'node:path'
import { newId } from '@shared/ids'
import type {
  AppErrorInfo,
  AudioRecord,
  Capability,
  ChatRequest,
  EnhanceRequest,
  ImageReference,
  GeneratedImage,
  ImageRequest,
  ModelInfo,
  ProviderStatus,
  SttRequest,
  SttResult,
  TokenUsage,
  TtsRequest,
  VoiceInfo
} from '@shared/types'
import { ProviderError, toProviderError } from '../../providers/errors'
import { supports } from '../../providers/registry'
import type { ImageInput, ProviderAdapter, ProviderContext } from '../../providers/types'
import { estimateTokens } from '@shared/pricing'
import { extForMime, mediaDir, type AppContext } from './context'

export class AiService {
  private readonly activeChats = new Map<string, AbortController>()

  constructor(private readonly app: AppContext) {}

  // ------------------------------------------------------------------ helpers

  adapter(providerId: string, capability?: Capability): ProviderAdapter {
    const a = this.app.registry.get(providerId)
    if (!a)
      throw new ProviderError({
        kind: 'not_configured',
        message: `Unknown provider: ${providerId}`
      })
    if (capability && !supports(a, capability)) {
      throw new ProviderError({
        kind: 'unsupported',
        providerId,
        message: `${a.name} does not support ${capability}.`
      })
    }
    return a
  }

  providerContext(providerId: string, signal?: AbortSignal): ProviderContext {
    const stored = this.app.storage.keys.get(providerId)
    const keyless = Boolean(this.app.registry.get(providerId)?.keyOptional)
    const apiKey = stored ?? (keyless ? '' : undefined)
    if (apiKey === undefined || (!apiKey && !keyless)) {
      throw new ProviderError({
        kind: 'not_configured',
        providerId,
        message: 'No API key saved for this provider. Add one in Settings › API Keys.'
      })
    }
    return {
      apiKey,
      config: this.app.storage.settings.get().providerConfig[providerId] ?? {},
      fetch: this.app.fetch,
      signal
    }
  }

  toError(err: unknown, providerId?: string, action = 'request'): AppErrorInfo {
    const pe = toProviderError(err, providerId)
    const info = { ...pe.toInfo(), providerId: pe.providerId ?? providerId }
    if (info.kind !== 'cancelled') {
      this.app.logger.warn(`${providerId ?? 'app'} ${action} failed`, {
        kind: info.kind,
        status: info.status,
        message: info.message,
        details: info.details?.slice(0, 1000)
      })
    }
    // A key that the provider rejects is marked invalid so the UI reflects reality.
    if (info.kind === 'invalid_key' && providerId && this.app.storage.keys.has(providerId)) {
      this.app.storage.keys.setStatus(providerId, 'invalid', info)
    }
    return info
  }

  // ------------------------------------------------------------------ keys

  statuses(): ProviderStatus[] {
    const settings = this.app.storage.settings.get()
    return this.app.registry.list().map((a) => {
      const meta = this.app.storage.keys.meta(a.id)
      return {
        id: a.id,
        hasKey: Boolean(meta),
        status: meta?.status ?? 'missing',
        keyHint: meta?.hint,
        lastTestedAt: meta?.lastTestedAt,
        lastError: meta?.lastError,
        config: settings.providerConfig[a.id] ?? {}
      }
    })
  }

  saveKey(providerId: string, key: string): void {
    this.adapter(providerId)
    this.app.storage.keys.set(providerId, key)
    this.app.logger.info(`API key saved for ${providerId}`)
  }

  /** Connect a provider that needs no API key (e.g. local Ollama) and test it. */
  async connectKeyless(providerId: string): Promise<ProviderStatus> {
    const a = this.adapter(providerId)
    if (!a.keyOptional) {
      throw new ProviderError({
        kind: 'bad_request',
        providerId,
        message: `${a.name} needs an API key.`
      })
    }
    if (!this.app.storage.keys.has(providerId)) this.app.storage.keys.setKeyless(providerId)
    return this.testKey(providerId)
  }

  deleteKey(providerId: string): void {
    this.app.storage.keys.delete(providerId)
    this.app.logger.info(`API key deleted for ${providerId}`)
  }

  setConfig(providerId: string, config: Record<string, string>): void {
    this.adapter(providerId)
    const settings = this.app.storage.settings.get()
    this.app.storage.settings.update({
      providerConfig: { ...settings.providerConfig, [providerId]: config }
    })
  }

  async testKey(providerId: string): Promise<ProviderStatus> {
    const a = this.adapter(providerId)
    try {
      await a.testKey({ ...this.providerContext(providerId), maxRetries: 1 })
      this.app.storage.keys.setStatus(providerId, 'valid')
      this.app.logger.info(`Key test OK for ${providerId}`)
      // Providers without a built-in model list (Ollama, custom) need the live list to be usable.
      if (a.chat && a.chat.models.length === 0 && a.listModels) {
        await this.listModels(providerId, 'chat').catch(() => undefined)
      }
    } catch (err) {
      const info = this.toError(err, providerId, 'key test')
      // Network problems say nothing about the key itself.
      const inconclusive = ['network', 'server', 'rate_limit', 'unknown', 'cancelled']
      const status = inconclusive.includes(info.kind) ? 'untested' : 'invalid'
      this.app.storage.keys.setStatus(providerId, status, info)
    }
    return this.statuses().find((s) => s.id === providerId)!
  }

  async listModels(providerId: string, capability: Capability): Promise<ModelInfo[]> {
    const a = this.adapter(providerId)
    if (!a.listModels) return []
    try {
      const models = await a.listModels(this.providerContext(providerId), capability)
      const settings = this.app.storage.settings.get()
      this.app.storage.settings.update({
        modelCache: { ...settings.modelCache, [`${providerId}:${capability}`]: models }
      })
      return models
    } catch (err) {
      throw new ProviderError({ ...this.toError(err, providerId, 'list models') })
    }
  }

  async listVoices(providerId: string): Promise<VoiceInfo[]> {
    const a = this.adapter(providerId, 'tts')
    if (!a.tts!.listVoices) return a.tts!.voices
    try {
      const voices = await a.tts!.listVoices(this.providerContext(providerId))
      const settings = this.app.storage.settings.get()
      this.app.storage.settings.update({
        voiceCache: { ...settings.voiceCache, [providerId]: voices }
      })
      return voices
    } catch (err) {
      throw new ProviderError({ ...this.toError(err, providerId, 'list voices') })
    }
  }

  // ------------------------------------------------------------------ chat

  /** Starts a streaming chat; events are emitted on 'chat:event'. Resolves when finished. */
  /** Starts a streaming chat; events are emitted on 'chat:event'. Resolves when finished. */
  async startChat(requestId: string, req: ChatRequest): Promise<void> {
    const emit = (payload: object) => this.app.emit('chat:event', { requestId, ...payload })
    const controller = new AbortController()
    this.activeChats.set(requestId, controller)
    let output = ''
    try {
      const a = this.adapter(req.providerId, 'chat')
      const ctx = this.providerContext(req.providerId, controller.signal)
      const result = await a.chat!.stream(ctx, req, {
        onDelta: (text) => {
          output += text
          emit({ type: 'delta', text })
        }
      })
      const usage = withEstimate(result.usage, req, output)
      this.app.storage.usage.record(req.providerId, 'chat', { usage, model: req.model })
      emit({ type: 'done', usage, finishReason: result.finishReason })
    } catch (err) {
      const error = this.toError(err, req.providerId, 'chat')
      if (error.kind === 'cancelled' && output) {
        // Stopped by the user: the tokens produced so far were still billed.
        this.app.storage.usage.record(req.providerId, 'chat', {
          usage: withEstimate(undefined, req, output),
          model: req.model
        })
      } else if (error.kind !== 'cancelled') {
        this.app.storage.usage.record(req.providerId, 'chat', { error: true })
      }
      emit({ type: 'error', error })
    } finally {
      this.activeChats.delete(requestId)
    }
  }

  /** Rewrite a short prompt into a detailed one with a chat model (non-streaming result). */
  async enhancePrompt(req: EnhanceRequest): Promise<string> {
    const chatReq: ChatRequest = {
      providerId: req.providerId,
      model: req.model,
      systemPrompt: ENHANCER_PROMPTS[req.target],
      temperature: 0.7,
      maxTokens: 800,
      messages: [{ role: 'user', content: req.prompt }]
    }
    let output = ''
    try {
      const a = this.adapter(req.providerId, 'chat')
      const result = await a.chat!.stream(this.providerContext(req.providerId), chatReq, {
        onDelta: (t) => (output += t)
      })
      this.app.storage.usage.record(req.providerId, 'chat', {
        usage: withEstimate(result.usage, chatReq, output),
        model: req.model
      })
    } catch (err) {
      this.app.storage.usage.record(req.providerId, 'chat', { error: true })
      throw new ProviderError({ ...this.toError(err, req.providerId, 'prompt enhancer') })
    }
    const text = cleanEnhanced(output)
    if (!text)
      throw new ProviderError({
        kind: 'unknown',
        providerId: req.providerId,
        message: 'The model returned an empty prompt.'
      })
    return text
  }

  /** Non-streaming chat completion (used by automation). Records usage like a chat request. */
  async completeChat(
    req: ChatRequest,
    signal?: AbortSignal
  ): Promise<{ text: string; usage?: TokenUsage }> {
    let text = ''
    try {
      const a = this.adapter(req.providerId, 'chat')
      const result = await a.chat!.stream(this.providerContext(req.providerId, signal), req, {
        onDelta: (t) => (text += t)
      })
      const usage = withEstimate(result.usage, req, text)
      this.app.storage.usage.record(req.providerId, 'chat', { usage, model: req.model })
      return { text, usage }
    } catch (err) {
      const info = this.toError(err, req.providerId, 'automation chat')
      if (info.kind !== 'cancelled')
        this.app.storage.usage.record(req.providerId, 'chat', { error: true })
      throw new ProviderError({ ...info })
    }
  }

  stopChat(requestId: string): void {
    this.activeChats.get(requestId)?.abort()
  }

  // ------------------------------------------------------------------ images

  /** Load a reference image: a gallery image by id, or uploaded base64. */
  private resolveImage(ref: ImageReference): ImageInput {
    if (ref.imageId) {
      const rec = this.app.storage.images.get(ref.imageId)
      if (!rec || !fs.existsSync(rec.filePath)) {
        throw new ProviderError({
          kind: 'bad_request',
          message: 'The reference image no longer exists.'
        })
      }
      return { data: fs.readFileSync(rec.filePath), mime: rec.mime }
    }
    if (ref.base64)
      return { data: Buffer.from(ref.base64, 'base64'), mime: ref.mime ?? 'image/png' }
    throw new ProviderError({ kind: 'bad_request', message: 'No reference image given.' })
  }

  private saveImages(
    outputs: Array<{ data: Buffer; mime: string; revisedPrompt?: string }>,
    meta: Omit<GeneratedImage, 'id' | 'mime' | 'filePath' | 'createdAt' | 'revisedPrompt'>
  ): GeneratedImage[] {
    const dir = mediaDir(this.app, 'images')
    return outputs.map((o) => {
      const id = newId('img_')
      const filePath = path.join(dir, `${id}.${extForMime(o.mime)}`)
      fs.writeFileSync(filePath, o.data)
      const rec: GeneratedImage = {
        id,
        ...meta,
        revisedPrompt: o.revisedPrompt,
        mime: o.mime,
        filePath,
        createdAt: Date.now()
      }
      this.app.storage.images.upsert(rec)
      // Sidecar metadata so the folder is self-describing.
      fs.writeFileSync(`${filePath}.json`, JSON.stringify({ ...rec, filePath: undefined }, null, 2))
      return rec
    })
  }

  async generateImages(req: ImageRequest): Promise<GeneratedImage[]> {
    try {
      const a = this.adapter(req.providerId, 'image')
      const reference = req.reference ? this.resolveImage(req.reference) : undefined
      const outputs = await a.image!.generate(this.providerContext(req.providerId), {
        model: req.model,
        prompt: req.prompt,
        negativePrompt: req.negativePrompt,
        size: req.size,
        count: req.count,
        reference,
        strength: req.strength
      })
      const records = this.saveImages(outputs, {
        providerId: req.providerId,
        model: req.model,
        prompt: req.prompt,
        negativePrompt: req.negativePrompt,
        size: req.size,
        operation: reference ? 'reference' : 'generate',
        sourceImageId: req.reference?.imageId
      })
      this.app.storage.usage.record(req.providerId, 'image', { images: records.length })
      return records
    } catch (err) {
      this.app.storage.usage.record(req.providerId, 'image', { error: true })
      throw new ProviderError({ ...this.toError(err, req.providerId, 'image generation') })
    }
  }

  async upscaleImage(imageId: string, providerId: string): Promise<GeneratedImage> {
    try {
      const a = this.adapter(providerId, 'image')
      if (!a.image!.upscale)
        throw new ProviderError({
          kind: 'unsupported',
          providerId,
          message: `${a.name} cannot upscale images.`
        })
      const source = this.app.storage.images.get(imageId)
      const out = await a.image!.upscale(
        this.providerContext(providerId),
        this.resolveImage({ imageId })
      )
      const [rec] = this.saveImages([out], {
        providerId,
        model: 'upscale',
        prompt: source?.prompt ?? '',
        operation: 'upscale',
        sourceImageId: imageId
      })
      this.app.storage.usage.record(providerId, 'image', { images: 1 })
      return rec
    } catch (err) {
      this.app.storage.usage.record(providerId, 'image', { error: true })
      throw new ProviderError({ ...this.toError(err, providerId, 'upscale') })
    }
  }

  async imageVariations(
    imageId: string,
    providerId: string,
    count: number
  ): Promise<GeneratedImage[]> {
    try {
      const a = this.adapter(providerId, 'image')
      if (!a.image!.vary)
        throw new ProviderError({
          kind: 'unsupported',
          providerId,
          message: `${a.name} cannot create variations.`
        })
      const source = this.app.storage.images.get(imageId)
      const outputs = await a.image!.vary(
        this.providerContext(providerId),
        this.resolveImage({ imageId }),
        count
      )
      const records = this.saveImages(outputs, {
        providerId,
        model: a.image!.variationModel ?? 'variation',
        prompt: source?.prompt ?? '',
        operation: 'variation',
        sourceImageId: imageId
      })
      this.app.storage.usage.record(providerId, 'image', { images: records.length })
      return records
    } catch (err) {
      this.app.storage.usage.record(providerId, 'image', { error: true })
      throw new ProviderError({ ...this.toError(err, providerId, 'image variations') })
    }
  }

  // ------------------------------------------------------------------ audio

  async textToSpeech(req: TtsRequest): Promise<AudioRecord> {
    try {
      const a = this.adapter(req.providerId, 'tts')
      const out = await a.tts!.synthesize(this.providerContext(req.providerId), {
        model: req.model,
        voice: req.voice,
        text: req.text
      })
      const id = newId('tts_')
      const filePath = path.join(mediaDir(this.app, 'audio'), `${id}.${extForMime(out.mime)}`)
      fs.writeFileSync(filePath, out.data)
      const rec: AudioRecord = { id, ...req, mime: out.mime, filePath, createdAt: Date.now() }
      this.app.storage.audio.upsert(rec)
      this.app.storage.usage.record(req.providerId, 'audio')
      return rec
    } catch (err) {
      this.app.storage.usage.record(req.providerId, 'audio', { error: true })
      throw new ProviderError({ ...this.toError(err, req.providerId, 'text to speech') })
    }
  }

  async speechToText(req: SttRequest): Promise<SttResult> {
    try {
      const a = this.adapter(req.providerId, 'stt')
      const result = await a.stt!.transcribe(this.providerContext(req.providerId), {
        model: req.model,
        audio: Buffer.from(req.audioBase64, 'base64'),
        mime: req.mime,
        fileName: req.fileName,
        language: req.language
      })
      this.app.storage.usage.record(req.providerId, 'audio')
      return result
    } catch (err) {
      this.app.storage.usage.record(req.providerId, 'audio', { error: true })
      throw new ProviderError({ ...this.toError(err, req.providerId, 'speech to text') })
    }
  }
}

/** Fill in a local estimate (~4 chars/token) when the provider reported no token counts. */
export function withEstimate(
  usage: TokenUsage | undefined,
  req: ChatRequest,
  output: string
): TokenUsage {
  if (usage && (usage.inputTokens !== undefined || usage.outputTokens !== undefined)) return usage
  const input = [
    req.systemPrompt ?? '',
    ...req.messages.flatMap((m) => [m.content, ...(m.attachments ?? []).map((a) => a.text ?? '')])
  ].join('\n')
  return {
    inputTokens: estimateTokens(input),
    outputTokens: estimateTokens(output),
    estimated: true
  }
}

export const ENHANCER_PROMPTS: Record<EnhanceRequest['target'], string> = {
  chat: `You improve prompts for AI chat assistants. Rewrite the user's short request into a clear, detailed prompt: state the goal, relevant context, constraints, the desired format and length, and the tone. Keep the user's language and intent; do not answer the request. Reply with ONLY the improved prompt, no preamble or quotes.`,
  image: `You write prompts for AI image generators. Expand the user's idea into one detailed prompt (60-120 words): subject, setting, composition and camera angle, lighting, colour palette, mood, art style or medium, and level of detail. Keep the user's language and intent. Reply with ONLY the prompt, no preamble or quotes.`,
  video: `You write prompts for AI video generators. Expand the user's idea into one detailed prompt (60-120 words) describing the scene, subject and action over time, camera movement, shot type, lighting, atmosphere, style and pacing. Keep the user's language and intent. Reply with ONLY the prompt, no preamble or quotes.`
}

/** Strip wrappers models like to add ("Here is…", quotes, code fences). */
export function cleanEnhanced(text: string): string {
  let t = text.trim()
  t = t.replace(/^```[\w-]*\n?|```$/g, '').trim()
  t = t.replace(
    /^(here(?:'s| is) (?:an? |the )?(?:improved|enhanced|detailed|rewritten)?\s*prompt[^:\n]*:)\s*/i,
    ''
  )
  t = t.replace(/^(improved|enhanced) prompt:\s*/i, '')
  if (/^["“'].*["”']$/s.test(t)) t = t.slice(1, -1).trim()
  return t
}
