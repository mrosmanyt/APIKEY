import { describe, expect, it } from 'vitest'
import { anthropicAdapter, buildAnthropicBody } from '../src/providers/anthropic'
import { customAdapter } from '../src/providers/custom'
import { buildGeminiChatBody, geminiAdapter } from '../src/providers/gemini'
import {
  filterOpenAIModels,
  openaiAdapter,
  openaiSupportsTemperature
} from '../src/providers/openai'
import { buildOpenAIChatBody, buildOpenAIMessages } from '../src/providers/shared/openai-compatible'
import { xaiAdapter } from '../src/providers/xai'
import type { ChatRequest } from '../src/shared/types'
import { ctx, json, mockFetch, sse } from './helpers/fakes'

const img = {
  id: 'a1',
  name: 'cat.png',
  mime: 'image/png',
  kind: 'image' as const,
  size: 4,
  dataBase64: 'iVBORw=='
}
const txt = {
  id: 'a2',
  name: 'notes.md',
  mime: 'text/markdown',
  kind: 'text' as const,
  size: 5,
  text: '# hi'
}

const req: ChatRequest = {
  providerId: 'x',
  model: 'gpt-4o',
  systemPrompt: 'Be brief',
  temperature: 0.5,
  maxTokens: 100,
  messages: [
    { role: 'user', content: 'Look', attachments: [img, txt] },
    { role: 'assistant', content: 'A cat' },
    { role: 'user', content: 'Thanks' }
  ]
}

async function collect(stream: (onDelta: (t: string) => void) => Promise<unknown>) {
  let text = ''
  const result = await stream((t) => (text += t))
  return { text, result }
}

describe('OpenAI chat', () => {
  it('builds messages with system prompt, vision parts and inlined text files', () => {
    const msgs = buildOpenAIMessages(req)
    expect(msgs[0]).toEqual({ role: 'system', content: 'Be brief' })
    const parts = msgs[1].content as Array<Record<string, unknown>>
    expect(parts[0]).toMatchObject({ type: 'text' })
    expect((parts[0] as { text: string }).text).toContain('--- File: notes.md ---')
    expect(parts[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,iVBORw==' }
    })
    expect(msgs[2]).toEqual({ role: 'assistant', content: 'A cat' })
  })

  it('handles reasoning-model parameter rules', () => {
    expect(openaiSupportsTemperature('gpt-4o')).toBe(true)
    expect(openaiSupportsTemperature('o4-mini')).toBe(false)
    expect(openaiSupportsTemperature('gpt-5-mini')).toBe(false)
    const body = buildOpenAIChatBody(
      { ...req, model: 'gpt-5' },
      {
        providerId: 'openai',
        baseUrl: '',
        useMaxCompletionTokens: true,
        supportsTemperature: openaiSupportsTemperature
      }
    )
    expect(body.temperature).toBeUndefined()
    expect(body.max_completion_tokens).toBe(100)
    expect(body.max_tokens).toBeUndefined()
  })

  it('streams deltas, usage and sends bearer auth', async () => {
    const { fetch, requests } = mockFetch(
      sse([
        { data: { choices: [{ delta: { content: 'Hel' } }] } },
        { data: { choices: [{ delta: { content: 'lo' }, finish_reason: 'stop' }] } },
        { data: { choices: [], usage: { prompt_tokens: 7, completion_tokens: 2 } } },
        '[DONE]'
      ])
    )
    const { text, result } = await collect((onDelta) =>
      openaiAdapter.chat!.stream(ctx(fetch), req, { onDelta })
    )
    expect(text).toBe('Hello')
    expect(result).toEqual({ finishReason: 'stop', usage: { inputTokens: 7, outputTokens: 2 } })
    expect(requests[0].url).toBe('https://api.openai.com/v1/chat/completions')
    expect(requests[0].headers.authorization).toBe('Bearer test-key-123456')
    expect(requests[0].body).toMatchObject({
      model: 'gpt-4o',
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.5
    })
  })

  it('maps a refusal-only stream to content_policy', async () => {
    const { fetch } = mockFetch(
      sse([
        {
          data: {
            choices: [{ delta: { refusal: "I can't help with that." }, finish_reason: 'stop' }]
          }
        },
        '[DONE]'
      ])
    )
    await expect(
      openaiAdapter.chat!.stream(ctx(fetch), req, { onDelta: () => {} })
    ).rejects.toMatchObject({ kind: 'content_policy' })
  })

  it('maps invalid key errors', async () => {
    const { fetch } = mockFetch(
      json({ error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } }, 401)
    )
    await expect(openaiAdapter.testKey(ctx(fetch))).rejects.toMatchObject({
      kind: 'invalid_key',
      providerId: 'openai'
    })
  })

  it('filters live model lists by capability', () => {
    const all = [
      'gpt-4o',
      'gpt-image-1',
      'dall-e-3',
      'tts-1',
      'whisper-1',
      'text-embedding-3-small',
      'sora-2',
      'o3',
      'gpt-4o-realtime-preview'
    ].map((id) => ({ id }))
    expect(filterOpenAIModels(all, 'chat').map((m) => m.id)).toEqual(['gpt-4o', 'o3'])
    expect(filterOpenAIModels(all, 'image').map((m) => m.id)).toEqual(['gpt-image-1', 'dall-e-3'])
    expect(filterOpenAIModels(all, 'tts').map((m) => m.id)).toEqual(['tts-1'])
    expect(filterOpenAIModels(all, 'stt').map((m) => m.id)).toEqual(['whisper-1'])
    expect(filterOpenAIModels(all, 'video').map((m) => m.id)).toEqual(['sora-2'])
  })
})

