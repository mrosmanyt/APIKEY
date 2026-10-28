import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Encryptor } from '../../src/main/storage/keyStore'
import type { FetchLike, ProviderContext } from '../../src/providers/types'

/** Reversible fake "encryption" for tests (Electron safeStorage is not available in Vitest). */
export const fakeEncryptor: Encryptor = {
  isAvailable: () => true,
  encrypt: (s) => Buffer.from(`enc:${Buffer.from(s).toString('base64')}`),
  decrypt: (b) => Buffer.from(b.toString().slice(4), 'base64').toString()
}

export function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aihub-test-'))
}

export interface RecordedRequest {
  url: string
  method: string
  headers: Record<string, string>
  body?: unknown
  rawBody?: BodyInit | null
}

type Responder = (req: RecordedRequest) => Response | Promise<Response>

/** Mock fetch that records requests and returns queued (or computed) responses. */
export function mockFetch(...responders: Array<Response | Responder>) {
  const requests: RecordedRequest[] = []
  let i = 0
  const fetch: FetchLike = async (url, init) => {
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v))
    let body: unknown
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = init.body
      }
    } else if (init?.body instanceof FormData) {
      body = Object.fromEntries(
        [...init.body.entries()].map(([k, v]) => [
          k,
          typeof v === 'string' ? v : `[file:${(v as File).name}]`
        ])
      )
    }
    const req = { url, method: init?.method ?? 'GET', headers, body, rawBody: init?.body }
    requests.push(req)
    const r = responders[Math.min(i++, responders.length - 1)]
    if (!r) throw new Error('No mock response')
    return typeof r === 'function' ? r(req) : r.clone()
  }
  return { fetch, requests }
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

export function sse(events: Array<string | { event?: string; data: unknown }>): Response {
  const text = events
    .map((e) => {
      if (typeof e === 'string') return `data: ${e}\n\n`
      const data = typeof e.data === 'string' ? e.data : JSON.stringify(e.data)
      return `${e.event ? `event: ${e.event}\n` : ''}data: ${data}\n\n`
    })
    .join('')
  // Split into small chunks to exercise the streaming parser.
  const bytes = new TextEncoder().encode(text)
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7))
      controller.close()
    }
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

export function ctx(fetch: FetchLike, overrides: Partial<ProviderContext> = {}): ProviderContext {
  return { apiKey: 'test-key-123456', config: {}, fetch, sleep: async () => {}, ...overrides }
}
