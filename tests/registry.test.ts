import { describe, expect, it } from 'vitest'
import { ADAPTERS, ProviderRegistry, registry, toProviderInfo } from '../src/providers/registry'
import type { ProviderAdapter } from '../src/providers/types'

describe('provider registry', () => {
  it('contains all built-in providers with unique ids', () => {
    const ids = registry.list().map((a) => a.id)
    expect(ids).toEqual(['openai', 'anthropic', 'gemini', 'xai', 'elevenlabs', 'custom'])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('rejects duplicate ids', () => {
    expect(() => new ProviderRegistry([ADAPTERS[0], ADAPTERS[0]])).toThrow(/Duplicate/)
  })

  it('reports capabilities from adapters', () => {
    expect(registry.withCapability('chat').map((a) => a.id)).toEqual([
      'openai',
      'anthropic',
      'gemini',
      'xai',
      'custom'
    ])
    expect(registry.withCapability('image').map((a) => a.id)).toEqual(['openai', 'gemini', 'xai'])
    expect(registry.withCapability('tts').map((a) => a.id)).toEqual(['openai', 'elevenlabs'])
    expect(registry.withCapability('stt').map((a) => a.id)).toEqual(['openai', 'elevenlabs'])
    expect(registry.withCapability('video').map((a) => a.id)).toEqual(['openai', 'gemini', 'xai'])
    expect(registry.has('anthropic', 'image')).toBe(false)
    expect(registry.has('nope')).toBe(false)
  })

  it('produces serialisable provider info without functions', () => {
    const infos = registry.listInfo()
    const roundTrip = JSON.parse(JSON.stringify(infos))
    expect(roundTrip).toEqual(infos)
    const openai = infos.find((i) => i.id === 'openai')!
    expect(openai.capabilities.chat!.models.length).toBeGreaterThan(0)
    expect(openai.capabilities.tts!.voices.length).toBeGreaterThan(0)
    expect(openai.canListModels).toBe(true)
    expect(infos.find((i) => i.id === 'xai')!.capabilities.video!.experimental).toBe(true)
  })

  it('injects the configured custom model and display name', () => {
    const info = registry.info('custom', { model: 'deepseek-chat', displayName: 'DeepSeek' })!
    expect(info.name).toBe('DeepSeek')
    expect(info.capabilities.chat!.models[0].id).toBe('deepseek-chat')
    expect(info.configFields.map((f) => f.key)).toContain('baseUrl')
  })

  it('supports new adapters without any other changes', () => {
    const fake: ProviderAdapter = {
      id: 'fake',
      name: 'Fake',
      description: 'd',
      keyUrl: 'https://example.com',
      keyPlaceholder: 'k',
      testKey: async () => {},
      tts: {
        models: [{ id: 'm' }],
        voices: [{ id: 'v', name: 'V' }],
        synthesize: async () => ({ data: Buffer.alloc(0), mime: 'audio/mpeg' })
      }
    }
    const r = new ProviderRegistry([fake])
    expect(r.withCapability('tts')).toHaveLength(1)
    expect(toProviderInfo(fake).capabilities).toEqual({
      tts: { models: [{ id: 'm' }], voices: [{ id: 'v', name: 'V' }], canListVoices: false }
    })
  })
})
