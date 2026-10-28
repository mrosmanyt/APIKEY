import type { AppErrorInfo, ErrorKind } from '@shared/types'
import { redact } from '@shared/redact'

/** Error thrown by adapters and the HTTP layer. Always carries redacted text only. */
export class ProviderError extends Error {
  readonly kind: ErrorKind
  readonly status?: number
  readonly details?: string
  readonly providerId?: string
  readonly retryAfterMs?: number

  constructor(opts: {
    kind: ErrorKind
    message: string
    status?: number
    details?: string
    providerId?: string
    retryAfterMs?: number
  }) {
    super(redact(opts.message))
    this.name = 'ProviderError'
    this.kind = opts.kind
    this.status = opts.status
    this.details = opts.details ? redact(opts.details) : undefined
    this.providerId = opts.providerId
    this.retryAfterMs = opts.retryAfterMs
  }

  toInfo(): AppErrorInfo {
    return {
      kind: this.kind,
      message: this.message,
      details: this.details,
      status: this.status,
      providerId: this.providerId
    }
  }
}

/** Pull the most useful human message out of a provider error body. */
export function extractProviderMessage(body: string): string | undefined {
  if (!body) return undefined
  try {
    const json = JSON.parse(body) as unknown
    const pick = (v: unknown): string | undefined => {
      if (!v) return undefined
      if (typeof v === 'string') return v
      if (Array.isArray(v)) return pick(v[0])
      if (typeof v === 'object') {
        const o = v as Record<string, unknown>
        return (
          pick(o.message) ??
          pick(o.error) ??
          pick(o.errors) ??
          pick(o.detail) ??
          pick(o.msg) ??
          (typeof o.status === 'string' ? o.status : undefined)
        )
      }
      return undefined
    }
    return pick(json)
  } catch {
    const trimmed = body.trim()
    if (trimmed.startsWith('<')) return undefined // HTML error pages are not useful
    return trimmed.slice(0, 300) || undefined
  }
}

const RE_QUOTA =
  /insufficient[_ ]quota|exceeded your (current )?quota|quota exceeded|billing|credit balance|insufficient (credits|balance|funds)|out of credits|payment required|quota_exceeded|resource has been exhausted.*(quota|billing)|not enough credits/i
const RE_INVALID_KEY =
  /invalid[_ ]api[_ ]key|incorrect api key|api key not valid|invalid x-api-key|invalid authentication|unauthenticated|invalid_api_key|api_key_invalid|authentication[_ ]error|no api key|missing api key|unauthorized/i
const RE_MODEL =
  /model[^.]{0,60}(not found|does not exist|not supported|is not available|unknown)|unknown model|no such model|model_not_found|invalid model/i
const RE_POLICY =
  /content[_ ]?policy|safety (system|filter)|moderation|flagged|violat|blocked due to|responsible ai|prohibited|content_filter|safety_block|SAFETY/i
const RE_RATE = /rate[_ ]?limit|too many requests|resource[_ ]exhausted|overloaded|slow down/i

export function classifyHttpError(
  status: number,
  body: string,
  providerId?: string,
  retryAfterMs?: number
): ProviderError {
  const providerMsg = extractProviderMessage(body)
  const text = `${providerMsg ?? ''} ${body}`
  let kind: ErrorKind

  if (status === 402 || RE_QUOTA.test(text)) kind = 'quota'
  else if (status === 401 || RE_INVALID_KEY.test(text)) kind = 'invalid_key'
  else if (status === 429 || status === 529 || RE_RATE.test(text)) kind = 'rate_limit'
  else if (RE_POLICY.test(text)) kind = 'content_policy'
  else if (status === 403) kind = 'invalid_key'
  else if (status === 404 || RE_MODEL.test(text)) kind = 'model_not_found'
  else if (status >= 500) kind = 'server'
  else if (status >= 400) kind = 'bad_request'
  else kind = 'unknown'

  return new ProviderError({
    kind,
    status,
    providerId,
    retryAfterMs,
    message: providerMsg ?? `HTTP ${status}`,
    details: `HTTP ${status}\n${body.slice(0, 4000)}`
  })
}

/** Convert anything thrown into a ProviderError. */
export function toProviderError(err: unknown, providerId?: string): ProviderError {
  if (err instanceof ProviderError) return err
  const e = err as { name?: string; message?: string; code?: string; cause?: { code?: string } }
  const name = e?.name ?? ''
  const message = e?.message ?? String(err)
  if (name === 'AbortError' || /aborted/i.test(message)) {
    return new ProviderError({ kind: 'cancelled', message: 'Request cancelled', providerId })
  }
  const code = e?.code ?? e?.cause?.code ?? ''
  if (
    name === 'TypeError' ||
    /net::ERR_|fetch failed|network|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ERR_INTERNET_DISCONNECTED|socket hang up/i.test(
      `${message} ${code}`
    )
  ) {
    return new ProviderError({
      kind: 'network',
      message: 'Could not reach the provider. Check your internet connection.',
      details: `${name}: ${message}${code ? ` (${code})` : ''}`,
      providerId
    })
  }
  return new ProviderError({
    kind: 'unknown',
    message,
    details: `${name}: ${message}`,
    providerId
  })
}

/** Content refusal detected in a successful (200) response body. */
export function contentPolicyError(providerId: string, message: string, details?: string) {
  return new ProviderError({ kind: 'content_policy', message, details, providerId })
}
