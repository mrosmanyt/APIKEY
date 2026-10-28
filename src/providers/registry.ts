/**
 * Provider registry. The UI never hard-codes providers: it asks the main process for
 * `listProviderInfo()` and renders whatever capabilities each adapter exposes.
 *
 * To add a provider: create src/providers/<name>/index.ts exporting a ProviderAdapter and
 * add it to ADAPTERS below. No UI changes needed.
 */
import type { Capability, ProviderInfo } from '@shared/types'
import { anthropicAdapter } from './anthropic'
import { customAdapter } from './custom'
import { elevenlabsAdapter } from './elevenlabs'
import { geminiAdapter } from './gemini'
import { openaiAdapter } from './openai'
import type { ProviderAdapter } from './types'
import { xaiAdapter } from './xai'

export const ADAPTERS: ProviderAdapter[] = [
  openaiAdapter,
  anthropicAdapter,
  geminiAdapter,
  xaiAdapter,
  elevenlabsAdapter,
  customAdapter
]

export class ProviderRegistry {
  private readonly byId = new Map<string, ProviderAdapter>()

  constructor(adapters: ProviderAdapter[] = ADAPTERS) {
    for (const a of adapters) {
      if (this.byId.has(a.id)) throw new Error(`Duplicate provider id: ${a.id}`)
      this.byId.set(a.id, a)
    }
  }

  list(): ProviderAdapter[] {
    return [...this.byId.values()]
  }

  get(id: string): ProviderAdapter | undefined {
    return this.byId.get(id)
  }

  has(id: string, capability?: Capability): boolean {
    const a = this.byId.get(id)
    if (!a) return false
    return capability ? supports(a, capability) : true
  }

  withCapability(capability: Capability): ProviderAdapter[] {
    return this.list().filter((a) => supports(a, capability))
  }

  info(id: string, config: Record<string, string> = {}): ProviderInfo | undefined {
    const a = this.byId.get(id)
    return a ? toProviderInfo(a, config) : undefined
  }

  listInfo(configs: Record<string, Record<string, string>> = {}): ProviderInfo[] {
    return this.list().map((a) => toProviderInfo(a, configs[a.id] ?? {}))
  }
}

export function supports(a: ProviderAdapter, capability: Capability): boolean {
  return Boolean(a[capability as keyof ProviderAdapter])
}

/** Serialisable description of an adapter for the renderer. */
export function toProviderInfo(
  a: ProviderAdapter,
  config: Record<string, string> = {}
): ProviderInfo {
  const info: ProviderInfo = {
    id: a.id,
    name: config.displayName?.trim() || a.name,
    description: a.description,
    keyUrl: a.keyUrl,
    keyPlaceholder: a.keyPlaceholder,
    configFields: a.configFields ?? [],
    canListModels: Boolean(a.listModels),
    capabilities: {}
  }
  if (a.chat) {
    const models = [...a.chat.models]
    const configured = config.model?.trim()
    if (configured && !models.some((m) => m.id === configured))
      models.unshift({ id: configured, vision: true })
    info.capabilities.chat = { models }
  }
  if (a.image) info.capabilities.image = { models: a.image.models }
  if (a.video)
    info.capabilities.video = { models: a.video.models, experimental: a.video.experimental }
  if (a.tts)
    info.capabilities.tts = {
      models: a.tts.models,
      voices: a.tts.voices,
      canListVoices: Boolean(a.tts.listVoices)
    }
  if (a.stt) info.capabilities.stt = { models: a.stt.models }
  return info
}

export const registry = new ProviderRegistry()
