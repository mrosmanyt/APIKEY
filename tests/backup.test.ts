import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Logger } from '../src/main/logger'
import {
  createBackup,
  decryptKeys,
  encryptKeys,
  parseBackup,
  restoreBackup,
  summarizeBackup
} from '../src/main/services/backup'
import { Storage } from '../src/main/storage'
import { fakeEncryptor, tmpDir } from './helpers/fakes'

const PASS = 'correct horse battery'
const KEY = 'sk-proj-SuperSecretValue1234567890'

function seeded() {
  const storage = new Storage(tmpDir(), fakeEncryptor)
  storage.keys.set('openai', KEY)
  storage.keys.set('anthropic', 'sk-ant-another-secret-value-xyz')
  storage.settings.update({ theme: 'dark' })
  storage.prompts.upsert({
    id: 'p1',
    title: 'T',
    content: 'C',
    mode: 'any',
    favourite: true,
    createdAt: 1,
    updatedAt: 1
  })
  storage.conversations.save({
    id: 'c1',
    title: 'x',
    mode: 'chat',
    providerId: 'openai',
    model: 'm',
    systemPrompt: '',
    temperature: 1,
    maxTokens: 10,
    messages: [],
    createdAt: 1,
    updatedAt: 1
  })
  return storage
}

describe('key encryption (scrypt + AES-256-GCM)', () => {
  it('round-trips with the right passphrase and uses fresh salt/IV each time', () => {
    const keys = { openai: KEY }
    const a = encryptKeys(keys, PASS)
    const b = encryptKeys(keys, PASS)
    expect(decryptKeys(a, PASS)).toEqual(keys)
    expect(Buffer.from(a.salt, 'base64')).toHaveLength(16)
    expect(Buffer.from(a.iv, 'base64')).toHaveLength(12)
    expect(Buffer.from(a.authTag, 'base64')).toHaveLength(16)
    expect(a.salt).not.toBe(b.salt)
    expect(a.iv).not.toBe(b.iv)
    expect(a.ciphertext).not.toBe(b.ciphertext)
    expect(JSON.stringify(a)).not.toContain(KEY)
    expect(a).toMatchObject({ kdf: 'scrypt', cipher: 'aes-256-gcm' })
  })

  it('rejects a wrong passphrase with a clear error', () => {
    const enc = encryptKeys({ openai: KEY }, PASS)
    expect(() => decryptKeys(enc, 'wrong passphrase')).toThrow(/Wrong passphrase/)
    try {
      decryptKeys(enc, 'wrong passphrase')
    } catch (e) {
      expect((e as { kind?: string }).kind).toBe('invalid_passphrase')
    }
  })

  it('detects tampering (auth tag)', () => {
    const enc = encryptKeys({ openai: KEY }, PASS)
    const ct = Buffer.from(enc.ciphertext, 'base64')
    ct[0] ^= 0xff
    expect(() => decryptKeys({ ...enc, ciphertext: ct.toString('base64') }, PASS)).toThrow(
      /Wrong passphrase/
    )
  })

  it('refuses dangerous scrypt parameters from a tampered file', () => {
    const enc = encryptKeys({ openai: KEY }, PASS)
    expect(() => decryptKeys({ ...enc, N: 2 ** 30 }, PASS)).toThrow(/invalid encryption parameters/)
  })

  it('requires a passphrase of at least 8 characters', () => {
    expect(() => encryptKeys({ a: 'b' }, 'short')).toThrow(/at least 8/)
  })
})

