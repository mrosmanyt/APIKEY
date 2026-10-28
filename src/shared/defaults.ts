import type { Settings } from './types'

export const APP_NAME = 'AI Hub'

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  language: 'en',
  outputDir: '',
  defaults: {},
  chat: { temperature: 0.7, maxTokens: 4096 },
  providerConfig: {},
  modelCache: {},
  voiceCache: {}
}

export const CODE_SYSTEM_PROMPT = `You are an expert software engineer and pair programmer.
- Give correct, idiomatic, production-quality code.
- Always put code in fenced code blocks with the language tag, and when a block is a complete file, put the file name on the first line as a comment (e.g. "// src/utils.ts").
- Keep explanations short and focused; prefer showing code.
- Point out edge cases, security issues and needed dependencies.
- When modifying code, show the complete updated function or file unless asked for a diff.`
