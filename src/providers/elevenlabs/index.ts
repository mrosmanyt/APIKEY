/**
 * ElevenLabs — https://elevenlabs.io/docs/api-reference
 * Text-to-speech and speech-to-text (Scribe).
 */
import type { VoiceInfo } from '@shared/types'
import { requestBinary, requestJson } from '../http'
import type { ProviderAdapter } from '../types'

export const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1'
const ID = 'elevenlabs'

/** ElevenLabs premade voices (available on every account). Refresh to load your own voices. */
const DEFAULT_VOICES: VoiceInfo[] = [
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah' },
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam' },
  { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh' },
  { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli' },
  { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi' }
]

export function elevenHeaders(apiKey: string, json = true): Record<string, string> {
  return json
    ? { 'xi-api-key': apiKey, 'Content-Type': 'application/json' }
    : { 'xi-api-key': apiKey }
}

export function buildElevenTtsRequest(voice: string, model: string, text: string) {
  return {
    url: `${ELEVENLABS_BASE}/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,
    body: { text, model_id: model }
  }
}

export const elevenlabsAdapter: ProviderAdapter = {
  id: ID,
  name: 'ElevenLabs',
  description: 'High quality text-to-speech voices and Scribe speech-to-text.',
  keyUrl: 'https://elevenlabs.io/app/settings/api-keys',
  keyPlaceholder: 'sk_...',

  async testKey(ctx) {
    await requestJson(ctx, ID, `${ELEVENLABS_BASE}/voices`, {
      method: 'GET',
      headers: elevenHeaders(ctx.apiKey, false)
    })
  },

  async listModels(ctx, capability) {
    const json = await requestJson<
      Array<{ model_id: string; name?: string; can_do_text_to_speech?: boolean }>
    >(ctx, ID, `${ELEVENLABS_BASE}/models`, {
      method: 'GET',
      headers: elevenHeaders(ctx.apiKey, false)
    })
    if (capability === 'tts')
      return json
        .filter((m) => m.can_do_text_to_speech !== false)
        .map((m) => ({ id: m.model_id, name: m.name }))
    return []
  },

  tts: {
    models: [
      { id: 'eleven_multilingual_v2', name: 'Multilingual v2' },
      { id: 'eleven_v3', name: 'Eleven v3' },
      { id: 'eleven_turbo_v2_5', name: 'Turbo v2.5' },
      { id: 'eleven_flash_v2_5', name: 'Flash v2.5' }
    ],
    voices: DEFAULT_VOICES,
    async listVoices(ctx) {
      const json = await requestJson<{ voices?: Array<{ voice_id: string; name: string }> }>(
        ctx,
        ID,
        `${ELEVENLABS_BASE}/voices`,
        { method: 'GET', headers: elevenHeaders(ctx.apiKey, false) }
      )
      return (json.voices ?? []).map((v) => ({ id: v.voice_id, name: v.name }))
    },
    async synthesize(ctx, req) {
      const { url, body } = buildElevenTtsRequest(req.voice, req.model, req.text)
      const { data } = await requestBinary(ctx, ID, url, {
        method: 'POST',
        headers: { ...elevenHeaders(ctx.apiKey), Accept: 'audio/mpeg' },
        body: JSON.stringify(body)
      })
      return { data, mime: 'audio/mpeg' }
    }
  },

  stt: {
    models: [{ id: 'scribe_v1', name: 'Scribe v1' }],
    async transcribe(ctx, req) {
      const form = new FormData()
      form.append('model_id', req.model)
      form.append('file', new Blob([new Uint8Array(req.audio)], { type: req.mime }), req.fileName)
      if (req.language) form.append('language_code', req.language)
      const json = await requestJson<{ text?: string }>(
        ctx,
        ID,
        `${ELEVENLABS_BASE}/speech-to-text`,
        {
          method: 'POST',
          headers: elevenHeaders(ctx.apiKey, false),
          body: form
        }
      )
      return { text: json.text ?? '' }
    }
  }
}
