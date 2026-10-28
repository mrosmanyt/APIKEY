import { describe, expect, it } from 'vitest'
import { buildElevenTtsRequest, elevenlabsAdapter } from '../src/providers/elevenlabs'
import { buildImagenBody, geminiAdapter } from '../src/providers/gemini'
import { buildOpenAIImageBody, openaiAdapter } from '../src/providers/openai'
import { xaiAdapter } from '../src/providers/xai'
import { ctx, json, mockFetch } from './helpers/fakes'

const PNG_B64 = Buffer.from('fake-png').toString('base64')

describe('image generation', () => {
  it('OpenAI: gpt-image omits response_format, dall-e asks for b64', () => {
    expect(
      buildOpenAIImageBody({ model: 'gpt-image-1', prompt: 'p', count: 2, size: '1024x1024' })
    ).toEqual({ model: 'gpt-image-1', prompt: 'p', n: 2, size: '1024x1024' })
    expect(buildOpenAIImageBody({ model: 'dall-e-3', prompt: 'p', count: 1 })).toMatchObject({
      response_format: 'b64_json'
    })
  })

  it('OpenAI: decodes base64 images', async () => {
    const { fetch, requests } = mockFetch(
      json({ data: [{ b64_json: PNG_B64, revised_prompt: 'better' }] })
    )
    const out = await openaiAdapter.image!.generate(ctx(fetch), {
      model: 'dall-e-3',
      prompt: 'cat',
      count: 1
    })
    expect(out[0].data.toString()).toBe('fake-png')
    expect(out[0].revisedPrompt).toBe('better')
    expect(requests[0].url).toBe('https://api.openai.com/v1/images/generations')
  })

  it('OpenAI: maps safety rejections to content_policy', async () => {
    const { fetch } = mockFetch(
      json(
        {
          error: {
            message: 'Your request was rejected as a result of our safety system.',
            code: 'content_policy_violation'
          }
        },
        400
      )
    )
    await expect(
      openaiAdapter.image!.generate(ctx(fetch), { model: 'dall-e-3', prompt: 'x', count: 1 })
    ).rejects.toMatchObject({ kind: 'content_policy' })
  })

  it('Gemini Imagen: predict body with aspect ratio and negative prompt', async () => {
    expect(
      buildImagenBody({
        model: 'imagen-3.0-generate-002',
        prompt: 'p',
        count: 2,
        size: '16:9',
        negativePrompt: 'blur'
      })
    ).toEqual({
      instances: [{ prompt: 'p' }],
      parameters: { sampleCount: 2, aspectRatio: '16:9', negativePrompt: 'blur' }
    })
    const { fetch, requests } = mockFetch(
      json({ predictions: [{ bytesBase64Encoded: PNG_B64, mimeType: 'image/png' }] })
    )
    const out = await geminiAdapter.image!.generate(ctx(fetch), {
      model: 'imagen-4.0-generate-001',
      prompt: 'p',
      count: 1
    })
    expect(out).toHaveLength(1)
    expect(requests[0].url).toContain('/models/imagen-4.0-generate-001:predict')
  })

  it('Gemini image model: generateContent with IMAGE modality, one call per image', async () => {
    const { fetch, requests } = mockFetch(
      json({
        candidates: [
          {
            content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }] },
            finishReason: 'STOP'
          }
        ]
      })
    )
    const out = await geminiAdapter.image!.generate(ctx(fetch), {
      model: 'gemini-2.5-flash-image',
      prompt: 'p',
      count: 2,
      size: '1:1'
    })
    expect(out).toHaveLength(2)
    expect(requests).toHaveLength(2)
    expect(requests[0].body).toMatchObject({
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1' } }
    })
  })

  it('Gemini image model: no image + safety finish -> content_policy', async () => {
    const { fetch } = mockFetch(
      json({ candidates: [{ content: { parts: [] }, finishReason: 'IMAGE_SAFETY' }] })
    )
    await expect(
      geminiAdapter.image!.generate(ctx(fetch), {
        model: 'gemini-2.5-flash-image',
        prompt: 'p',
        count: 1
      })
    ).rejects.toMatchObject({ kind: 'content_policy' })
  })

  it('xAI: requests b64 images', async () => {
    const { fetch, requests } = mockFetch(
      json({ data: [{ b64_json: PNG_B64 }, { b64_json: PNG_B64 }] })
    )
    const out = await xaiAdapter.image!.generate(ctx(fetch), {
      model: 'grok-2-image',
      prompt: 'p',
      count: 2
    })
    expect(out).toHaveLength(2)
    expect(requests[0].body).toEqual({
      model: 'grok-2-image',
      prompt: 'p',
      n: 2,
      response_format: 'b64_json'
    })
  })
})

