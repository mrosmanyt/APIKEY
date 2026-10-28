/**
 * Types shared between the Electron main process, the preload bridge and the renderer.
 * Everything here must be plain serialisable data (it crosses the IPC boundary).
 * API keys never appear in any of these types.
 */

export type Capability = 'chat' | 'image' | 'video' | 'tts' | 'stt'
export const CAPABILITIES: Capability[] = ['chat', 'image', 'video', 'tts', 'stt']

/** App "modes" that can have a default provider/model. */
export type AppMode = 'chat' | 'code' | 'image' | 'video' | 'tts' | 'stt'

export interface ModelInfo {
  id: string
  name?: string
  /** Model accepts image input. */
  vision?: boolean
}

export interface ImageModelInfo extends ModelInfo {
  /** Allowed size or aspect-ratio values, e.g. "1024x1024" or "16:9". First is default. */
  sizes: string[]
  maxCount: number
  supportsNegativePrompt: boolean
}

export interface VideoModelInfo extends ModelInfo {
  sizes?: string[]
  durations?: number[]
  supportsImageInput: boolean
}

export interface VoiceInfo {
  id: string
  name: string
}

export interface ConfigField {
  key: string
  label: string
  placeholder?: string
  required?: boolean
  type?: 'text' | 'url'
  help?: string
}

export interface ProviderInfo {
  id: string
  name: string
  description: string
  /** Where users obtain an API key. */
  keyUrl: string
  keyPlaceholder: string
  /** Non-secret configuration (e.g. base URL for custom providers). */
  configFields: ConfigField[]
  canListModels: boolean
  capabilities: {
    chat?: { models: ModelInfo[] }
    image?: { models: ImageModelInfo[] }
    video?: { models: VideoModelInfo[]; experimental?: boolean }
    tts?: { models: ModelInfo[]; voices: VoiceInfo[]; canListVoices: boolean }
    stt?: { models: ModelInfo[] }
  }
}

export type KeyStatus = 'missing' | 'untested' | 'valid' | 'invalid'

export interface ProviderStatus {
  id: string
  hasKey: boolean
  status: KeyStatus
  /** Last four characters only, for recognition. Never the key itself. */
  keyHint?: string
  lastTestedAt?: number
  lastError?: AppErrorInfo
  config: Record<string, string>
}

export type ErrorKind =
  | 'invalid_key'
  | 'quota'
  | 'rate_limit'
  | 'network'
  | 'model_not_found'
  | 'content_policy'
  | 'bad_request'
  | 'server'
  | 'cancelled'
  | 'not_configured'
  | 'unsupported'
  | 'invalid_license'
  | 'unknown'

export interface AppErrorInfo {
  kind: ErrorKind
  /** Short human readable message (provider message when available, redacted). */
  message: string
  /** Raw (redacted) error details, shown behind a "Details" toggle. */
  details?: string
  status?: number
  providerId?: string
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: AppErrorInfo }

// ---------------------------------------------------------------- Chat

export type ChatRole = 'system' | 'user' | 'assistant'

export interface Attachment {
  id: string
  name: string
  mime: string
  kind: 'image' | 'text'
  size: number
  /** base64 payload for images (no data: prefix). */
  dataBase64?: string
  /** Text content for text files. */
  text?: string
}

export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
}

export interface ChatMessage {
  id: string
  role: Exclude<ChatRole, 'system'>
  content: string
  attachments?: Attachment[]
  createdAt: number
  providerId?: string
  model?: string
  usage?: TokenUsage
  error?: AppErrorInfo
}

export interface ChatRequest {
  providerId: string
  model: string
  systemPrompt?: string
  messages: Array<{
    role: Exclude<ChatRole, 'system'>
    content: string
    attachments?: Attachment[]
  }>
  temperature?: number
  maxTokens?: number
}

export type ChatStreamEvent =
  | { requestId: string; type: 'delta'; text: string }
  | { requestId: string; type: 'done'; usage?: TokenUsage; finishReason?: string }
  | { requestId: string; type: 'error'; error: AppErrorInfo }

