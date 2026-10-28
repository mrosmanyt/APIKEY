import type { Attachment } from '@shared/types'

/** Context assumed when a model's window is unknown. */
export const DEFAULT_CONTEXT_WINDOW = 128_000

/** Estimated tokens of attachment text (~4 characters per token). */
export function attachmentTokens(attachments: Attachment[]): number {
  return attachments.reduce((n, a) => n + Math.ceil((a.text?.length ?? 0) / 4), 0)
}

export interface SizeWarning {
  level: 'ok' | 'info' | 'too_large'
  tokens: number
  limit: number
  /** The model's window is unknown and the default was assumed. */
  assumed: boolean
}

/**
 * Compare the text going into a request with the model's context window, keeping ~20% headroom
 * for the conversation and the answer.
 */
export function sizeWarning(tokens: number, contextWindow: number | undefined): SizeWarning {
  const limit = contextWindow ?? DEFAULT_CONTEXT_WINDOW
  const assumed = contextWindow === undefined
  if (tokens > limit * 0.8) return { level: 'too_large', tokens, limit, assumed }
  if (tokens > 20_000) return { level: 'info', tokens, limit, assumed }
  return { level: 'ok', tokens, limit, assumed }
}

/** 1234 -> "1.2k", 1500000 -> "1.5M" */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}
