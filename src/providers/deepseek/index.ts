/** DeepSeek — https://api-docs.deepseek.com (OpenAI-compatible). */
import { compatProvider } from '../shared/compat-provider'

export const DEEPSEEK_BASE = 'https://api.deepseek.com'

export const deepseekAdapter = compatProvider({
  id: 'deepseek',
  name: 'DeepSeek',
  description: 'DeepSeek V3 chat and R1 reasoning models at low prices.',
  keyUrl: 'https://platform.deepseek.com/api_keys',
  keyPlaceholder: 'sk-...',
  baseUrl: DEEPSEEK_BASE,
  includeStreamUsage: true,
  models: [
    { id: 'deepseek-chat', name: 'DeepSeek Chat (V3)', vision: false, contextWindow: 128_000 },
    {
      id: 'deepseek-reasoner',
      name: 'DeepSeek Reasoner (R1)',
      vision: false,
      contextWindow: 128_000
    }
  ]
})