describe('backup files', () => {
  it('never contains plain-text keys', () => {
    const storage = seeded()
    const withoutKeys = JSON.stringify(createBackup(storage, '1.0.0', { includeKeys: false }))
    expect(withoutKeys).not.toContain(KEY)
    expect(withoutKeys).not.toContain('encryptedKeys')

    const withKeys = createBackup(storage, '1.0.0', { includeKeys: true, passphrase: PASS })
    const text = JSON.stringify(withKeys)
    expect(text).not.toContain(KEY)
    expect(text).not.toContain('sk-ant-another')
    expect(text).not.toContain(PASS)
    expect(withKeys.keys).toBeUndefined()
    expect(withKeys.encryptedKeys).toBeDefined()
    expect(withKeys.version).toBe(2)
  })

  it('refuses to include keys without a valid passphrase', () => {
    const storage = seeded()
    expect(() => createBackup(storage, '1.0.0', { includeKeys: true })).toThrow(/at least 8/)
    expect(() =>
      createBackup(storage, '1.0.0', { includeKeys: true, passphrase: '1234567' })
    ).toThrow(/at least 8/)
  })

  it('restores everything with the right passphrase', () => {
    const text = JSON.stringify(
      createBackup(seeded(), '1.0.0', { includeKeys: true, passphrase: PASS })
    )
    const parsed = parseBackup(text)
    expect(summarizeBackup(parsed)).toEqual({
      conversations: 1,
      prompts: 1,
      hasKeys: true,
      needsPassphrase: true
    })

    const target = new Storage(tmpDir(), fakeEncryptor)
    expect(restoreBackup(target, parsed, { passphrase: PASS })).toEqual({
      conversations: 1,
      prompts: 1,
      keys: 2,
      settings: true,
      automationSettingsSkipped: true,
      skippedSettings: []
    })
    expect(target.keys.get('openai')).toBe(KEY)
    expect(target.settings.get().theme).toBe('dark')
  })

  it('a wrong or missing passphrase changes nothing', () => {
    const parsed = parseBackup(
      JSON.stringify(createBackup(seeded(), '1.0.0', { includeKeys: true, passphrase: PASS }))
    )
    const target = new Storage(tmpDir(), fakeEncryptor)
    expect(() => restoreBackup(target, parsed, { passphrase: 'not the passphrase' })).toThrow(
      /Wrong passphrase/
    )
    expect(() => restoreBackup(target, parsed)).toThrow(/Enter its passphrase/)
    expect(target.conversations.list()).toHaveLength(0)
    expect(target.prompts.all()).toHaveLength(0)
    expect(target.keys.providerIds()).toEqual([])
    expect(target.settings.get().theme).toBe('system')
  })

  it('can restore everything except keys without the passphrase', () => {
    const parsed = parseBackup(
      JSON.stringify(createBackup(seeded(), '1.0.0', { includeKeys: true, passphrase: PASS }))
    )
    const target = new Storage(tmpDir(), fakeEncryptor)
    expect(restoreBackup(target, parsed, { skipKeys: true })).toEqual({
      conversations: 1,
      prompts: 1,
      keys: 0,
      settings: true,
      automationSettingsSkipped: true,
      skippedSettings: []
    })
    expect(target.keys.providerIds()).toEqual([])
  })

  it('still reads legacy v1 backups with plain keys', () => {
    const legacy = {
      ...createBackup(seeded(), '1.0.0', { includeKeys: false }),
      version: 1,
      keys: { openai: KEY }
    }
    const parsed = parseBackup(JSON.stringify(legacy))
    expect(summarizeBackup(parsed)).toMatchObject({ hasKeys: true, needsPassphrase: false })
    const target = new Storage(tmpDir(), fakeEncryptor)
    expect(restoreBackup(target, parsed).keys).toBe(1)
  })

  it('never restores Automation settings: this PC keeps its own', () => {
    const source = seeded()
    source.settings.update({
      automation: {
        ...source.settings.get().automation,
        enabled: true,
        webhookEnabled: true,
        webhookPort: 18000,
        startWithWindows: true,
        runInTray: true
      }
    })
    const parsed = parseBackup(
      JSON.stringify(createBackup(source, '1.0.0', { includeKeys: false }))
    )
    expect((parsed.settings as { automation: { enabled: boolean } }).automation.enabled).toBe(true)

    // A fresh PC: Automation is off and stays off.
    const fresh = new Storage(tmpDir(), fakeEncryptor)
    const before = structuredClone(fresh.settings.get().automation)
    const result = restoreBackup(fresh, parsed)
    expect(result.automationSettingsSkipped).toBe(true)
    expect(result.settings).toBe(true)
    const after = fresh.settings.get().automation
    expect(after).toEqual(before)
    expect(after.enabled).toBe(false)
    expect(after.webhookEnabled).toBe(false)
    expect(after.startWithWindows).toBe(false)
    expect(after.runInTray).toBe(false)
    expect(fresh.settings.get().theme).toBe('dark') // other settings are restored

    // A PC with its own Automation choices keeps them, even if the backup says otherwise.
    const mine = new Storage(tmpDir(), fakeEncryptor)
    const custom = { ...mine.settings.get().automation, enabled: true, webhookPort: 19999 }
    mine.settings.update({ automation: custom })
    const offBackup = parseBackup(
      JSON.stringify(
        createBackup(new Storage(tmpDir(), fakeEncryptor), '1.0.0', { includeKeys: false })
      )
    )
    restoreBackup(mine, offBackup)
    expect(mine.settings.get().automation).toEqual(custom)
  })

  it('validates backup settings field by field and drops unknown or invalid ones', () => {
    const backup = {
      ...createBackup(seeded(), '1.0.0', { includeKeys: false }),
      settings: {
        theme: 'neon', // invalid
        language: 'ur', // valid
        outputDir: 42, // invalid
        chat: { temperature: 99, maxTokens: 10 }, // invalid (temperature > 2)
        prices: [{ id: 'p', providerId: 'openai', model: 'gpt-4o', input: 1, output: 2 }],
        onboardingCompleted: true,
        providerConfig: {
          ollama: { baseUrl: 'http://localhost:11434' },
          'Bad Id!': { x: 'y' },
          custom: { baseUrl: 7 }
        },
        modelCache: { 'openai:chat': [{ id: 'injected' }] },
        totallyUnknown: { evil: true },
        automation: { enabled: true, webhookEnabled: true, startWithWindows: true }
      }
    }
    // A real "__proto__" key, as a hostile file would contain it (an object literal can't).
    const text = JSON.stringify(backup).replace(
      '"totallyUnknown"',
      '"__proto__":{"polluted":true},"totallyUnknown"'
    )
    expect(text).toContain('"__proto__"')
    const parsed = parseBackup(text)
    const target = new Storage(tmpDir(), fakeEncryptor)
    const before = target.settings.get()
    const result = restoreBackup(target, parsed)
    const after = target.settings.get()

    expect(after.language).toBe('ur')
    expect(after.onboardingCompleted).toBe(true)
    expect(after.prices).toEqual(backup.settings.prices)
    expect(after.providerConfig).toEqual({ ollama: { baseUrl: 'http://localhost:11434' } })
    // Invalid values were dropped, so the current ones stay.
    expect(after.theme).toBe(before.theme)
    expect(after.outputDir).toBe(before.outputDir)
    expect(after.chat).toEqual(before.chat)
    expect(after.modelCache).toEqual(before.modelCache)
    expect(after.automation).toEqual(before.automation)
    expect('totallyUnknown' in after).toBe(false)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect((after as unknown as Record<string, unknown>).polluted).toBeUndefined()

    expect(result.automationSettingsSkipped).toBe(true)
    expect(result.skippedSettings.sort()).toEqual(
      [
        '__proto__',
        'chat',
        'outputDir',
        'providerConfig.Bad Id!',
        'providerConfig.custom',
        'theme',
        'totallyUnknown'
      ].sort()
    )
  })

  it('ignores a settings block that is not an object', () => {
    const backup = { ...createBackup(seeded(), '1.0.0', { includeKeys: false }), settings: 'oops' }
    const target = new Storage(tmpDir(), fakeEncryptor)
    const before = target.settings.get()
    const result = restoreBackup(target, parseBackup(JSON.stringify(backup)))
    expect(result.settings).toBe(false)
    expect(result.skippedSettings).toEqual(['settings'])
    expect(target.settings.get()).toEqual(before)
    expect(result.conversations).toBe(1) // the rest is still restored
  })

  it('rejects files that are not backups', () => {
    expect(() => parseBackup('{"hello":1}')).toThrow(/not an AI Hub backup/)
    expect(() => parseBackup('nope')).toThrow(/invalid JSON/)
    expect(() => parseBackup(JSON.stringify({ format: 'ai-hub-backup', version: 99 }))).toThrow(
      /newer version/
    )
  })

  it('logging a failed import never leaks the passphrase or keys', () => {
    const dir = tmpDir()
    const logger = new Logger(dir)
    const parsed = parseBackup(
      JSON.stringify(createBackup(seeded(), '1.0.0', { includeKeys: true, passphrase: PASS }))
    )
    try {
      restoreBackup(new Storage(tmpDir(), fakeEncryptor), parsed, { passphrase: 'wrong-pass-123' })
    } catch (e) {
      logger.error('import failed', e)
    }
    const log = fs.readFileSync(path.join(dir, 'app.log'), 'utf8')
    expect(log).toContain('Wrong passphrase')
    expect(log).not.toContain('wrong-pass-123')
    expect(log).not.toContain(PASS)
    expect(log).not.toContain(KEY)
  })
})
