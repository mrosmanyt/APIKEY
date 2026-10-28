import { ProviderError, classifyHttpError, toProviderError } from './errors'
import type { ProviderContext } from './types'

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504, 529])
const MAX_BACKOFF_MS = 30_000

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function sleepWithSignal(ctx: ProviderContext, ms: number): Promise<void> {
  const sleep = ctx.sleep ?? defaultSleep
  if (!ctx.signal) return sleep(ms)
  if (ctx.signal.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError())
    ctx.signal!.addEventListener('abort', onAbort, { once: true })
    sleep(ms).then(
      () => {
        ctx.signal!.removeEventListener('abort', onAbort)
        resolve()
      },
      (e) => reject(e)
    )
  })
}

function abortError(): Error {
  const e = new Error('The operation was aborted')
  e.name = 'AbortError'
  return e
}

export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  const secs = Number(value)
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000)
  const date = Date.parse(value)
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now())
  return undefined
}

export function backoffDelay(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined) return Math.min(retryAfterMs, MAX_BACKOFF_MS)
  const base = 1000 * 2 ** attempt
  const jitter = Math.floor(Math.random() * 250)
  return Math.min(base + jitter, MAX_BACKOFF_MS)
}

/**
 * fetch with error classification and automatic retry/backoff for rate limits, transient
 * server errors and network blips. Quota errors (also often HTTP 429) are NOT retried.
 * Returns only successful (2xx) responses; everything else throws ProviderError.
 */
export async function fetchWithRetry(
  ctx: ProviderContext,
  providerId: string,
  url: string,
  init: RequestInit
): Promise<Response> {
  const maxRetries = ctx.maxRetries ?? 3
  let attempt = 0
  for (;;) {
    let res: Response
    try {
      res = await ctx.fetch(url, { ...init, signal: ctx.signal })
    } catch (err) {
      const pe = toProviderError(err, providerId)
      if (pe.kind === 'network' && attempt < maxRetries && !ctx.signal?.aborted) {
        await sleepWithSignal(ctx, backoffDelay(attempt))
        attempt++
        continue
      }
      throw pe
    }
    if (res.ok) return res

    const body = await safeText(res)
    const retryAfter = parseRetryAfter(res.headers.get('retry-after'))
    const err = classifyHttpError(res.status, body, providerId, retryAfter)
    const retryable =
      RETRYABLE_STATUS.has(res.status) && (err.kind === 'rate_limit' || err.kind === 'server')
    if (retryable && attempt < maxRetries) {
      await sleepWithSignal(ctx, backoffDelay(attempt, retryAfter))
      attempt++
      continue
    }
    throw err
  }
}

export async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

export async function requestJson<T>(
  ctx: ProviderContext,
  providerId: string,
  url: string,
  init: RequestInit
): Promise<T> {
  const res = await fetchWithRetry(ctx, providerId, url, init)
  const text = await safeText(res)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ProviderError({
      kind: 'unknown',
      providerId,
      message: 'The provider returned an unexpected (non-JSON) response.',
      details: text.slice(0, 2000)
    })
  }
}

export async function requestBinary(
  ctx: ProviderContext,
  providerId: string,
  url: string,
  init: RequestInit
): Promise<{ data: Buffer; mime: string }> {
  const res = await fetchWithRetry(ctx, providerId, url, init)
  const buf = Buffer.from(await res.arrayBuffer())
  return {
    data: buf,
    mime: res.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream'
  }
}

export interface SseEvent {
  event?: string
  data: string
}

/**
 * Parse a Server-Sent-Events body. Calls onEvent for each complete event.
 * Works with any ReadableStream<Uint8Array> (fetch body).
 */
export async function readSse(
  res: Response,
  onEvent: (ev: SseEvent) => void | 'stop'
): Promise<void> {
  if (!res.body) throw new ProviderError({ kind: 'unknown', message: 'Empty streaming response' })
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let eventName: string | undefined
  let dataLines: string[] = []

  const flush = (): boolean => {
    if (dataLines.length === 0) {
      eventName = undefined
      return false
    }
    const result = onEvent({ event: eventName, data: dataLines.join('\n') })
    eventName = undefined
    dataLines = []
    return result === 'stop'
  }

  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buffer.search(/\r?\n/)) >= 0) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + (buffer[idx] === '\r' ? 2 : 1))
        if (line === '') {
          if (flush()) return
        } else if (line.startsWith(':')) {
          // comment / keep-alive
        } else {
          const colon = line.indexOf(':')
          const field = colon === -1 ? line : line.slice(0, colon)
          let val = colon === -1 ? '' : line.slice(colon + 1)
          if (val.startsWith(' ')) val = val.slice(1)
          if (field === 'data') dataLines.push(val)
          else if (field === 'event') eventName = val
        }
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) {
      for (const line of buffer.split(/\r?\n/)) {
        if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
        else if (line.startsWith('event:')) eventName = line.slice(6).trim()
      }
    }
    flush()
  } catch (err) {
    throw toProviderError(err)
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* ignore */
    }
  }
}

export function trimSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

/** Parse "data:<mime>;base64,..." or raw base64 into a Buffer. */
export function base64ToBuffer(b64: string): Buffer {
  const comma = b64.indexOf(',')
  return Buffer.from(comma >= 0 && b64.startsWith('data:') ? b64.slice(comma + 1) : b64, 'base64')
}