describe('text to speech', () => {
  it('OpenAI: posts to /audio/speech and returns mp3', async () => {
    const { fetch, requests } = mockFetch(
      new Response(Buffer.from('mp3data'), { headers: { 'content-type': 'audio/mpeg' } })
    )
    const out = await openaiAdapter.tts!.synthesize(ctx(fetch), {
      model: 'tts-1',
      voice: 'nova',
      text: 'hi'
    })
    expect(out.data.toString()).toBe('mp3data')
    expect(requests[0].body).toEqual({
      model: 'tts-1',
      voice: 'nova',
      input: 'hi',
      response_format: 'mp3'
    })
  })

  it('ElevenLabs: voice in path, xi-api-key header', async () => {
    expect(buildElevenTtsRequest('abc', 'eleven_v3', 'hi').url).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/abc?output_format=mp3_44100_128'
    )
    const { fetch, requests } = mockFetch(
      new Response(Buffer.from('mp3'), { headers: { 'content-type': 'audio/mpeg' } })
    )
    await elevenlabsAdapter.tts!.synthesize(ctx(fetch), {
      model: 'eleven_multilingual_v2',
      voice: 'v1',
      text: 'Hello'
    })
    expect(requests[0].headers['xi-api-key']).toBe('test-key-123456')
    expect(requests[0].body).toEqual({ text: 'Hello', model_id: 'eleven_multilingual_v2' })
  })

  it('ElevenLabs: lists voices and maps quota errors', async () => {
    const { fetch } = mockFetch(json({ voices: [{ voice_id: 'x1', name: 'Xena' }] }))
    expect(await elevenlabsAdapter.tts!.listVoices!(ctx(fetch))).toEqual([
      { id: 'x1', name: 'Xena' }
    ])
    const { fetch: f2 } = mockFetch(
      json(
        { detail: { status: 'quota_exceeded', message: 'This request exceeds your quota.' } },
        401
      )
    )
    await expect(
      elevenlabsAdapter.tts!.synthesize(ctx(f2), { model: 'm', voice: 'v', text: 't' })
    ).rejects.toMatchObject({ kind: 'quota' })
  })
})

describe('speech to text', () => {
  it('OpenAI: multipart upload to /audio/transcriptions', async () => {
    const { fetch, requests } = mockFetch(json({ text: 'hello world' }))
    const out = await openaiAdapter.stt!.transcribe(ctx(fetch), {
      model: 'whisper-1',
      audio: Buffer.from('a'),
      mime: 'audio/webm',
      fileName: 'rec.webm',
      language: 'en'
    })
    expect(out.text).toBe('hello world')
    expect(requests[0].body).toMatchObject({
      model: 'whisper-1',
      file: '[file:rec.webm]',
      language: 'en'
    })
    expect(requests[0].headers['content-type']).toBeUndefined() // fetch sets the multipart boundary
  })

  it('ElevenLabs: Scribe', async () => {
    const { fetch, requests } = mockFetch(json({ text: 'bonjour' }))
    const out = await elevenlabsAdapter.stt!.transcribe(ctx(fetch), {
      model: 'scribe_v1',
      audio: Buffer.from('a'),
      mime: 'audio/mpeg',
      fileName: 'a.mp3'
    })
    expect(out.text).toBe('bonjour')
    expect(requests[0].url).toBe('https://api.elevenlabs.io/v1/speech-to-text')
    expect(requests[0].body).toMatchObject({ model_id: 'scribe_v1' })
  })
})

