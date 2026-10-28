/**
 * Electron's net.fetch rejects with "Redirect was cancelled" when called with
 * redirect: 'manual' instead of returning the 3xx response. This wrapper keeps net.fetch
 * (Chromium's network stack: system proxy, certificates) and implements 'manual' with
 * net.request, returning the redirect response with its absolute Location header — the same
 * behaviour as Node's fetch — so callers can check each hop before following it.
 */
import type { net as ElectronNet } from 'electron'
import type { FetchLike } from '../providers/types'

const NULL_BODY = new Set([101, 103, 204, 205, 304])

export function createAppFetch(net: typeof ElectronNet): FetchLike {
  return (input, init) =>
    init?.redirect === 'manual' ? manualRedirectFetch(net, input, init) : net.fetch(input, init)
}

function manualRedirectFetch(
  net: typeof ElectronNet,
  url: string,
  init: RequestInit
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const signal = init.signal ?? undefined
    if (signal?.aborted) return reject(signal.reason)
    let settled = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      fn()
    }
    const req = net.request({
      url,
      method: init.method ?? 'GET',
      redirect: 'manual',
      credentials: 'omit'
    })
    const onAbort = () => {
      req.abort()
      settle(() => reject(signal?.reason))
    }
    signal?.addEventListener('abort', onAbort)

    new Headers(init.headers).forEach((value, name) => {
      if (name !== 'content-length') req.setHeader(name, value)
    })

    req.on('redirect', (status, _method, redirectUrl) => {
      settle(() => resolve(new Response(null, { status, headers: { location: redirectUrl } })))
      req.abort()
    })
    req.on('response', (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(c))
      res.on('error', (err: Error) => settle(() => reject(err)))
      res.on('end', () => {
        const headers = new Headers()
        for (const [name, value] of Object.entries(res.headers))
          for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v)
        const body = NULL_BODY.has(res.statusCode) ? null : Buffer.concat(chunks)
        settle(() =>
          resolve(
            new Response(body, { status: res.statusCode, statusText: res.statusMessage, headers })
          )
        )
      })
    })
    req.on('error', (err) => settle(() => reject(err)))

    if (typeof init.body === 'string') req.write(init.body)
    else if (init.body != null) return settle(() => reject(new Error('Unsupported request body')))
    req.end()
  })
}
