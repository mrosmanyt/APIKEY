import { afterEach, describe, expect, it } from 'vitest'
import { clearRegisteredSecrets, redact, redactValue, registerSecret } from '../src/shared/redact'

afterEach(() => clearRegisteredSecrets())

describe('redact', () => {
  it.each([
    ['OpenAI', 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789'],
    ['Anthropic', 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz-0123456789'],
    ['xAI', 'xai-abcdefghijklmnopqrstuvwxyz0123'],
    ['Google', 'AIzaSyA1234567890abcdefghijklmnopqrstuv'],
    ['ElevenLabs', 'sk_0123456789abcdef0123456789abcdef0123456789abcdef'],
    ['Groq', 'gsk_abcdefghijklmnopqrstuvwxyz012345'],
    ['generic hex', '0123456789abcdef0123456789abcdef']
  ])('removes %s keys', (_name, key) => {
    const out = redact(`Error: Incorrect API key provided: ${key}. Try again`)
    expect(out).not.toContain(key)
    expect(out).toContain('[REDACTED]')
  })

  it('redacts authorization headers and bearer tokens', () => {
    expect(redact('Authorization: Bearer abc.def.ghi-12345')).not.toContain('abc.def.ghi-12345')
    expect(redact('{"x-api-key":"my-secret-value"}')).not.toContain('my-secret-value')
    expect(redact('xi-api-key: abcdef123')).not.toContain('abcdef123')
  })

  it('redacts keys in query strings', () => {
    const out = redact('GET https://example.com/v1/models?key=SECRETVALUE&x=1')
    expect(out).not.toContain('SECRETVALUE')
    expect(out).toContain('x=1')
  })

  it('redacts registered secrets that match no pattern', () => {
    registerSecret('short-custom-key')
    expect(redact('the key short-custom-key failed')).toBe('the key [REDACTED] failed')
  })

  it('leaves normal text alone', () => {
    const text = 'The model gpt-4o-mini returned 404 for conversation c_123 at 2026-01-01'
    expect(redact(text)).toBe(text)
  })

  it('redactValue handles objects and errors', () => {
    expect(redactValue({ apiKey: 'sk-abcdefghijklmnopqrstuvwxyz' })).not.toContain(
      'abcdefghijklmnop'
    )
    expect(redactValue(new Error('bad key sk-abcdefghijklmnopqrstuvwxyz'))).toContain('[REDACTED]')
  })
})