describe('video', () => {
  it('OpenAI Sora: submit, poll, download', async () => {
    const { fetch, requests } = mockFetch(
      json({ id: 'video_1', status: 'queued' }),
      json({ id: 'video_1', status: 'in_progress', progress: 40 }),
      json({ id: 'video_1', status: 'completed', progress: 100 }),
      new Response(Buffer.from('mp4'), { headers: { 'content-type': 'video/mp4' } })
    )
    const c = ctx(fetch)
    const { jobId } = await openaiAdapter.video!.submit(c, {
      model: 'sora-2',
      prompt: 'p',
      size: '1280x720',
      durationSeconds: 8,
      image: { data: Buffer.from('i'), mime: 'image/png' }
    })
    expect(jobId).toBe('video_1')
    expect(requests[0].body).toMatchObject({
      model: 'sora-2',
      prompt: 'p',
      size: '1280x720',
      seconds: '8',
      input_reference: '[file:reference.png]'
    })
    expect(await openaiAdapter.video!.poll(c, jobId)).toMatchObject({
      status: 'running',
      progress: 40
    })
    expect(await openaiAdapter.video!.poll(c, jobId)).toMatchObject({ status: 'completed' })
    const out = await openaiAdapter.video!.download(c, jobId)
    expect(out.data.toString()).toBe('mp4')
    expect(requests[3].url).toBe('https://api.openai.com/v1/videos/video_1/content')
  })

  it('Gemini Veo: long-running operation flow', async () => {
    const op = 'models/veo-3.0-generate-001/operations/op123'
    const uri = 'https://generativelanguage.googleapis.com/v1beta/files/f1:download?alt=media'
    const { fetch, requests } = mockFetch(
      json({ name: op }),
      json({ name: op, done: false }),
      json({
        name: op,
        done: true,
        response: { generateVideoResponse: { generatedSamples: [{ video: { uri } }] } }
      }),
      new Response(Buffer.from('mp4'))
    )
    const c = ctx(fetch)
    const { jobId } = await geminiAdapter.video!.submit(c, {
      model: 'veo-3.0-generate-001',
      prompt: 'p',
      size: '16:9'
    })
    expect(jobId).toBe(op)
    expect(requests[0].url).toContain(':predictLongRunning')
    expect(requests[0].body).toEqual({
      instances: [{ prompt: 'p' }],
      parameters: { aspectRatio: '16:9' }
    })
    expect((await geminiAdapter.video!.poll(c, jobId)).status).toBe('running')
    const done = await geminiAdapter.video!.poll(c, jobId)
    expect(done).toEqual({ status: 'completed', resultRef: uri })
    await geminiAdapter.video!.download(c, jobId, done.resultRef)
    expect(requests[3].url).toBe(uri)
    expect(requests[3].headers['x-goog-api-key']).toBe('test-key-123456')
  })

  it('Gemini Veo: filtered result is reported as failed', async () => {
    const { fetch } = mockFetch(
      json({
        done: true,
        response: { generateVideoResponse: { raiMediaFilteredReasons: ['Unsafe content'] } }
      })
    )
    expect(await geminiAdapter.video!.poll(ctx(fetch), 'models/x/operations/y')).toEqual({
      status: 'failed',
      error: 'Unsafe content'
    })
  })

  it('xAI (experimental): flags itself and maps statuses', async () => {
    expect(xaiAdapter.video!.experimental).toBe(true)
    const { fetch } = mockFetch(
      json({ request_id: 'r1' }),
      json({ status: 'pending' }),
      json({ status: 'done', video: { url: 'https://x/v.mp4' } })
    )
    const c = ctx(fetch)
    expect(await xaiAdapter.video!.submit(c, { model: 'grok-imagine-video', prompt: 'p' })).toEqual(
      { jobId: 'r1' }
    )
    expect((await xaiAdapter.video!.poll(c, 'r1')).status).toBe('queued')
    expect(await xaiAdapter.video!.poll(c, 'r1')).toEqual({
      status: 'completed',
      resultRef: 'https://x/v.mp4'
    })
  })
})
