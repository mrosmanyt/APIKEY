import { describe, expect, it } from 'vitest'
import { deepseekAdapter } from '../src/providers/deepseek'
import { classifyHttpError } from '../src/providers/errors'
import { geminiAdapter } from '../src/providers/gemini'
import { groqAdapter } from '../src/providers/groq'
import { mistralAdapter } from '../src/providers/mistral'
import { ollamaAdapter, ollamaBase } from '../src/providers/ollama'
import { buildOpenAIEditForm, openaiAdapter } from '../src/providers/openai'
import { mapOpenRouterModel, openrouterAdapter } from '../src/providers/openrouter'
import { buildStabilityForm, stabilityAdapter, stabilityEndpoint } from '../src/providers/stability'
import type { ChatRequest } from '../src/shared/types'
import { ctx, json, mockFetch, sse } from './helpers/fakes'

const req: ChatRequest = {
  providerId: 'x',
  model: 'm',
  messages: [{ role: 'user', content: 'hi' }],
  maxTokens: 50,
  temperature: 0.3
}
const okStream = () => sse([{ data: { choices: [{ delta: { content: 'ok' } }] } }, '[DONE]'])
const img = { data: Buffer.from('png-bytes'), mime: 'image/png' }

async function chat(
  adapter: typeof deepseekAdapter,
  r: ChatRequest,
  c = ctx(async () => okStream())
) {
  let text = ''
  const result = await adapter.chat!.stream(c, r, { onDelta: (t) => (text += t) })
  return { text, result }
}

