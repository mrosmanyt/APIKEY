import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Logger } from '../src/main/logger'
import { AiService } from '../src/main/services/ai'
import type { AppContext } from '../src/main/services/context'
import { VideoService } from '../src/main/services/video'
import { Storage } from '../src/main/storage'
import { ProviderError } from '../src/providers/errors'
import { ProviderRegistry } from '../src/providers/registry'
import type { ProviderAdapter } from '../src/providers/types'
import { fakeEncryptor, tmpDir } from './helpers/fakes'

function setup(adapter: ProviderAdapter) {
  const dir = tmpDir()
  const events: Array<{ channel: string; payload: unknown }> = []
  const storage = new Storage(path.join(dir, 'data'), fakeEncryptor)
  const ctx: AppContext = {
    storage,
    registry: new ProviderRegistry([adapter]),
    logger: new Logger(path.join(dir, 'logs')),
    fetch: async () => new Response(''),
    defaultOutputDir: path.join(dir, 'out'),
    emit: (channel, payload) => events.push({ channel, payload })
  }
  const ai = new AiService(ctx)
  return { ctx, ai, storage, events, dir }
}

const base: ProviderAdapter = {
  id: 'fake',
  name: 'Fake',
  description: '',
  keyUrl: 'https://example.com',
  keyPlaceholder: '',
  testKey: async (c) => {
    if (c.apiKey !== 'good-key-value')
      throw new ProviderError({ kind: 'invalid_key', message: 'bad key good-key-value?' })
  }
}

describe('AiService', () => {
  it('requires a key and validates capabilities', async () => {
    const { ai } = setup(base)
    await expect(
      ai.generateImages({ providerId: 'fake', model: 'm', prompt: 'p', count: 1 })
    ).rejects.toMatchObject({ kind: 'unsupported' })
    expect(() => ai.providerContext('fake')).toThrow(/No API key/)
  })

  it('tests keys and stores status', async () => {
    const { ai } = setup(base)
    ai.saveKey('fake', 'wrong-key-value')
    expect((await ai.testKey('fake')).status).toBe('invalid')
    ai.saveKey('fake', 'good-key-value')
    const s = await ai.testKey('fake')
    expect(s).toMatchObject({ status: 'valid', hasKey: true, keyHint: 'alue' })
    expect(JSON.stringify(ai.statuses())).not.toContain('good-key-value')
  })

  it('streams chat events and records usage', async () => {
    const { ai, events, storage } = setup({
      ...base,
      chat: {
        models: [],
        stream: async (_c, _r, h) => {
          h.onDelta('a')
          h.onDelta('b')
          return { usage: { inputTokens: 3, outputTokens: 4 } }
        }
      }
    })
    ai.saveKey('fake', 'good-key-value')
    await ai.startChat('r1', {
      providerId: 'fake',
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }]
    })
    expect(events.map((e) => (e.payload as { type: string }).type)).toEqual([
      'delta',
      'delta',
      'done'
    ])
    expect(storage.usage.get().fake).toMatchObject({ requests: 1, inputTokens: 3, outputTokens: 4 })
  })

  it('emits redacted errors for failed chats', async () => {
    const { ai, events, ctx } = setup({
      ...base,
      chat: {
        models: [],
        stream: async () => {
          throw new ProviderError({
            kind: 'invalid_key',
            message: 'Incorrect API key provided: good-key-value'
          })
        }
      }
    })
    ai.saveKey('fake', 'good-key-value')
    await ai.startChat('r1', {
      providerId: 'fake',
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }]
    })
    const ev = events[0].payload as { type: string; error: { kind: string; message: string } }
    expect(ev.type).toBe('error')
    expect(ev.error.kind).toBe('invalid_key')
    expect(ev.error.message).not.toContain('good-key-value')
    expect(fs.readFileSync(ctx.logger.file, 'utf8')).not.toContain('good-key-value')
    expect(ctx.storage.keys.meta('fake')!.status).toBe('invalid')
  })

  it('saves generated images to the output folder with metadata', async () => {
    const { ai, storage, dir } = setup({
      ...base,
      image: { models: [], generate: async () => [{ data: Buffer.from('png'), mime: 'image/png' }] }
    })
    ai.saveKey('fake', 'good-key-value')
    const [img] = await ai.generateImages({
      providerId: 'fake',
      model: 'm',
      prompt: 'a cat',
      count: 1
    })
    expect(img.filePath.startsWith(path.join(dir, 'out', 'images'))).toBe(true)
    expect(fs.readFileSync(img.filePath, 'utf8')).toBe('png')
    expect(JSON.parse(fs.readFileSync(`${img.filePath}.json`, 'utf8')).prompt).toBe('a cat')
    expect(storage.images.all()).toHaveLength(1)
    expect(storage.usage.get().fake.images).toBe(1)
  })
})

