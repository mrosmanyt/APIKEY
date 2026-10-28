import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Logger } from '../src/main/logger'
import { AiService, cleanEnhanced, ENHANCER_PROMPTS, withEstimate } from '../src/main/services/ai'
import type { AppContext } from '../src/main/services/context'
import { Storage } from '../src/main/storage'
import { ProviderError } from '../src/providers/errors'
import { ProviderRegistry } from '../src/providers/registry'
import type { ChatRequest } from '../src/shared/types'
import type { ProviderAdapter } from '../src/providers/types'
import { fakeEncryptor, tmpDir } from './helpers/fakes'

function setup(...adapters: ProviderAdapter[]) {
  const dir = tmpDir()
  const events: Array<{ channel: string; payload: unknown }> = []
  const storage = new Storage(path.join(dir, 'data'), fakeEncryptor)
  const ctx: AppContext = {
    storage,
    registry: new ProviderRegistry(adapters),
    logger: new Logger(path.join(dir, 'logs')),
    fetch: async () => new Response(''),
    defaultOutputDir: path.join(dir, 'out'),
    emit: (channel, payload) => events.push({ channel, payload })
  }
  return { ai: new AiService(ctx), storage, events }
}

const base = {
  name: 'P',
  description: '',
  keyUrl: 'https://x',
  keyPlaceholder: '',
  testKey: async () => {}
}

const chatAdapter = (
  id: string,
  reply: string,
  usage?: { inputTokens?: number; outputTokens?: number }
): ProviderAdapter => ({
  ...base,
  id,
  chat: {
    models: [{ id: 'm' }],
    stream: async (_c, _r, h) => {
      h.onDelta(reply)
      return { usage }
    }
  }
})

const req: ChatRequest = {
  providerId: 'p',
  model: 'm',
  systemPrompt: 'sys',
  messages: [{ role: 'user', content: 'x'.repeat(396) }]
}

describe('token estimation', () => {
  it('keeps provider counts and estimates otherwise', () => {
    expect(withEstimate({ inputTokens: 5, outputTokens: 6 }, req, 'abcd')).toEqual({
      inputTokens: 5,
      outputTokens: 6
    })
    expect(withEstimate(undefined, req, 'abcdefgh')).toEqual({
      inputTokens: 100,
      outputTokens: 2,
      estimated: true
    })
  })

  it('records estimated usage with the model for monthly costs', async () => {
    const { ai, storage, events } = setup(chatAdapter('p', 'hello world!'))
    ai.saveKey('p', 'key-value-123')
    await ai.startChat('r', req)
    const done = events.find((e) => (e.payload as { type: string }).type === 'done')!.payload as {
      usage: { estimated: boolean }
    }
    expect(done.usage.estimated).toBe(true)
    const month = Object.values(storage.usage.monthly())[0]
    expect(month.p.m).toMatchObject({ requests: 1, outputTokens: 3, estimated: true })
  })
})

describe('keyless providers', () => {
  it('connects without a key, refreshes models and can chat', async () => {
    const local: ProviderAdapter = {
      ...chatAdapter('local', 'hi'),
      keyOptional: true,
      listModels: async () => [{ id: 'llama3' }]
    }
    local.chat!.models = []
    const { ai, storage } = setup(local)
    const status = await ai.connectKeyless('local')
    expect(status).toMatchObject({ status: 'valid', hasKey: true })
    expect(storage.settings.get().modelCache['local:chat']).toEqual([{ id: 'llama3' }])
    expect(ai.providerContext('local').apiKey).toBe('')
  })

  it('refuses keyless connect for providers that need a key', async () => {
    const { ai } = setup(chatAdapter('p', 'x'))
    await expect(ai.connectKeyless('p')).rejects.toMatchObject({ kind: 'bad_request' })
    expect(() => ai.providerContext('p')).toThrow(/No API key/)
  })
})