describe('OpenAI-compatible providers', () => {
  it.each([
    [openrouterAdapter, 'https://openrouter.ai/api/v1/chat/completions'],
    [groqAdapter, 'https://api.groq.com/openai/v1/chat/completions'],
    [deepseekAdapter, 'https://api.deepseek.com/chat/completions'],
    [mistralAdapter, 'https://api.mistral.ai/v1/chat/completions']
  ])('%#: streams from the right endpoint with bearer auth', async (adapter, url) => {
    const { fetch, requests } = mockFetch(okStream())
    const { text } = await chat(adapter, { ...req, model: adapter.chat!.models[0].id }, ctx(fetch))
    expect(text).toBe('ok')
    expect(requests[0].url).toBe(url)
    expect(requests[0].headers.authorization).toBe('Bearer test-key-123456')
    expect(requests[0].body).toMatchObject({ stream: true, max_tokens: 50 })
  })

  it('only sends stream_options to servers known to accept it', async () => {
    for (const [adapter, expected] of [
      [deepseekAdapter, true],
      [openrouterAdapter, true],
      [groqAdapter, false],
      [mistralAdapter, false]
    ] as const) {
      const { fetch, requests } = mockFetch(okStream())
      await chat(adapter, req, ctx(fetch))
      expect('stream_options' in (requests[0].body as object), adapter.id).toBe(expected)
    }
  })

  it('OpenRouter sends the app title and tests the key on /auth/key', async () => {
    const { fetch, requests } = mockFetch(json({ data: { label: 'k' } }))
    await openrouterAdapter.testKey(ctx(fetch))
    expect(requests[0].url).toBe('https://openrouter.ai/api/v1/auth/key')
    expect(requests[0].headers['x-title']).toBe('AI Hub')
  })

  it('OpenRouter converts per-token prices to per-1M and reads context/vision', async () => {
    expect(
      mapOpenRouterModel({
        id: 'a/b',
        name: 'B',
        context_length: 8000,
        pricing: { prompt: '0.000003', completion: '0.000015' },
        architecture: { input_modalities: ['text', 'image'] }
      })
    ).toEqual({
      id: 'a/b',
      name: 'B',
      contextWindow: 8000,
      vision: true,
      pricing: { input: 3, output: 15 }
    })
    expect(
      mapOpenRouterModel({ id: 'free', pricing: { prompt: '-1', completion: '0' } }).pricing
    ).toBeUndefined()
    const { fetch } = mockFetch(
      json({
        data: [
          { id: 'z/z', pricing: { prompt: '0', completion: '0' } },
          { id: 'img/gen', architecture: { output_modalities: ['image'] } }
        ]
      })
    )
    expect((await openrouterAdapter.listModels!(ctx(fetch), 'chat')).map((m) => m.id)).toEqual([
      'z/z'
    ])
  })

  it('Groq: reads usage from x_groq and transcribes with Whisper', async () => {
    const { fetch } = mockFetch(
      sse([
        { data: { choices: [{ delta: { content: 'hi' } }] } },
        {
          data: {
            choices: [{ delta: {}, finish_reason: 'stop' }],
            x_groq: { usage: { prompt_tokens: 9, completion_tokens: 3 } }
          }
        },
        '[DONE]'
      ])
    )
    const { result } = await chat(groqAdapter, req, ctx(fetch))
    expect(result).toMatchObject({ usage: { inputTokens: 9, outputTokens: 3 } })

    const { fetch: f2, requests } = mockFetch(json({ text: 'transcribed' }))
    const out = await groqAdapter.stt!.transcribe(ctx(f2), {
      model: 'whisper-large-v3-turbo',
      audio: Buffer.from('a'),
      mime: 'audio/mpeg',
      fileName: 'a.mp3'
    })
    expect(out.text).toBe('transcribed')
    expect(requests[0].url).toBe('https://api.groq.com/openai/v1/audio/transcriptions')
  })

  it('Groq: separates Whisper models from chat models', async () => {
    const list = json({
      data: [{ id: 'llama-3.3-70b-versatile' }, { id: 'whisper-large-v3' }, { id: 'playai-tts' }]
    })
    const { fetch } = mockFetch(list, list)
    expect((await groqAdapter.listModels!(ctx(fetch), 'chat')).map((m) => m.id)).toEqual([
      'llama-3.3-70b-versatile'
    ])
    expect((await groqAdapter.listModels!(ctx(fetch), 'stt')).map((m) => m.id)).toEqual([
      'whisper-large-v3'
    ])
  })

  it('Mistral: filters non-chat models', async () => {
    const { fetch } = mockFetch(
      json({
        data: [
          { id: 'mistral-small-latest' },
          { id: 'mistral-embed' },
          { id: 'mistral-moderation-latest' }
        ]
      })
    )
    expect((await mistralAdapter.listModels!(ctx(fetch), 'chat')).map((m) => m.id)).toEqual([
      'mistral-small-latest'
    ])
  })
})

describe('Ollama (keyless, local)', () => {
  it('uses the default URL, sends no Authorization header and reads /api/tags', async () => {
    const { fetch, requests } = mockFetch(
      json({
        models: [
          { name: 'llama3.2:latest', model: 'llama3.2:latest' },
          { name: 'llava:7b', details: { families: ['llama', 'clip'] } }
        ]
      })
    )
    const models = await ollamaAdapter.listModels!(ctx(fetch, { apiKey: '' }), 'chat')
    expect(requests[0].url).toBe('http://localhost:11434/api/tags')
    expect(models).toEqual([
      { id: 'llama3.2:latest', name: 'llama3.2:latest', vision: undefined },
      { id: 'llava:7b', name: 'llava:7b', vision: true }
    ])
    expect(ollamaAdapter.keyOptional).toBe(true)
  })

  it('chats via the OpenAI-compatible /v1 endpoint without auth', async () => {
    const { fetch, requests } = mockFetch(okStream())
    await chat(
      ollamaAdapter,
      req,
      ctx(fetch, { apiKey: '', config: { baseUrl: 'http://192.168.1.5:11434/v1/' } })
    )
    expect(requests[0].url).toBe('http://192.168.1.5:11434/v1/chat/completions')
    expect(requests[0].headers.authorization).toBeUndefined()
  })

  it('explains when Ollama is not running', async () => {
    const fetch = async () => {
      throw new TypeError('fetch failed')
    }
    await expect(ollamaAdapter.testKey(ctx(fetch, { apiKey: '' }))).rejects.toMatchObject({
      kind: 'network',
      message: expect.stringContaining('Is it installed and running')
    })
  })

  it('validates the URL', () => {
    expect(() =>
      ollamaBase(ctx(async () => json({}), { config: { baseUrl: 'localhost' } }))
    ).toThrow(/valid Ollama URL/)
  })
})