describe('Anthropic chat', () => {
  it('builds a Messages API body', () => {
    const body = buildAnthropicBody({ ...req, temperature: 1.7 })
    expect(body.system).toBe('Be brief')
    expect(body.max_tokens).toBe(100)
    expect(body.temperature).toBe(1) // clamped
    const first = (body.messages as Array<{ content: Array<Record<string, unknown>> }>)[0].content
    expect(first[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'iVBORw==' }
    })
    expect(first[1]).toMatchObject({ type: 'text' })
  })

  it('defaults max_tokens (required by the API)', () => {
    expect(buildAnthropicBody({ ...req, maxTokens: undefined }).max_tokens).toBe(4096)
  })

  it('streams text deltas and usage with the right headers', async () => {
    const { fetch, requests } = mockFetch(
      sse([
        {
          event: 'message_start',
          data: {
            type: 'message_start',
            message: { usage: { input_tokens: 11, output_tokens: 1 } }
          }
        },
        {
          event: 'content_block_delta',
          data: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi ' } }
        },
        {
          event: 'content_block_delta',
          data: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'there' } }
        },
        {
          event: 'message_delta',
          data: {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: { output_tokens: 5 }
          }
        },
        { event: 'message_stop', data: { type: 'message_stop' } }
      ])
    )
    const { text, result } = await collect((onDelta) =>
      anthropicAdapter.chat!.stream(ctx(fetch), { ...req, model: 'claude-sonnet-5-5' }, { onDelta })
    )
    expect(text).toBe('Hi there')
    expect(result).toEqual({
      usage: { inputTokens: 11, outputTokens: 5 },
      finishReason: 'end_turn'
    })
    expect(requests[0].url).toBe('https://api.anthropic.com/v1/messages')
    expect(requests[0].headers['x-api-key']).toBe('test-key-123456')
    expect(requests[0].headers['anthropic-version']).toBe('2023-06-01')
  })

  it('maps in-stream overloaded errors to rate_limit', async () => {
    const { fetch } = mockFetch(
      sse([
        {
          event: 'error',
          data: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }
        }
      ])
    )
    await expect(
      anthropicAdapter.chat!.stream(ctx(fetch), req, { onDelta: () => {} })
    ).rejects.toMatchObject({ kind: 'rate_limit' })
  })

  it('maps low credit balance to quota', async () => {
    const { fetch } = mockFetch(
      json(
        {
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: 'Your credit balance is too low to access the Anthropic API.'
          }
        },
        400
      )
    )
    await expect(
      anthropicAdapter.chat!.stream(ctx(fetch), req, { onDelta: () => {} })
    ).rejects.toMatchObject({ kind: 'quota' })
  })

  it('lists models', async () => {
    const { fetch } = mockFetch(json({ data: [{ id: 'claude-x', display_name: 'Claude X' }] }))
    expect(await anthropicAdapter.listModels!(ctx(fetch), 'chat')).toEqual([
      { id: 'claude-x', name: 'Claude X', vision: true }
    ])
  })
})