export type ConversationMode = 'chat' | 'code'

export interface Conversation {
  id: string
  title: string
  mode: ConversationMode
  providerId: string
  model: string
  systemPrompt: string
  temperature: number
  maxTokens: number
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

export interface ConversationSummary {
  id: string
  title: string
  mode: ConversationMode
  providerId: string
  model: string
  messageCount: number
  createdAt: number
  updatedAt: number
  /** Short matching snippet when returned from a search. */
  snippet?: string
}

// ---------------------------------------------------------------- Images

export interface ImageRequest {
  providerId: string
  model: string
  prompt: string
  negativePrompt?: string
  size?: string
  count: number
}

export interface GeneratedImage {
  id: string
  providerId: string
  model: string
  prompt: string
  negativePrompt?: string
  revisedPrompt?: string
  size?: string
  mime: string
  filePath: string
  createdAt: number
}

// ---------------------------------------------------------------- Audio

export interface TtsRequest {
  providerId: string
  model: string
  voice: string
  text: string
}

export interface AudioRecord {
  id: string
  providerId: string
  model: string
  voice: string
  text: string
  mime: string
  filePath: string
  createdAt: number
}

export interface SttRequest {
  providerId: string
  model: string
  audioBase64: string
  mime: string
  fileName: string
  language?: string
}

export interface SttResult {
  text: string
}

// ---------------------------------------------------------------- Video

export type VideoJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface VideoRequest {
  providerId: string
  model: string
  prompt: string
  imageBase64?: string
  imageMime?: string
  size?: string
  durationSeconds?: number
}

export interface VideoJob {
  id: string
  providerId: string
  model: string
  prompt: string
  size?: string
  durationSeconds?: number
  hasImage: boolean
  status: VideoJobStatus
  /** 0-100 when the provider reports progress. */
  progress?: number
  providerJobId?: string
  /** Provider download reference (e.g. a result URL), when the provider returns one. */
  resultRef?: string
  filePath?: string
  error?: AppErrorInfo
  /** When polling (re)started; used for the timeout. */
  pollStartedAt?: number
  createdAt: number
  updatedAt: number
}

// ---------------------------------------------------------------- Settings & misc

export type ThemeSetting = 'system' | 'light' | 'dark'

export interface ModeDefault {
  providerId: string
  model: string
}

export interface Settings {
  theme: ThemeSetting
  language: string
  /** Empty string means the default (Documents/AI Hub). */
  outputDir: string
  defaults: Partial<Record<AppMode, ModeDefault>>
  chat: { temperature: number; maxTokens: number }
  /** Non-secret provider config, e.g. custom base URL. */
  providerConfig: Record<string, Record<string, string>>
  /** Cached model lists fetched from provider APIs. key = `${providerId}:${capability}` */
  modelCache: Record<string, ModelInfo[]>
  /** Cached voice lists. key = providerId */
  voiceCache: Record<string, VoiceInfo[]>
}

export interface ProviderUsage {
  requests: number
  errors: number
  inputTokens: number
  outputTokens: number
  images: number
  audioRequests: number
  videoJobs: number
  lastUsedAt?: number
}

export type UsageStats = Record<string, ProviderUsage>

export type PromptMode = 'any' | 'chat' | 'code' | 'image' | 'video' | 'tts'

export interface SavedPrompt {
  id: string
  title: string
  content: string
  mode: PromptMode
  favourite: boolean
  createdAt: number
  updatedAt: number
}

export interface LicenseStatus {
  activated: boolean
  licensee?: string
  email?: string
  licenseId?: string
  issuedAt?: string
  /** True when running unpackaged (development) — allows skipping activation. */
  devMode: boolean
  /** True when the user skipped activation in development mode. */
  devSkipped?: boolean
}

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  isPackaged: boolean
  userDataPath: string
  logsPath: string
  outputDir: string
}

export interface BackupResult {
  filePath: string
  includedKeys: boolean
}

export interface RestoreResult {
  conversations: number
  prompts: number
  keys: number
  settings: boolean
}