describe('VideoService', () => {
  it('runs the submit → poll → download flow and emits updates', async () => {
    let polls = 0
    const { ai, events, storage } = setup({
      ...base,
      video: {
        models: [],
        submit: async () => ({ jobId: 'p1' }),
        poll: async () =>
          ++polls < 2
            ? { status: 'running', progress: 50 }
            : { status: 'completed', resultRef: 'ref' },
        download: async (_c, id, ref) => ({
          data: Buffer.from(`video-${id}-${ref}`),
          mime: 'video/mp4'
        })
      }
    })
    ai.saveKey('fake', 'good-key-value')
    const video = new VideoService(ai['app'], ai, 60_000)
    const job = await video.submit({ providerId: 'fake', model: 'm', prompt: 'p' })
    expect(job.status).toBe('queued')
    expect((await video.pollOnce(job.id))!.status).toBe('running')
    const done = await video.pollOnce(job.id)
    expect(done!.status).toBe('completed')
    expect(fs.readFileSync(done!.filePath!, 'utf8')).toBe('video-p1-ref')
    expect(events.filter((e) => e.channel === 'video:update').length).toBeGreaterThanOrEqual(2)
    expect(storage.usage.get().fake.videoJobs).toBe(1)
    video.stopAll()
  })

  it('marks provider failures and supports cancel/delete', async () => {
    const { ai } = setup({
      ...base,
      video: {
        models: [],
        submit: async () => ({ jobId: 'p1' }),
        poll: async () => ({ status: 'failed', error: 'nope' }),
        download: async () => ({ data: Buffer.alloc(0), mime: 'video/mp4' })
      }
    })
    ai.saveKey('fake', 'good-key-value')
    const video = new VideoService(ai['app'], ai, 60_000)
    const job = await video.submit({ providerId: 'fake', model: 'm', prompt: 'p' })
    const failed = await video.pollOnce(job.id)
    expect(failed).toMatchObject({ status: 'failed', error: { message: 'nope' } })
    const job2 = await video.submit({ providerId: 'fake', model: 'm', prompt: 'p2' })
    expect(video.cancel(job2.id)!.status).toBe('cancelled')
    video.delete(job2.id)
    expect(video.list().map((j) => j.id)).toEqual([job.id])
    video.stopAll()
  })

  it('keeps polling through transient network errors', async () => {
    const { ai } = setup({
      ...base,
      video: {
        models: [],
        submit: async () => ({ jobId: 'p1' }),
        poll: async () => {
          throw new TypeError('fetch failed')
        },
        download: async () => ({ data: Buffer.alloc(0), mime: 'video/mp4' })
      }
    })
    ai.saveKey('fake', 'good-key-value')
    const video = new VideoService(ai['app'], ai, 60_000)
    const job = await video.submit({ providerId: 'fake', model: 'm', prompt: 'p' })
    const after = await video.pollOnce(job.id)
    expect(after!.status).toBe('queued')
    expect(after!.error?.kind).toBe('network')
    video.stopAll()
  })
})