describe('Stability AI', () => {
  it('maps models to v2beta endpoints', () => {
    expect(stabilityEndpoint('stable-image-ultra')).toEqual({
      path: '/v2beta/stable-image/generate/ultra'
    })
    expect(stabilityEndpoint('stable-image-core')).toEqual({
      path: '/v2beta/stable-image/generate/core'
    })
    expect(stabilityEndpoint('sd3.5-large')).toEqual({
      path: '/v2beta/stable-image/generate/sd3',
      modelField: 'sd3.5-large'
    })
  })

  it('builds text-to-image and image-to-image forms', () => {
    const t2i = Object.fromEntries(
      buildStabilityForm({
        model: 'sd3.5-large',
        prompt: 'cat',
        negativePrompt: 'blur',
        size: '16:9'
      }).entries()
    )
    expect(t2i).toMatchObject({
      prompt: 'cat',
      negative_prompt: 'blur',
      aspect_ratio: '16:9',
      model: 'sd3.5-large',
      output_format: 'png'
    })
    const i2i = buildStabilityForm({
      model: 'sd3.5-large',
      prompt: 'cat',
      size: '16:9',
      reference: img,
      strength: 0.4
    })
    expect(i2i.get('mode')).toBe('image-to-image')
    expect(i2i.get('strength')).toBe('0.4')
    expect(i2i.get('aspect_ratio')).toBeNull()
    expect(i2i.get('image')).toBeInstanceOf(Blob)
  })

  it('generates one request per image and returns bytes', async () => {
    const { fetch, requests } = mockFetch(
      () => new Response(Buffer.from('PNG'), { headers: { 'content-type': 'image/png' } })
    )
    const out = await stabilityAdapter.image!.generate(ctx(fetch), {
      model: 'stable-image-core',
      prompt: 'p',
      count: 2
    })
    expect(out).toHaveLength(2)
    expect(out[0].data.toString()).toBe('PNG')
    expect(requests[0].url).toBe('https://api.stability.ai/v2beta/stable-image/generate/core')
    expect(requests[0].headers.accept).toBe('image/*')
  })

  it('treats a CONTENT_FILTERED finish reason as a content-policy refusal', async () => {
    const { fetch } = mockFetch(
      new Response(Buffer.from('blurred'), {
        headers: { 'content-type': 'image/png', 'finish-reason': 'CONTENT_FILTERED' }
      })
    )
    await expect(
      stabilityAdapter.image!.generate(ctx(fetch), {
        model: 'stable-image-core',
        prompt: 'p',
        count: 1
      })
    ).rejects.toMatchObject({ kind: 'content_policy' })
  })

  it('maps moderation errors (HTTP 403) to content_policy, not invalid key', () => {
    const err = classifyHttpError(
      403,
      JSON.stringify({
        name: 'content_moderation',
        errors: ['Your request was flagged by our content moderation system.']
      }),
      'stability'
    )
    expect(err.kind).toBe('content_policy')
    expect(err.message).toContain('flagged')
    expect(
      classifyHttpError(
        401,
        JSON.stringify({ name: 'unauthorized', errors: ['authorization: invalid'] })
      ).kind
    ).toBe('invalid_key')
  })

  it('rejects references for models without image-to-image', async () => {
    const { fetch } = mockFetch(json({}))
    await expect(
      stabilityAdapter.image!.generate(ctx(fetch), {
        model: 'stable-image-core',
        prompt: 'p',
        count: 1,
        reference: img
      })
    ).rejects.toMatchObject({ kind: 'unsupported' })
  })

  it('upscales (beta)', async () => {
    const { fetch, requests } = mockFetch(
      new Response(Buffer.from('BIG'), { headers: { 'content-type': 'image/png' } })
    )
    const out = await stabilityAdapter.image!.upscale!(ctx(fetch), img)
    expect(out.data.toString()).toBe('BIG')
    expect(requests[0].url).toBe('https://api.stability.ai/v2beta/stable-image/upscale/fast')
    expect(stabilityAdapter.image!.upscaleBeta).toBe(true)
  })

  it('tests the key on /v1/user/account', async () => {
    const { fetch, requests } = mockFetch(json({ id: 'u' }))
    await stabilityAdapter.testKey(ctx(fetch))
    expect(requests[0].url).toBe('https://api.stability.ai/v1/user/account')
  })
})

