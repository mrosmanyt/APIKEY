import { describe, expect, it } from 'vitest'
import { classifyHttpError, extractProviderMessage, toProviderError } from '../src/providers/errors'
import { backoffDelay, fetchWithRetry, parseRetryAfter, readSse } from '../src/providers/http'
import { ctx, json, mockFetch, sse } from './helpers/fakes'

describe('error classification', () => {
  it.each([
    [
      401,
      { error: { message: 'Incorrect API key provided: sk-abcdefghijklmnopqrstuvwx' } },
      'invalid_key'
    ],
    [
      400,
      {
        error: {
          code: 400,
          message: 'API key not valid. Please pass a valid API key.',
          status: 'INVALID_ARGUMENT'
        }
      },
      'invalid_key'
    ],
    [
      429,
      {
        error: {
          message: 'You exceeded your current quota, please check your plan and billing details.',
          type: 'insufficient_quota'
        }
      },
      'quota'
    ],
    [
      400,
      {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'Your credit balance is too low to access the Anthropic API.'
        }
      },
      'quota'
    ],
    [402, { detail: { status: 'payment_required', message: 'Not enough credits' } }, 'quota'],
    [429, { error: { message: 'Rate limit reached for requests' } }, 'rate_limit'],
    [
      529,
      { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
      'rate_limit'
    ],
    [
      404,
      { error: { message: 'The model `gpt-9` does not exist or you do not have access to it.' } },
      'model_not_found'
    ],
    [
      400,
      {
        error: {
          message: 'Your request was rejected as a result of our safety system.',
          code: 'content_policy_violation'
        }
      },
      'content_policy'
    ],
    [500, { error: { message: 'Internal error' } }, 'server'],
    [400, { error: { message: 'max_tokens: must be positive' } }, 'bad_request']
  ])('HTTP %i -> %s', (status, body, kind) => {
    const err = classifyHttpError(status, JSON.stringify(body), 'p')
    expect(err.kind).toBe(kind)
    expect(err.status).toBe(status)
  })

  it('never leaks keys in message or details', () => {
    const err = classifyHttpError(
      401,
      JSON.stringify({
        error: { message: 'Incorrect API key provided: sk-proj-abcdefghijklmnopqrstuvwxyz' }
      })
    )
    expect(err.message).not.toContain('abcdefghijklmnop')
    expect(err.details).not.toContain('abcdefghijklmnop')
  })

  it('extracts nested provider messages', () => {
    expect(extractProviderMessage('{"error":{"message":"boom"}}')).toBe('boom')
    expect(extractProviderMessage('{"detail":{"message":"nested"}}')).toBe('nested')
    expect(extractProviderMessage('{"detail":"plain"}')).toBe('plain')
    expect(extractProviderMessage('<html>bad gateway</html>')).toBeUndefined()
    expect(extractProviderMessage('plain text')).toBe('plain text')
  })

  it('maps thrown errors', () => {
    expect(toProviderError(new TypeError('fetch failed')).kind).toBe('network')
    expect(toProviderError(new Error('net::ERR_INTERNET_DISCONNECTED')).kind).toBe('network')
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    expect(toProviderError(abort).kind).toBe('cancelled')
    expect(toProviderError(new Error('weird')).kind).toBe('unknown')
  })
})

describe('fetchWithRetry', () => {
  it('retries rate limits with backoff then succeeds', async () => {
    const sleeps: number[] = []
    const { fetch, requests } = mockFetch(
      json({ error: { message: 'Rate limit' } }, 429, { 'retry-after': '2' }),
      json({ error: { message: 'Rate limit' } }, 429),
      json({ ok: true })
    )
    const res = await fetchWithRetry(
      ctx(fetch, { sleep: async (ms) => void sleeps.push(ms) }),
      'p',
      'https://x',
      { method: 'GET' }
    )
    expect(res.status).toBe(200)
    expect(requests).toHaveLength(3)
    expect(sleeps[0]).toBe(2000) // honours Retry-After
    expect(sleeps).toHaveLength(2)
  })

  it('does not retry quota errors', async () => {
    const { fetch, requests } = mockFetch(
      json({ error: { message: 'exceeded your current quota', type: 'insufficient_quota' } }, 429)
    )
    await expect(fetchWithRetry(ctx(fetch), 'p', 'https://x', {})).rejects.toMatchObject({
      kind: 'quota'
    })
    expect(requests).toHaveLength(1)
  })

  it('gives up after maxRetries', async () => {
    const { fetch, requests } = mockFetch(json({ error: { message: 'down' } }, 503))
    await expect(
      fetchWithRetry(ctx(fetch, { maxRetries: 2 }), 'p', 'https://x', {})
    ).rejects.toMatchObject({ kind: 'server' })
    expect(requests).toHaveLength(3)
  })

  it('retries network failures', async () => {
    let n = 0
    const fetch = async () => {
      if (n++ === 0) throw new TypeError('fetch failed')
      return json({ ok: 1 })
    }
    const res = await fetchWithRetry(ctx(fetch), 'p', 'https://x', {})
    expect(res.ok).toBe(true)
  })

  it('does not retry auth errors', async () => {
    const { fetch, requests } = mockFetch(json({ error: { message: 'Invalid API key' } }, 401))
    await expect(fetchWithRetry(ctx(fetch), 'p', 'https://x', {})).rejects.toMatchObject({
      kind: 'invalid_key'
    })
    expect(requests).toHaveLength(1)
  })

  it('computes backoff and parses Retry-After', () => {
    expect(parseRetryAfter('3')).toBe(3000)
    expect(parseRetryAfter(null)).toBeUndefined()
    expect(backoffDelay(0)).toBeGreaterThanOrEqual(1000)
    expect(backoffDelay(10)).toBeLessThanOrEqual(30_000)
    expect(backoffDelay(1, 99_000)).toBe(30_000)
  })
})

describe('readSse', () => {
  it('parses events split across chunks', async () => {
    const events: Array<{ event?: string; data: string }> = []
    await readSse(
      sse([{ event: 'a', data: { x: 1 } }, 'hello', '[DONE]']),
      (e) => void events.push(e)
    )
    expect(events).toEqual([
      { event: 'a', data: '{"x":1}' },
      { event: undefined, data: 'hello' },
      { event: undefined, data: '[DONE]' }
    ])
  })
})
