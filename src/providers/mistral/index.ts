/**
 * Mistral AI — https://docs.mistral.ai/api (OpenAI-compatible chat completions).
 * Image input is not enabled: Mistral's image part format differs slightly from OpenAI's.
 */
import { compatProvider } from '../shared/compat-provider'

export const MISTRAL_BASE = 'https://api.mistral.ai/v1'

export const mistralAdapter = compatProvider({
  id: 'mistral',
  name: 'Mistral AI',
  description: 'Mistral Large, Medium, Small and Codestral models.',
  keyUrl: 'https://console.mistral.ai/api-keys',
  keyPlaceholder: 'Your Mistral API key',
  baseUrl: MISTRAL_BASE,
  isChatModel: (id) => !/(embed|moderation|ocr|transcribe|voxtral)/i.test(id),
  models: [
    { id: 'mistral-large-latest', name: 'Mistral Large', vision: false, contextWindow: 128_000 },
    { id: 'mistral-medium-latest', name: 'Mistral Medium', vision: false, contextWindow: 128_000 },
    { id: 'mistral-small-latest', name: 'Mistral Small', vision: false, contextWindow: 128_000 },
    { id: 'codestral-latest', name: 'Codestral', vision: false, contextWindow: 256_000 }
  ]
})