describe('image tools on existing providers', () => {
  it('OpenAI: reference images use /images/edits with multipart', async () => {
    const form = buildOpenAIEditForm({
      model: 'gpt-image-1',
      prompt: 'make it blue',
      count: 2,
      size: '1024x1024',
      reference: img
    })
    expect(form.get('model')).toBe('gpt-image-1')
    expect(form.get('n')).toBe('2')
    expect(form.get('image')).toBeInstanceOf(Blob)
    const { fetch, requests } = mockFetch(
      json({ data: [{ b64_json: Buffer.from('x').toString('base64') }] })
    )
    await openaiAdapter.image!.generate(ctx(fetch), {
      model: 'gpt-image-1',
      prompt: 'p',
      count: 1,
      reference: img
    })
    expect(requests[0].url).toBe('https://api.openai.com/v1/images/edits')
  })

  it('OpenAI: DALL·E 3 cannot take a reference', async () => {
    const { fetch } = mockFetch(json({}))
    await expect(
      openaiAdapter.image!.generate(ctx(fetch), {
        model: 'dall-e-3',
        prompt: 'p',
        count: 1,
        reference: img
      })
    ).rejects.toMatchObject({ kind: 'unsupported' })
  })

  it('OpenAI: variations via dall-e-2', async () => {
    const { fetch, requests } = mockFetch(
      json({ data: [{ b64_json: 'eA==' }, { b64_json: 'eQ==' }] })
    )
    const out = await openaiAdapter.image!.vary!(ctx(fetch), img, 2)
    expect(out).toHaveLength(2)
    expect(requests[0].url).toBe('https://api.openai.com/v1/images/variations')
    expect(requests[0].body).toMatchObject({
      model: 'dall-e-2',
      n: '2',
      response_format: 'b64_json'
    })
  })

  it('Gemini: reference image is sent as inline data before the prompt', async () => {
    const { fetch, requests } = mockFetch(
      json({
        candidates: [
          {
            content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'eA==' } }] },
            finishReason: 'STOP'
          }
        ]
      })
    )
    await geminiAdapter.image!.generate(ctx(fetch), {
      model: 'gemini-2.5-flash-image',
      prompt: 'p',
      count: 1,
      reference: img
    })
    const parts = (requests[0].body as { contents: Array<{ parts: unknown[] }> }).contents[0].parts
    expect(parts[0]).toEqual({
      inline_data: { mime_type: 'image/png', data: img.data.toString('base64') }
    })
    expect(parts[1]).toEqual({ text: 'p' })
  })

  it('Gemini: Imagen rejects references', async () => {
    const { fetch } = mockFetch(json({}))
    await expect(
      geminiAdapter.image!.generate(ctx(fetch), {
        model: 'imagen-4.0-generate-001',
        prompt: 'p',
        count: 1,
        reference: img
      })
    ).rejects.toMatchObject({ kind: 'unsupported' })
  })
})
