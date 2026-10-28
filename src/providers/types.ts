import type {
  ChatRequest,
  ConfigField,
  ImageModelInfo,
  ModelInfo,
  TokenUsage,
  VideoJobStatus,
  VideoModelInfo,
  VoiceInfo,
  Capability
} from '@shared/types'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** Everything an adapter needs to make a call. Provided by the main process. */
export interface ProviderContext {
  apiKey: string
  /** Non-secret per-provider configuration (e.g. baseUrl for custom providers). */
  config: Record<string, string>
  fetch: FetchLike
  signal?: AbortSignal
  /** Injectable for tests; defaults to setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>
  /** Max automatic retries on rate limits / transient errors. Default 3. */
  maxRetries?: number
}

export interface ChatStreamHandlers {
  onDelta: (text: string) => void
}

export interface ChatResult {
  usage?: TokenUsage
  finishReason?: string
}

export interface ImageGenerateRequest {
  model: string
  prompt: string
  negativePrompt?: string
  size?: string
  count: number
}

export interface ImageOutput {
  data: Buffer
  mime: string
  revisedPrompt?: string
}

export interface TtsSynthesizeRequest {
  model: string
  voice: string
  text: string
}

export interface AudioOutput {
  data: Buffer
  mime: string
}

export interface SttTranscribeRequest {
  model: string
  audio: Buffer
  mime: string
  fileName: string
  language?: string
}

export interface VideoSubmitRequest {
  model: string
  prompt: string
  image?: { data: Buffer; mime: string }
  size?: string
  durationSeconds?: number
}

export interface VideoPollResult {
  status: Exclude<VideoJobStatus, 'cancelled'>
  progress?: number
  /** Provider message for failures. */
  error?: string
  /** Optional provider-specific download reference (e.g. a URL). */
  resultRef?: string
}

/**
 * The provider adapter contract. Every capability is optional; the UI discovers what a
 * provider can do by looking at which capability objects exist (via the registry).
 */
export interface ProviderAdapter {
  id: string
  name: string
  description: string
  keyUrl: string
  keyPlaceholder: string
  configFields?: ConfigField[]

  /** Validate the key with a cheap authenticated request. Throws ProviderError on failure. */
  testKey(ctx: ProviderContext): Promise<void>

  /** Fetch live model list from the API, for a given capability. */
  listModels?(ctx: ProviderContext, capability: Capability): Promise<ModelInfo[]>

  chat?: {
    models: ModelInfo[]
    stream(
      ctx: ProviderContext,
      req: ChatRequest,
      handlers: ChatStreamHandlers
    ): Promise<ChatResult>
  }

  image?: {
    models: ImageModelInfo[]
    generate(ctx: ProviderContext, req: ImageGenerateRequest): Promise<ImageOutput[]>
  }

  tts?: {
    models: ModelInfo[]
    voices: VoiceInfo[]
    listVoices?(ctx: ProviderContext): Promise<VoiceInfo[]>
    synthesize(ctx: ProviderContext, req: TtsSynthesizeRequest): Promise<AudioOutput>
  }

  stt?: {
    models: ModelInfo[]
    transcribe(ctx: ProviderContext, req: SttTranscribeRequest): Promise<{ text: string }>
  }

  video?: {
    models: VideoModelInfo[]
    /** Marks adapters whose API details are not fully confirmed. */
    experimental?: boolean
    submit(ctx: ProviderContext, req: VideoSubmitRequest): Promise<{ jobId: string }>
    poll(ctx: ProviderContext, jobId: string): Promise<VideoPollResult>
    download(ctx: ProviderContext, jobId: string, resultRef?: string): Promise<AudioOutput>
  }
}
