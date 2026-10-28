import { create } from 'zustand'
import type {
  Capability,
  LicenseStatus,
  ModelInfo,
  ProviderInfo,
  ProviderStatus,
  Settings,
  VoiceInfo
} from '@shared/types'
import { setLanguage } from '../i18n'
import { api, call } from './api'

export type Page =
  'chat' | 'code' | 'images' | 'video' | 'audio' | 'history' | 'prompts' | 'settings'

export interface PendingPrompt {
  page: Page
  text: string
}

interface AppState {
  ready: boolean
  page: Page
  settingsTab: string
  license?: LicenseStatus
  providers: ProviderInfo[]
  statuses: Record<string, ProviderStatus>
  settings?: Settings
  /** Conversation to open on the chat/code page. */
  openConversation: { chat?: string; code?: string }
  pendingPrompt?: PendingPrompt
  toast?: { text: string; kind: 'info' | 'error'; id: number }

  init(): Promise<void>
  navigate(page: Page, opts?: { settingsTab?: string }): void
  refreshProviders(): Promise<void>
  setStatuses(list: ProviderStatus[]): void
  updateSettings(patch: Partial<Settings>): Promise<void>
  setSettings(s: Settings): void
  setLicense(l: LicenseStatus): void
  openConversationIn(mode: 'chat' | 'code', id: string | undefined): void
  applyPrompt(p: PendingPrompt | undefined): void
  showToast(text: string, kind?: 'info' | 'error'): void
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  page: 'chat',
  settingsTab: 'keys',
  providers: [],
  statuses: {},
  openConversation: {},

  async init() {
    const license = await call(api().license.status())
    if (!license.activated && !license.devSkipped) {
      set({ license, ready: true })
      return
    }
    const [providers, statuses, settings] = await Promise.all([
      call(api().providers.list()),
      call(api().providers.statuses()),
      call(api().settings.get())
    ])
    setLanguage(settings.language)
    set({
      license,
      providers,
      statuses: Object.fromEntries(statuses.map((s) => [s.id, s])),
      settings,
      ready: true
    })
    // First run: no keys yet -> take the user to the API key settings.
    if (!statuses.some((s) => s.hasKey)) set({ page: 'settings', settingsTab: 'keys' })
  },

  navigate(page, opts) {
    set({ page, ...(opts?.settingsTab ? { settingsTab: opts.settingsTab } : {}) })
  },

  async refreshProviders() {
    const [providers, statuses] = await Promise.all([
      call(api().providers.list()),
      call(api().providers.statuses())
    ])
    set({ providers })
    get().setStatuses(statuses)
  },

  setStatuses(list) {
    set({ statuses: Object.fromEntries(list.map((s) => [s.id, s])) })
  },

  async updateSettings(patch) {
    const settings = await call(api().settings.update(patch))
    if (patch.language) setLanguage(settings.language)
    set({ settings })
  },

  setSettings(settings) {
    setLanguage(settings.language)
    set({ settings })
  },

  setLicense(license) {
    const wasLicensed = Boolean(get().license?.activated || get().license?.devSkipped)
    set({ license })
    if (!wasLicensed && (license.activated || license.devSkipped)) void get().init()
  },

  openConversationIn(mode, id) {
    set((s) => ({ openConversation: { ...s.openConversation, [mode]: id }, page: mode }))
  },

  applyPrompt(p) {
    set(p ? { pendingPrompt: p, page: p.page } : { pendingPrompt: undefined })
  },

  showToast(text, kind = 'info') {
    const id = Date.now()
    set({ toast: { text, kind, id } })
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: undefined })
    }, 3500)
  }
}))

/** Providers whose key has been tested valid and that support the capability. */
export function usableProviders(
  state: Pick<AppState, 'providers' | 'statuses'>,
  capability: Capability
) {
  return state.providers.filter(
    (p) => p.capabilities[capability] && state.statuses[p.id]?.status === 'valid'
  )
}

/** Built-in models merged with any list refreshed from the provider API. */
export function modelsFor(
  provider: ProviderInfo | undefined,
  capability: Capability,
  settings?: Settings
): ModelInfo[] {
  if (!provider) return []
  const builtIn = (provider.capabilities[capability]?.models ?? []) as ModelInfo[]
  const cached = settings?.modelCache[`${provider.id}:${capability}`] ?? []
  const seen = new Set(builtIn.map((m) => m.id))
  return [...builtIn, ...cached.filter((m) => !seen.has(m.id))]
}

export function voicesFor(provider: ProviderInfo | undefined, settings?: Settings): VoiceInfo[] {
  if (!provider?.capabilities.tts) return []
  const cached = settings?.voiceCache[provider.id]
  return cached?.length ? cached : provider.capabilities.tts.voices
}
