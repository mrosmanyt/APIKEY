/**
 * Backup / restore of settings, conversations, prompts and usage as a single JSON file.
 *
 * API keys are only included when the user explicitly opts in, and then ONLY encrypted:
 * a key is derived from a user passphrase with scrypt (random 16-byte salt) and the keys are
 * sealed with AES-256-GCM (random 12-byte IV, 16-byte auth tag). The passphrase and the plain
 * keys are never written to disk or to the log.
 */
import crypto from 'node:crypto'
import type {
  BackupImportPreview,
  Conversation,
  RestoreResult,
  SavedPrompt,
  Settings,
  UsageStats
} from '@shared/types'
import { ProviderError } from '../../providers/errors'
import type { Storage } from '../storage'

export const BACKUP_FORMAT = 'ai-hub-backup'
/** v1 (unreleased dev builds) stored keys in plain text; v2 stores them encrypted. */
export const BACKUP_VERSION = 2
export const MIN_PASSPHRASE_LENGTH = 8

/** scrypt cost parameters, stored in the file so they can be raised later. */
const SCRYPT = { N: 2 ** 15, r: 8, p: 1 }
const SCRYPT_MAXMEM = 128 * 1024 * 1024
const SALT_BYTES = 16
const IV_BYTES = 12
const KEY_BYTES = 32

export interface EncryptedKeys {
  kdf: 'scrypt'
  N: number
  r: number
  p: number
  cipher: 'aes-256-gcm'
  /** base64 */
  salt: string
  /** base64 */
  iv: string
  /** base64 */
  authTag: string
  /** base64 of AES-256-GCM(JSON of { providerId: apiKey }) */
  ciphertext: string
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  version: number
  appVersion: string
  exportedAt: string
  settings: Settings
  conversations: Conversation[]
  prompts: SavedPrompt[]
  usage: UsageStats
  encryptedKeys?: EncryptedKeys
  /** Legacy v1 plain-text keys. Read for compatibility, never written. */
  keys?: Record<string, string>
}

export type BackupSummary = Omit<BackupImportPreview, 'fileName'>

function passphraseError(message: string) {
  return new ProviderError({ kind: 'invalid_passphrase', message })
}

export function assertPassphrase(passphrase: string | undefined): asserts passphrase is string {
  if (!passphrase || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw passphraseError(`The passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`)
  }
}

function deriveKey(
  passphrase: string,
  salt: Buffer,
  params: { N: number; r: number; p: number }
): Buffer {
  return crypto.scryptSync(passphrase.normalize('NFC'), salt, KEY_BYTES, {
    ...params,
    maxmem: SCRYPT_MAXMEM
  })
}

export function encryptKeys(keys: Record<string, string>, passphrase: string): EncryptedKeys {
  assertPassphrase(passphrase)
  const salt = crypto.randomBytes(SALT_BYTES)
  const iv = crypto.randomBytes(IV_BYTES)
  const key = deriveKey(passphrase, salt, SCRYPT)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  // Bind the ciphertext to the format so it cannot be transplanted into another file type.
  cipher.setAAD(Buffer.from(BACKUP_FORMAT))
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(keys), 'utf8'), cipher.final()])
  return {
    kdf: 'scrypt',
    ...SCRYPT,
    cipher: 'aes-256-gcm',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  }
}

export function decryptKeys(enc: EncryptedKeys, passphrase: string): Record<string, string> {
  if (enc.kdf !== 'scrypt' || enc.cipher !== 'aes-256-gcm') {
    throw new Error('This backup uses an unsupported encryption format.')
  }
  const N = Number(enc.N)
  const r = Number(enc.r)
  const p = Number(enc.p)
  // Refuse absurd parameters from a tampered file (memory exhaustion).
  if (!(N >= 2 ** 10 && N <= 2 ** 20 && r >= 1 && r <= 32 && p >= 1 && p <= 16)) {
    throw new Error('This backup has invalid encryption parameters.')
  }
  let plain: string
  try {
    const key = deriveKey(passphrase, Buffer.from(enc.salt, 'base64'), { N, r, p })
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(enc.iv, 'base64'))
    decipher.setAAD(Buffer.from(BACKUP_FORMAT))
    decipher.setAuthTag(Buffer.from(enc.authTag, 'base64'))
    plain = Buffer.concat([
      decipher.update(Buffer.from(enc.ciphertext, 'base64')),
      decipher.final()
    ]).toString('utf8')
  } catch {
    // GCM authentication failure: wrong passphrase or a modified file.
    throw passphraseError(
      'Wrong passphrase — the API keys could not be decrypted. Check the passphrase and try again.'
    )
  }
  const parsed = JSON.parse(plain) as unknown
  if (!parsed || typeof parsed !== 'object') throw new Error('The encrypted keys are corrupt.')
  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === 'string'
    )
  )
}

export function createBackup(
  storage: Storage,
  appVersion: string,
  opts: { includeKeys: boolean; passphrase?: string }
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
  if (opts.includeKeys) {
    assertPassphrase(opts.passphrase)
    const keys: Record<string, string> = {}
    for (const id of storage.keys.providerIds()) {
      const k = storage.keys.get(id)
      if (k) keys[id] = k
    }
    backup.encryptedKeys = encryptKeys(keys, opts.passphrase)
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
  const enc = b.encryptedKeys
  return {
    format: BACKUP_FORMAT,
    version: b.version,
    appVersion: String(b.appVersion ?? ''),
    exportedAt: String(b.exportedAt ?? ''),
    settings: b.settings as Settings,
    conversations: Array.isArray(b.conversations) ? b.conversations : [],
    prompts: Array.isArray(b.prompts) ? b.prompts : [],
    usage: b.usage && typeof b.usage === 'object' ? b.usage : {},
    encryptedKeys:
      enc && typeof enc === 'object' && typeof enc.ciphertext === 'string' ? enc : undefined,
    keys: b.keys && typeof b.keys === 'object' ? b.keys : undefined
  }
}

export function summarizeBackup(b: BackupFile): BackupSummary {
  return {
    conversations: b.conversations.length,
    prompts: b.prompts.length,
    hasKeys: Boolean(b.encryptedKeys || (b.keys && Object.keys(b.keys).length)),
    needsPassphrase: Boolean(b.encryptedKeys)
  }
}

/**
 * Restore merges by id: existing conversations/prompts with the same id are overwritten.
 * Encrypted keys are decrypted (and validated) BEFORE anything is written, so a wrong
 * passphrase leaves the current data untouched.
 */
export function restoreBackup(
  storage: Storage,
  backup: BackupFile,
  opts: { passphrase?: string; skipKeys?: boolean } = {}
): RestoreResult {
  let keysToRestore: Record<string, string> = {}
  if (!opts.skipKeys) {
    if (backup.encryptedKeys) {
      if (!opts.passphrase) {
        throw passphraseError('This backup contains encrypted API keys. Enter its passphrase.')
      }
      keysToRestore = decryptKeys(backup.encryptedKeys, opts.passphrase)
    } else if (backup.keys) {
      keysToRestore = backup.keys
    }
  }

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
  for (const [id, key] of Object.entries(keysToRestore)) {
    if (typeof key === 'string' && key.trim() && /^[a-z0-9_-]{1,40}$/.test(id)) {
      storage.keys.set(id, key)
      keys++
    }
  }
  return { conversations, prompts, keys, settings }
}
