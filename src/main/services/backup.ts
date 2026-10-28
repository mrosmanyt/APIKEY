/**
 * Backup / restore of settings, conversations, prompts, usage and media metadata as a single
 * JSON file. API keys are only included when the user explicitly opts in — they are then
 * stored in PLAIN TEXT inside the backup file, which the UI warns about.
 */
import type { Conversation, SavedPrompt, Settings, UsageStats, RestoreResult } from '@shared/types'
import type { Storage } from '../storage'

export const BACKUP_FORMAT = 'ai-hub-backup'
export const BACKUP_VERSION = 1

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  version: number
  appVersion: string
  exportedAt: string
  settings: Settings
  conversations: Conversation[]
  prompts: SavedPrompt[]
  usage: UsageStats
  keys?: Record<string, string>
}

export function createBackup(
  storage: Storage,
  appVersion: string,
  includeKeys: boolean
): BackupFile {
  const backup: BackupFile = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    appVersion,
    exportedAt: new Date().toISOString(),
    settings: storage.settings.get(),
    conversations: storage.conversations.all(),
    prompts: storage.prompts.all(),
    usage: storage.usage.get()
  }
  if (includeKeys) {
    const keys: Record<string, string> = {}
    for (const id of storage.keys.providerIds()) {
      const k = storage.keys.get(id)
      if (k) keys[id] = k
    }
    backup.keys = keys
  }
  return backup
}

export function parseBackup(text: string): BackupFile {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('This file is not a valid AI Hub backup (invalid JSON).')
  }
  const b = data as Partial<BackupFile>
  if (b?.format !== BACKUP_FORMAT || typeof b.version !== 'number') {
    throw new Error('This file is not an AI Hub backup.')
  }
  if (b.version > BACKUP_VERSION) {
    throw new Error('This backup was created by a newer version of AI Hub. Please update the app.')
  }
  return {
    format: BACKUP_FORMAT,
    version: b.version,
    appVersion: String(b.appVersion ?? ''),
    exportedAt: String(b.exportedAt ?? ''),
    settings: b.settings as Settings,
    conversations: Array.isArray(b.conversations) ? b.conversations : [],
    prompts: Array.isArray(b.prompts) ? b.prompts : [],
    usage: b.usage && typeof b.usage === 'object' ? b.usage : {},
    keys: b.keys && typeof b.keys === 'object' ? b.keys : undefined
  }
}

/** Restore merges by id: existing conversations/prompts with the same id are overwritten. */
export function restoreBackup(storage: Storage, backup: BackupFile): RestoreResult {
  let settings = false
  if (backup.settings && typeof backup.settings === 'object') {
    storage.settings.replace({ ...storage.settings.get(), ...backup.settings })
    settings = true
  }
  let conversations = 0
  for (const c of backup.conversations) {
    if (c && typeof c.id === 'string' && Array.isArray(c.messages)) {
      try {
        storage.conversations.save(c)
        conversations++
      } catch {
        /* invalid id: skip */
      }
    }
  }
  let prompts = 0
  for (const p of backup.prompts) {
    if (p && typeof p.id === 'string' && typeof p.content === 'string') {
      storage.prompts.upsert(p)
      prompts++
    }
  }
  if (backup.usage) storage.usage.replace(backup.usage)
  let keys = 0
  for (const [id, key] of Object.entries(backup.keys ?? {})) {
    if (typeof key === 'string' && key.trim()) {
      storage.keys.set(id, key)
      keys++
    }
  }
  return { conversations, prompts, keys, settings }
}
