/**
 * Secret redaction. Used by the logger and by every error that can reach the UI or a log file.
 *
 * Two layers:
 *  1. Exact matching of secrets the app knows about (registered when keys are loaded/saved).
 *  2. Pattern matching for anything that *looks* like an API key or credential.
 */

const REDACTED = '[REDACTED]'

const knownSecrets = new Set<string>()

/** Register a secret so it is always redacted, even if it does not match a known pattern. */
export function registerSecret(secret: string | undefined | null): void {
  if (secret && secret.length >= 6) knownSecrets.add(secret)
}

export function unregisterSecret(secret: string | undefined | null): void {
  if (secret) knownSecrets.delete(secret)
}

/** For tests. */
export function clearRegisteredSecrets(): void {
  knownSecrets.clear()
}

const PATTERNS: Array<[RegExp, string]> = [
  // Authorization headers / bearer tokens
  [/(authorization["']?\s*[:=]\s*["']?\s*(?:bearer|basic)\s+)[^\s"',}]+/gi, `$1${REDACTED}`],
  [/\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, `$1${REDACTED}`],
  // Header-style key fields: x-api-key, xi-api-key, x-goog-api-key, api_key, apiKey ...
  [
    /((?:x-api-key|xi-api-key|x-goog-api-key|api[_-]?key|apikey|access[_-]?token|secret)["']?\s*[:=]\s*["']?)[^\s"'&,}]+/gi,
    `$1${REDACTED}`
  ],
  // Query string keys (?key=..., &api_key=...)
  [/([?&](?:key|api_key|apikey|token|access_token)=)[^&\s"']+/gi, `$1${REDACTED}`],
  // Provider key shapes
  [/\bsk-ant-[A-Za-z0-9_-]{10,}/g, REDACTED], // Anthropic
  [/\bsk-[A-Za-z0-9_-]{16,}/g, REDACTED], // OpenAI / OpenRouter / DeepSeek ...
  [/\bsk_[A-Za-z0-9]{20,}/g, REDACTED], // ElevenLabs (new style)
  [/\bxai-[A-Za-z0-9_-]{16,}/g, REDACTED], // xAI
  [/\bAIza[0-9A-Za-z_-]{30,}/g, REDACTED], // Google
  [/\bgsk_[A-Za-z0-9]{20,}/g, REDACTED], // Groq
  [/\bhf_[A-Za-z0-9]{20,}/g, REDACTED], // Hugging Face
  [/\bAIHUB1\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, REDACTED], // license keys
  // Generic long opaque tokens (32+ chars, must contain a digit and a letter)
  [/\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{32,}\b/g, REDACTED]
]

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Redact secrets from a string. Safe to call on any text. */
export function redact(input: string): string {
  if (!input) return input
  let out = input
  for (const secret of knownSecrets) {
    if (out.includes(secret)) out = out.replace(new RegExp(escapeRegExp(secret), 'g'), REDACTED)
  }
  for (const [re, replacement] of PATTERNS) {
    out = out.replace(re, replacement)
  }
  return out
}

/** Redact any value (objects are JSON-stringified first). */
export function redactValue(value: unknown): string {
  if (typeof value === 'string') return redact(value)
  if (value instanceof Error) return redact(`${value.name}: ${value.message}`)
  try {
    return redact(JSON.stringify(value))
  } catch {
    return redact(String(value))
  }
}
