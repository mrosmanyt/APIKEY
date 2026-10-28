import { registerSecret, unregisterSecret } from '@shared/redact'
import type { AppErrorInfo, KeyStatus } from '@shared/types'
import { JsonStore } from './jsonStore'

/** Abstraction over Electron's safeStorage so the store is testable without Electron. */
export interface Encryptor {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(cipher: Buffer): string
}

interface StoredKey {
  /** base64 of safeStorage ciphertext */
  cipher: string
  hint: string
  status: KeyStatus
  lastTestedAt?: number
  lastError?: AppErrorInfo
  updatedAt: number
}

type KeyFile = Record<string, StoredKey>

export class KeyEncryptionUnavailableError extends Error {
  constructor() {
    super('Secure storage is not available on this system, so API keys cannot be saved encrypted.')
  }
}

/**
 * Stores API keys encrypted with the OS keychain (Windows DPAPI via Electron safeStorage).
 * Plain-text keys only ever live in main-process memory while a request is being made.
 */
export class KeyStore {
  private readonly store: JsonStore<KeyFile>

  constructor(
    filePath: string,
    private readonly encryptor: Encryptor
  ) {
    this.store = new JsonStore<KeyFile>(filePath, () => ({}))
  }

  /** Register all stored keys with the redactor (call once at startup). */
  registerAllForRedaction(): void {
    for (const id of Object.keys(this.store.read())) registerSecret(this.get(id))
  }

  set(providerId: string, apiKey: string): void {
    const key = apiKey.trim()
    if (!key) throw new Error('API key is empty')
    if (!this.encryptor.isAvailable()) throw new KeyEncryptionUnavailableError()
    registerSecret(key)
    const cipher = this.encryptor.encrypt(key).toString('base64')
    this.store.update((all) => ({
      ...all,
      [providerId]: { cipher, hint: key.slice(-4), status: 'untested', updatedAt: Date.now() }
    }))
  }

  /** Mark a provider that needs no key (e.g. local Ollama) as connected. */
  setKeyless(providerId: string): void {
    this.store.update((all) => ({
      ...all,
      [providerId]: { cipher: '', hint: '', status: 'untested', updatedAt: Date.now() }
    }))
  }

  get(providerId: string): string | undefined {
    const entry = this.store.read()[providerId]
    if (!entry) return undefined
    if (entry.cipher === '') return ''
    try {
      return this.encryptor.decrypt(Buffer.from(entry.cipher, 'base64'))
    } catch {
      return undefined
    }
  }

  has(providerId: string): boolean {
    return Boolean(this.store.read()[providerId])
  }

  delete(providerId: string): void {
    unregisterSecret(this.get(providerId))
    this.store.update((all) => {
      const copy = { ...all }
      delete copy[providerId]
      return copy
    })
  }

  setStatus(providerId: string, status: KeyStatus, error?: AppErrorInfo): void {
    this.store.update((all) => {
      const entry = all[providerId]
      if (!entry) return all
      return {
        ...all,
        [providerId]: { ...entry, status, lastError: error, lastTestedAt: Date.now() }
      }
    })
  }

  meta(
    providerId: string
  ):
    | { hint: string; status: KeyStatus; lastTestedAt?: number; lastError?: AppErrorInfo }
    | undefined {
    const e = this.store.read()[providerId]
    if (!e) return undefined
    return { hint: e.hint, status: e.status, lastTestedAt: e.lastTestedAt, lastError: e.lastError }
  }

  providerIds(): string[] {
    return Object.keys(this.store.read())
  }
}
