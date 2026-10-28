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
      settings: true
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
      settings: true
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
