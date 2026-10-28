/**
 * The complete API exposed to the renderer as `window.aihub`. Types only — shared by the
 * preload script (implementation) and the renderer (consumer).
 * Every call resolves to an IpcResult; nothing here ever carries an API key back.
 */
import type {
  AppInfo,
  AudioRecord,
  BackupResult,
  Capability,
  ChatRequest,
  ChatStreamEvent,
  Conversation,
  ConversationSummary,
  GeneratedImage,
  ImageRequest,
  IpcResult,
  LicenseStatus,
  ModelInfo,
  ProviderInfo,
  ProviderStatus,
  RestoreResult,
  SavedPrompt,
  Settings,
  SttRequest,
  SttResult,
  TtsRequest,
  UsageStats,
  VideoJob,
  VideoRequest,
  VoiceInfo
} from '../shared/types'

type R<T> = Promise<IpcResult<T>>

export interface AiHubApi {
  app: {
    info(): R<AppInfo>
    openLogsFolder(): R<void>
    openOutputFolder(): R<void>
    openExternal(url: string): R<void>
  }
  license: {
    status(): R<LicenseStatus>
    activate(key: string): R<LicenseStatus>
    deactivate(): R<LicenseStatus>
    skipDev(): R<LicenseStatus>
  }
  providers: {
    list(): R<ProviderInfo[]>
    statuses(): R<ProviderStatus[]>
    saveKey(providerId: string, key: string): R<ProviderStatus[]>
    deleteKey(providerId: string): R<ProviderStatus[]>
    testKey(providerId: string): R<ProviderStatus>
    setConfig(providerId: string, config: Record<string, string>): R<ProviderStatus[]>
    listModels(providerId: string, capability: Capability): R<ModelInfo[]>
    listVoices(providerId: string): R<VoiceInfo[]>
  }
  chat: {
    start(requestId: string, req: ChatRequest): R<void>
    stop(requestId: string): R<void>
    onEvent(cb: (ev: ChatStreamEvent) => void): () => void
  }
  conversations: {
    list(): R<ConversationSummary[]>
    search(query: string): R<ConversationSummary[]>
    get(id: string): R<Conversation | null>
    save(conv: Conversation): R<Conversation>
    rename(id: string, title: string): R<Conversation | null>
    delete(id: string): R<void>
    export(id: string, format: 'markdown' | 'json'): R<string | null>
  }
  files: {
    /** Opens a save dialog; returns the chosen path or null if cancelled. */
    saveText(defaultName: string, content: string): R<string | null>
  }
  images: {
    generate(req: ImageRequest): R<GeneratedImage[]>
    list(): R<GeneratedImage[]>
    delete(id: string): R<void>
    copy(id: string): R<void>
    reveal(id: string): R<void>
    saveAs(id: string): R<string | null>
  }
  audio: {
    tts(req: TtsRequest): R<AudioRecord>
    list(): R<AudioRecord[]>
    delete(id: string): R<void>
    saveAs(id: string): R<string | null>
    stt(req: SttRequest): R<SttResult>
  }
  video: {
    submit(req: VideoRequest): R<VideoJob>
    list(): R<VideoJob[]>
    cancel(id: string): R<VideoJob | null>
    retry(id: string): R<VideoJob | null>
    delete(id: string): R<void>
    saveAs(id: string): R<string | null>
    reveal(id: string): R<void>
    onUpdate(cb: (job: VideoJob) => void): () => void
  }
  settings: {
    get(): R<Settings>
    update(patch: Partial<Settings>): R<Settings>
    chooseOutputDir(): R<Settings | null>
  }
  usage: {
    get(): R<UsageStats>
    reset(): R<UsageStats>
  }
  prompts: {
    list(): R<SavedPrompt[]>
    save(prompt: SavedPrompt): R<SavedPrompt>
    delete(id: string): R<void>
  }
  backup: {
    export(includeKeys: boolean): R<BackupResult | null>
    import(): R<RestoreResult | null>
  }
}

/** Channel names. The preload only ever forwards to these. */
export const INVOKE_CHANNELS = [
  'app:info',
  'app:openLogsFolder',
  'app:openOutputFolder',
  'app:openExternal',
  'license:status',
  'license:activate',
  'license:deactivate',
  'license:skipDev',
  'providers:list',
  'providers:statuses',
  'providers:saveKey',
  'providers:deleteKey',
  'providers:testKey',
  'providers:setConfig',
  'providers:listModels',
  'providers:listVoices',
  'chat:start',
  'chat:stop',
  'conversations:list',
  'conversations:search',
  'conversations:get',
  'conversations:save',
  'conversations:rename',
  'conversations:delete',
  'conversations:export',
  'files:saveText',
  'images:generate',
  'images:list',
  'images:delete',
  'images:copy',
  'images:reveal',
  'images:saveAs',
  'audio:tts',
  'audio:list',
  'audio:delete',
  'audio:saveAs',
  'audio:stt',
  'video:submit',
  'video:list',
  'video:cancel',
  'video:retry',
  'video:delete',
  'video:saveAs',
  'video:reveal',
  'settings:get',
  'settings:update',
  'settings:chooseOutputDir',
  'usage:get',
  'usage:reset',
  'prompts:list',
  'prompts:save',
  'prompts:delete',
  'backup:export',
  'backup:import'
] as const

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number]

export const EVENT_CHANNELS = ['chat:event', 'video:update'] as const