describe('prompt enhancer', () => {
  it('uses a target-specific system prompt and cleans the reply', async () => {
    let seen: ChatRequest | undefined
    const adapter: ProviderAdapter = {
      ...base,
      id: 'p',
      chat: {
        models: [],
        stream: async (_c, r, h) => {
          seen = r
          h.onDelta('Here is an improved prompt: "A lighthouse at dawn, volumetric fog"')
          return { usage: { inputTokens: 10, outputTokens: 12 } }
        }
      }
    }
    const { ai, storage } = setup(adapter)
    ai.saveKey('p', 'key-value-123')
    const text = await ai.enhancePrompt({
      providerId: 'p',
      model: 'm',
      prompt: 'lighthouse',
      target: 'image'
    })
    expect(text).toBe('A lighthouse at dawn, volumetric fog')
    expect(seen!.systemPrompt).toBe(ENHANCER_PROMPTS.image)
    expect(seen!.messages).toEqual([{ role: 'user', content: 'lighthouse' }])
    expect(storage.usage.get().p.requests).toBe(1)
  })

  it('cleans common wrappers', () => {
    expect(cleanEnhanced('```\nA cat\n```')).toBe('A cat')
    expect(cleanEnhanced('Enhanced prompt: Write a poem')).toBe('Write a poem')
    expect(cleanEnhanced('“Quoted prompt”')).toBe('Quoted prompt')
    expect(cleanEnhanced('Plain text stays')).toBe('Plain text stays')
  })

  it('reports provider errors and empty replies', async () => {
    const failing: ProviderAdapter = {
      ...base,
      id: 'p',
      chat: {
        models: [],
        stream: async () => {
          throw new ProviderError({ kind: 'quota', message: 'No credit' })
        }
      }
    }
    const { ai } = setup(failing)
    ai.saveKey('p', 'key-value-123')
    await expect(
      ai.enhancePrompt({ providerId: 'p', model: 'm', prompt: 'x', target: 'chat' })
    ).rejects.toMatchObject({ kind: 'quota' })
    const empty = setup(chatAdapter('e', '   '))
    empty.ai.saveKey('e', 'key-value-123')
    await expect(
      empty.ai.enhancePrompt({ providerId: 'e', model: 'm', prompt: 'x', target: 'video' })
    ).rejects.toThrow(/empty prompt/)
  })
})

describe('image tools', () => {
  const imageAdapter: ProviderAdapter = {
    ...base,
    id: 'img',
    image: {
      models: [
        {
          id: 'm',
          sizes: ['1:1'],
          maxCount: 2,
          supportsNegativePrompt: false,
          supportsReference: true
        }
      ],
      generate: async (_c, r) => [
        {
          data: Buffer.from(r.reference ? `ref:${r.reference.data}:${r.strength}` : 'gen'),
          mime: 'image/png'
        }
      ],
      upscale: async (_c, i) => ({ data: Buffer.from(`up:${i.data}`), mime: 'image/png' }),
      vary: async (_c, i, n) =>
        Array.from({ length: n }, (_, k) => ({
          data: Buffer.from(`v${k}:${i.data}`),
          mime: 'image/png'
        })),
      variationModel: 'vm'
    }
  }

  it('generates from a gallery reference, upscales and creates variations', async () => {
    const { ai, storage } = setup(imageAdapter)
    ai.saveKey('img', 'key-value-123')
    const [first] = await ai.generateImages({
      providerId: 'img',
      model: 'm',
      prompt: 'p',
      count: 1
    })
    expect(first.operation).toBe('generate')

    const [fromRef] = await ai.generateImages({
      providerId: 'img',
      model: 'm',
      prompt: 'p2',
      count: 1,
      reference: { imageId: first.id },
      strength: 0.3
    })
    expect(fs.readFileSync(fromRef.filePath, 'utf8')).toBe('ref:gen:0.3')
    expect(fromRef).toMatchObject({ operation: 'reference', sourceImageId: first.id })

    const [uploaded] = await ai.generateImages({
      providerId: 'img',
      model: 'm',
      prompt: 'p3',
      count: 1,
      reference: { base64: Buffer.from('upl').toString('base64'), mime: 'image/png' }
    })
    expect(fs.readFileSync(uploaded.filePath, 'utf8')).toBe('ref:upl:undefined')

    const up = await ai.upscaleImage(first.id, 'img')
    expect(fs.readFileSync(up.filePath, 'utf8')).toBe('up:gen')
    expect(up).toMatchObject({ operation: 'upscale', sourceImageId: first.id, prompt: 'p' })

    const vars = await ai.imageVariations(first.id, 'img', 2)
    expect(vars.map((v) => fs.readFileSync(v.filePath, 'utf8'))).toEqual(['v0:gen', 'v1:gen'])
    expect(vars[0]).toMatchObject({ operation: 'variation', model: 'vm' })
    expect(storage.images.all()).toHaveLength(6)
  })

  it('explains unsupported tools and missing references', async () => {
    const plain: ProviderAdapter = {
      ...base,
      id: 'plain',
      image: { models: [], generate: async () => [] }
    }
    const { ai } = setup(imageAdapter, plain)
    ai.saveKey('img', 'key-value-123')
    ai.saveKey('plain', 'key-value-123')
    const [img] = await ai.generateImages({ providerId: 'img', model: 'm', prompt: 'p', count: 1 })
    await expect(ai.upscaleImage(img.id, 'plain')).rejects.toMatchObject({ kind: 'unsupported' })
    await expect(ai.imageVariations(img.id, 'plain', 1)).rejects.toMatchObject({
      kind: 'unsupported'
    })
    await expect(
      ai.generateImages({
        providerId: 'img',
        model: 'm',
        prompt: 'p',
        count: 1,
        reference: { imageId: 'img_gone' }
      })
    ).rejects.toThrow(/no longer exists/)
  })
})
