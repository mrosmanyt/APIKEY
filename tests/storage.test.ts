import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Storage } from '../src/main/storage'
import { conversationToJson, conversationToMarkdown } from '../src/main/storage/conversations'
import { CollectionStore, JsonStore } from '../src/main/storage/jsonStore'
import { KeyEncryptionUnavailableError, KeyStore } from '../src/main/storage/keyStore'
import { redact } from '../src/shared/redact'
import type { Conversation } from '../src/shared/types'
import { fakeEncryptor, tmpDir } from './helpers/fakes'

function conv(id: string, title: string, text: string): Conversation {
  return {
    id,
    title,
    mode: 'chat',
    providerId: 'openai',
    model: 'gpt-4o',
    systemPrompt: '',
    temperature: 0.7,
    maxTokens: 1000,
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: text,
        createdAt: 1,
        attachments: [
          {
            id: 'a',
            name: 'pic.png',
            mime: 'image/png',
            kind: 'image',
            size: 3,
            dataBase64: 'AAAA'
          }
        ]
      },
      { id: 'm2', role: 'assistant', content: 'Sure! Here you go.', createdAt: 2, model: 'gpt-4o' }
    ],
    createdAt: 1,
    updatedAt: 1
  }
}

describe('JsonStore', () => {
  it('returns defaults, persists and reloads', () => {
    const file = path.join(tmpDir(), 'a.json')
    const s = new JsonStore(file, () => ({ n: 1 }))
    expect(s.read()).toEqual({ n: 1 })
    s.write({ n: 2 })
    expect(new JsonStore(file, () => ({ n: 0 })).read()).toEqual({ n: 2 })
  })

  it('recovers from a corrupt file and keeps a copy', () => {
    const dir = tmpDir()
    const file = path.join(dir, 'b.json')
    fs.writeFileSync(file, '{ not json')
    expect(new JsonStore(file, () => ({ ok: true })).read()).toEqual({ ok: true })
    expect(fs.readdirSync(dir).some((f) => f.includes('.corrupt-'))).toBe(true)
  })
})

describe('CollectionStore', () => {
  it('upserts, patches and removes records', () => {
    const c = new CollectionStore<{ id: string; v: number }>(path.join(tmpDir(), 'c.json'))
    c.upsert({ id: 'a', v: 1 })
    c.upsert({ id: 'b', v: 2 })
    c.upsert({ id: 'a', v: 3 })
    expect(c.all()).toHaveLength(2)
    expect(c.get('a')!.v).toBe(3)
    c.patch('b', { v: 5 })
    expect(c.get('b')!.v).toBe(5)
    expect(c.remove('a')!.id).toBe('a')
    expect(c.all().map((r) => r.id)).toEqual(['b'])
  })
})

describe('KeyStore', () => {
  it('stores keys encrypted, never in plain text', () => {
    const file = path.join(tmpDir(), 'keys.json')
    const ks = new KeyStore(file, fakeEncryptor)
    ks.set('openai', '  sk-plaintextsecret-1234  ')
    expect(fs.readFileSync(file, 'utf8')).not.toContain('sk-plaintextsecret-1234')
    expect(ks.get('openai')).toBe('sk-plaintextsecret-1234')
    expect(ks.meta('openai')).toMatchObject({ hint: '1234', status: 'untested' })
    // saving a key registers it for redaction
    expect(redact('oops sk-plaintextsecret-1234')).not.toContain('plaintextsecret')
  })

  it('tracks status and deletes keys', () => {
    const ks = new KeyStore(path.join(tmpDir(), 'keys.json'), fakeEncryptor)
    ks.set('xai', 'xai-key-value')
    ks.setStatus('xai', 'valid')
    expect(ks.meta('xai')!.status).toBe('valid')
    expect(ks.providerIds()).toEqual(['xai'])
    ks.delete('xai')
    expect(ks.has('xai')).toBe(false)
    expect(ks.get('xai')).toBeUndefined()
  })

  it('refuses to save when OS encryption is unavailable', () => {
    const ks = new KeyStore(path.join(tmpDir(), 'keys.json'), {
      ...fakeEncryptor,
      isAvailable: () => false
    })
    expect(() => ks.set('openai', 'sk-x')).toThrow(KeyEncryptionUnavailableError)
  })
})

describe('ConversationStore', () => {
  it('saves, lists, searches, renames and deletes', () => {
    const storage = new Storage(tmpDir(), fakeEncryptor)
    const cs = storage.conversations
    cs.save(conv('c1', 'Pasta recipe', 'How do I cook carbonara?'))
    cs.save(conv('c2', 'Trip', 'Plan a weekend in Lisbon'))
    expect(cs.list()).toHaveLength(2)
    expect(cs.search('lisbon').map((c) => c.id)).toEqual(['c2'])
    expect(cs.search('lisbon')[0].snippet).toContain('Lisbon')
    expect(cs.search('pasta').map((c) => c.id)).toEqual(['c1'])
    cs.rename('c1', 'Carbonara')
    expect(cs.get('c1')!.title).toBe('Carbonara')
    cs.delete('c2')
    expect(cs.list().map((c) => c.id)).toEqual(['c1'])
    // persisted on disk
    const again = new Storage(storage.dataDir, fakeEncryptor)
    expect(again.conversations.get('c1')!.title).toBe('Carbonara')
  })

  it('rejects unsafe ids (path traversal)', () => {
    const storage = new Storage(tmpDir(), fakeEncryptor)
    expect(() => storage.conversations.save(conv('../evil', 't', 'x'))).toThrow()
  })

  it('exports markdown and slim JSON', () => {
    const c = conv('c1', 'Pasta', 'Hello there')
    const md = conversationToMarkdown(c)
    expect(md).toContain('# Pasta')
    expect(md).toContain('## You')
    expect(md).toContain('Hello there')
    expect(md).toContain('pic.png')
    const js = JSON.parse(conversationToJson(c))
    expect(js.messages[0].attachments[0].dataBase64).toBeUndefined()
  })
})

describe('Settings & usage', () => {
  it('merges settings with defaults and records usage', () => {
    const storage = new Storage(tmpDir(), fakeEncryptor)
    expect(storage.settings.get().theme).toBe('system')
    storage.settings.update({ theme: 'dark' })
    expect(storage.settings.get().theme).toBe('dark')
    expect(storage.settings.get().chat.maxTokens).toBeGreaterThan(0)

    storage.usage.record('openai', 'chat', { usage: { inputTokens: 10, outputTokens: 20 } })
    storage.usage.record('openai', 'chat', { usage: { inputTokens: 5 }, error: false })
    storage.usage.record('openai', 'image', { images: 2 })
    storage.usage.record('openai', 'chat', { error: true })
    const u = storage.usage.get().openai
    expect(u).toMatchObject({
      requests: 4,
      errors: 1,
      inputTokens: 15,
      outputTokens: 20,
      images: 2
    })
    storage.usage.reset()
    expect(storage.usage.get()).toEqual({})
  })
})