describe('Gemini chat', () => {
  it('builds contents with roles, inline images and generation config', () => {
    const body = buildGeminiChatBody(req) as Record<string, unknown>
    const contents = body.contents as Array<{ role: string; parts: Array<Record<string, unknown>> }>
    expect(contents.map((c) => c.role)).toEqual(['user', 'model', 'user'])
    expect(contents[0].parts[0]).toEqual({
      inline_data: { mime_type: 'image/png', data: 'iVBORw==' }
    })
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'Be brief' }] })
    expect(body.generationConfig).toEqual({ temperature: 0.5, maxOutputTokens: 100 })
  })

  it('streams via SSE, skipping thought parts, with x-goog-api-key', async () => {
    const { fetch, requests } = mockFetch(
      sse([
        { data: { candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }] } }] } },
        { data: { candidates: [{ content: { parts: [{ text: 'Bonjour' }] } }] } },
        {
          data: {
            candidates: [{ content: { parts: [{ text: '!' }] }, finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 }
          }
        }
      ])
    )
    const { text, result } = await collect((onDelta) =>
      geminiAdapter.chat!.stream(ctx(fetch), { ...req, model: 'gemini-2.5-flash' }, { onDelta })
    )
    expect(text).toBe('Bonjour!')
    expect(result).toEqual({ usage: { inputTokens: 3, outputTokens: 2 }, finishReason: 'STOP' })
    expect(requests[0].url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse'
    )
    expect(requests[0].headers['x-goog-api-key']).toBe('test-key-123456')
    expect(requests[0].url).not.toContain('test-key')
  })

  it('maps blocked prompts to content_policy', async () => {
    const { fetch } = mockFetch(sse([{ data: { promptFeedback: { blockReason: 'SAFETY' } } }]))
    await expect(
      geminiAdapter.chat!.stream(ctx(fetch), req, { onDelta: () => {} })
    ).rejects.toMatchObject({ kind: 'content_policy' })
  })

  it('maps "API key not valid" (HTTP 400) to invalid_key', async () => {
    const { fetch } = mockFetch(
      json(
        {
          error: {
            code: 400,
            message: 'API key not valid. Please pass a valid API key.',
            status: 'INVALID_ARGUMENT'
          }
        },
        400
      )
    )
    await expect(geminiAdapter.testKey(ctx(fetch))).rejects.toMatchObject({ kind: 'invalid_key' })
  })

  it('lists and filters models', async () => {
    const { fetch } = mockFetch(
      json({
        models: [
          { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
          {
            name: 'models/gemini-2.5-flash-image',
            supportedGenerationMethods: ['generateContent']
          },
          { name: 'models/imagen-4.0-generate-001', supportedGenerationMethods: ['predict'] },
          {
            name: 'models/veo-3.0-generate-001',
            supportedGenerationMethods: ['predictLongRunning']
          },
          { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] }
        ]
      })
    )
    expect((await geminiAdapter.listModels!(ctx(fetch), 'chat')).map((m) => m.id)).toEqual([
      'gemini-2.5-flash'
    ])
    expect((await geminiAdapter.listModels!(ctx(fetch), 'image')).map((m) => m.id)).toEqual([
      'gemini-2.5-flash-image',
      'imagen-4.0-generate-001'
    ])
    expect((await geminiAdapter.listModels!(ctx(fetch), 'video')).map((m) => m.id)).toEqual([
      'veo-3.0-generate-001'
    ])
  })
})

describe('xAI chat', () => {
  it('uses the OpenAI-compatible endpoint with max_tokens', async () => {
    const { fetch, requests } = mockFetch(
      sse([{ data: { choices: [{ delta: { content: 'ok' } }] } }, '[DONE]'])
    )
    await xaiAdapter.chat!.stream(ctx(fetch), { ...req, model: 'grok-4' }, { onDelta: () => {} })
    expect(requests[0].url).toBe('https://api.x.ai/v1/chat/completions')
    expect(requests[0].body).toMatchObject({ model: 'grok-4', max_tokens: 100, temperature: 0.5 })
  })
})

describe('Custom OpenAI-compatible', () => {
  const config = { baseUrl: 'http://localhost:11434/v1/', model: 'llama3' }

  it('requires a base URL', async () => {
    const { fetch } = mockFetch(json({}))
    await expect(customAdapter.testKey(ctx(fetch))).rejects.toMatchObject({
      kind: 'not_configured'
    })
  })

  it('streams from the configured base URL without OpenAI-only params', async () => {
    const { fetch, requests } = mockFetch(
      sse([{ data: { choices: [{ delta: { content: 'local' } }] } }, '[DONE]'])
    )
    const { text } = await collect((onDelta) =>
      customAdapter.chat!.stream(ctx(fetch, { config }), { ...req, model: 'llama3' }, { onDelta })
    )
    expect(text).toBe('local')
    expect(requests[0].url).toBe('http://localhost:11434/v1/chat/completions')
    expect(requests[0].body).not.toHaveProperty('stream_options')
    expect(requests[0].body).toMatchObject({ max_tokens: 100 })
  })

  it('falls back to a 1-token completion when /models is missing', async () => {
    const { fetch, requests } = mockFetch(json({ error: 'not found' }, 404), json({ choices: [] }))
    await customAdapter.testKey(ctx(fetch, { config }))
    expect(requests.map((r) => r.url)).toEqual([
      'http://localhost:11434/v1/models',
      'http://localhost:11434/v1/chat/completions'
    ])
    expect(requests[1].body).toMatchObject({ model: 'llama3', max_tokens: 1 })
  })
})
