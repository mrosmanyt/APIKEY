/**
 * DEVELOPMENT-ONLY mock provider (never registered in packaged builds). Enabled by starting
 * an unpackaged build with AIHUB_MOCK_PROVIDER=1. Lets you click through every screen
 * without spending API credit. Any key is accepted except "invalid".
 */
import zlib from 'node:zlib'
import { ProviderError } from '../errors'
import type { ProviderAdapter } from '../types'

const ID = 'mock'
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function png(size: number, seed: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (b: Buffer) => {
    let c = 0xffffffff
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const raw = Buffer.alloc((size * 3 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const i = y * (size * 3 + 1) + 1 + x * 3
      raw[i] = (x * 255) / size + seed * 40
      raw[i + 1] = (y * 255) / size
      raw[i + 2] = 180 + ((seed * 30) % 75)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function wavTone(seconds: number): Buffer {
  const rate = 16000
  const n = rate * seconds
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++)
    buf.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 8000), 44 + i * 2)
  return buf
}

const jobs = new Map<string, number>()

export const mockAdapter: ProviderAdapter = {
  id: ID,
  name: 'Mock provider (dev)',
  description:
    'Development-only fake provider with every capability. Not included in release builds.',
  keyUrl: 'https://example.com',
  keyPlaceholder: 'any text',
  async testKey(ctx) {
    if (ctx.apiKey === 'invalid')
      throw new ProviderError({ kind: 'invalid_key', providerId: ID, message: 'Mock: invalid key' })
  },
  chat: {
    models: [{ id: 'mock-chat', name: 'Mock chat', vision: true }],
    async stream(_ctx, req, h) {
      const last = req.messages[req.messages.length - 1]
      const text = `**Mock reply** to: ${last.content}\n\n\`\`\`python\n# hello.py\nprint("hello")\n\`\`\``
      for (const part of text.match(/.{1,5}/gs) ?? []) {
        h.onDelta(part)
        await wait(15)
      }
      return { usage: { inputTokens: 10, outputTokens: 20 }, finishReason: 'stop' }
    }
  },
  image: {
    models: [
      {
        id: 'mock-image',
        name: 'Mock image',
        sizes: ['256x256', '512x512'],
        maxCount: 4,
        supportsNegativePrompt: true
      }
    ],
    async generate(_ctx, req) {
      await wait(500)
      if (/forbidden/i.test(req.prompt))
        throw new ProviderError({
          kind: 'content_policy',
          providerId: ID,
          message: 'Mock: blocked by content policy',
          details: 'HTTP 400\n{"error":"content_policy_violation"}'
        })
      return Array.from({ length: req.count }, (_, i) => ({
        data: png(Number(req.size?.split('x')[0]) || 256, i + req.prompt.length),
        mime: 'image/png'
      }))
    }
  },
  tts: {
    models: [{ id: 'mock-tts', name: 'Mock TTS' }],
    voices: [{ id: 'tone', name: 'Tone' }],
    async synthesize() {
      return { data: wavTone(1), mime: 'audio/wav' }
    }
  },
  stt: {
    models: [{ id: 'mock-stt', name: 'Mock STT' }],
    async transcribe(_ctx, req) {
      return { text: `Mock transcript of ${req.fileName} (${req.audio.length} bytes)` }
    }
  },
  video: {
    models: [
      {
        id: 'mock-video',
        name: 'Mock video',
        sizes: ['1280x720'],
        durations: [4, 8],
        supportsImageInput: true
      }
    ],
    async submit() {
      const id = `mockjob_${Date.now()}`
      jobs.set(id, 0)
      return { jobId: id }
    },
    async poll(_ctx, jobId) {
      const n = (jobs.get(jobId) ?? 0) + 1
      jobs.set(jobId, n)
      return n >= 3 ? { status: 'completed' } : { status: 'running', progress: n * 33 }
    },
    async download() {
      // Not a real video; only exercises the download/save flow.
      return { data: wavTone(1), mime: 'video/mp4' }
    }
  }
}
