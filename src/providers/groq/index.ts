/** Groq — https://console.groq.com/docs (very fast OpenAI-compatible inference + Whisper). */
import { compatProvider } from '../shared/compat-provider'
import { listOpenAIModels, transcribeOpenAICompatible } from '../shared/openai-compatible'
import type { ProviderAdapter } from '../types'

export const GROQ_BASE = 'https://api.groq.com/openai/v1'
const ID = 'groq'
const isWhisper = (id: string) => /whisper/i.test(id)
const isChat = (id: string) => !isWhisper(id) && !/(tts|guard|playai|orpheus)/i.test(id)

const base = compatProvider({
  id: ID,
  name: 'Groq',
  description: 'Extremely fast open models (Llama, GPT-OSS, Qwen…) and Whisper transcription.',
  keyUrl: 'https://console.groq.com/keys',
  keyPlaceholder: 'gsk_...',
  baseUrl: GROQ_BASE,
  isChatModel: isChat,
  models: [
    { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', vision: false, contextWindow: 131_072 },
    {
      id: 'llama-3.1-8b-instant',
      name: 'Llama 3.1 8B Instant',
      vision: false,
      contextWindow: 131_072
    },
    { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', vision: false, contextWindow: 131_072 },
    { id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B', vision: false, contextWindow: 131_072 }
  ]
})

export const groqAdapter: ProviderAdapter = {
  ...base,
  async listModels(ctx, capability) {
    if (capability === 'stt')
      return (await listOpenAIModels(ctx, ID, GROQ_BASE)).filter((m) => isWhisper(m.id))
    return base.listModels!(ctx, capability)
  },
  stt: {
    models: [
      { id: 'whisper-large-v3-turbo', name: 'Whisper Large v3 Turbo' },
      { id: 'whisper-large-v3', name: 'Whisper Large v3' }
    ],
    transcribe: (ctx, req) => transcribeOpenAICompatible(ctx, ID, GROQ_BASE, req)
  }
}
