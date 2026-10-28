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
  GeneratedImage,
  ImageRequest,
  ModelInfo,
  ProviderStatus,
  SttRequest,
  SttResult,
  TtsRequest,
  VoiceInfo
} from '@shared/types'
import { ProviderError, toProviderError } from '../../providers/errors'
import { supports } from '../../providers/registry'
import type { ProviderAdapter, ProviderContext } from '../../providers/types'
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
    const apiKey = this.app.storage.keys.get(providerId)
    if (!apiKey) {
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
  async startChat(requestId: string, req: ChatRequest): Promise<void> {
    const emit = (payload: object) => this.app.emit('chat:event', { requestId, ...payload })
    const controller = new AbortController()
    this.activeChats.set(requestId, controller)
    try {
      const a = this.adapter(req.providerId, 'chat')
      const ctx = this.providerContext(req.providerId, controller.signal)
      const result = await a.chat!.stream(ctx, req, {
        onDelta: (text) => emit({ type: 'delta', text })
      })
      this.app.storage.usage.record(req.providerId, 'chat', { usage: result.usage })
      emit({ type: 'done', usage: result.usage, finishReason: result.finishReason })
    } catch (err) {
      const error = this.toError(err, req.providerId, 'chat')
      if (error.kind !== 'cancelled')
        this.app.storage.usage.record(req.providerId, 'chat', { error: true })
      emit({ type: 'error', error })
    } finally {
      this.activeChats.delete(requestId)
    }
  }

  stopChat(requestId: string): void {
    this.activeChats.get(requestId)?.abort()
  }

  // ------------------------------------------------------------------ images

  async generateImages(req: ImageRequest): Promise<GeneratedImage[]> {
    try {
      const a = this.adapter(req.providerId, 'image')
      const outputs = await a.image!.generate(this.providerContext(req.providerId), {
        model: req.model,
        prompt: req.prompt,
        negativePrompt: req.negativePrompt,
        size: req.size,
        count: req.count
      })
      const dir = mediaDir(this.app, 'images')
      const records: GeneratedImage[] = outputs.map((o) => {
        const id = newId('img_')
        const filePath = path.join(dir, `${id}.${extForMime(o.mime)}`)
        fs.writeFileSync(filePath, o.data)
        const rec: GeneratedImage = {
          id,
          providerId: req.providerId,
          model: req.model,
          prompt: req.prompt,
          negativePrompt: req.negativePrompt,
          revisedPrompt: o.revisedPrompt,
          size: req.size,
          mime: o.mime,
          filePath,
          createdAt: Date.now()
        }
        this.app.storage.images.upsert(rec)
        // Sidecar metadata so the folder is self-describing.
        fs.writeFileSync(
          `${filePath}.json`,
          JSON.stringify({ ...rec, filePath: undefined }, null, 2)
        )
        return rec
      })
      this.app.storage.usage.record(req.providerId, 'image', { images: records.length })
      return records
    } catch (err) {
      this.app.storage.usage.record(req.providerId, 'image', { error: true })
      throw new ProviderError({ ...this.toError(err, req.providerId, 'image generation') })
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
