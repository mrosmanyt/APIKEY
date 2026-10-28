import { DEFAULT_SETTINGS } from '@shared/defaults'
import type { Settings } from '@shared/types'
import { JsonStore } from './jsonStore'

export class SettingsStore {
  private readonly store: JsonStore<Settings>

  constructor(filePath: string) {
    this.store = new JsonStore<Settings>(filePath, () => structuredClone(DEFAULT_SETTINGS))
  }

  get(): Settings {
    // Merge with defaults so new settings keys appear after upgrades.
    const s = this.store.read()
    return {
      ...DEFAULT_SETTINGS,
      ...s,
      chat: { ...DEFAULT_SETTINGS.chat, ...(s.chat ?? {}) },
      defaults: { ...(s.defaults ?? {}) },
      providerConfig: { ...(s.providerConfig ?? {}) },
      modelCache: { ...(s.modelCache ?? {}) },
      voiceCache: { ...(s.voiceCache ?? {}) },
      automation: {
        ...DEFAULT_SETTINGS.automation,
        ...(s.automation ?? {}),
        unitCosts: { ...DEFAULT_SETTINGS.automation.unitCosts, ...(s.automation?.unitCosts ?? {}) }
      }
    }
  }

  update(patch: Partial<Settings>): Settings {
    const next = { ...this.get(), ...patch }
    this.store.write(next)
    return next
  }

  replace(settings: Settings): void {
    this.store.write(settings)
  }
}
