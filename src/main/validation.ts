/** zod schemas for everything the renderer can send. Inputs are never trusted. */
import { z } from 'zod'
import { CAPABILITIES } from '@shared/types'

const MB = 1024 * 1024

export const zId = z.string().min(1).max(200)
export const zProviderId = z.string().regex(/^[a-z0-9_-]{1,40}$/)
export const zCapability = z.enum(CAPABILITIES as [string, ...string[]])

const ERROR_KINDS = [
  'invalid_key',
  'quota',
  'rate_limit',
  'network',
  'model_not_found',
  'content_policy',
  'bad_request',
  'server',
  'cancelled',
  'not_configured',
  'unsupported',
  'invalid_license',
  'unknown'
] as const

export const zErrorInfo = z.object({
  kind: z.enum(ERROR_KINDS),
  message: z.string(),
  details: z.string().optional(),
  status: z.number().optional(),
  providerId: z.string().optional()
})

export const zAttachment = z.object({
  id: zId,
  name: z.string().max(500),
  mime: z.string().max(200),
  kind: z.enum(['image', 'text']),
  size: z.number().nonnegative(),
  dataBase64: z
    .string()
    .max(30 * MB)
    .optional(),
  text: z
    .string()
    .max(4 * MB)
    .optional()
})

const zUsage = z.object({ inputTokens: z.number().optional(), outputTokens: z.number().optional() })

export const zChatRequest = z.object({
  providerId: zProviderId,
  model: z.string().min(1).max(300),
  systemPrompt: z.string().max(200_000).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(2_000_000),
        attachments: z.array(zAttachment).max(20).optional()
      })
    )
    .min(1)
    .max(2000),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(1_000_000).optional()
})

export const zConversation = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  title: z.string().max(500),
  mode: z.enum(['chat', 'code']),
  providerId: z.string().max(40),
  model: z.string().max(300),
  systemPrompt: z.string().max(200_000),
  temperature: z.number(),
  maxTokens: z.number(),
  messages: z.array(
    z.object({
      id: zId,
      role: z.enum(['user', 'assistant']),
      content: z.string(),
      attachments: z.array(zAttachment).optional(),
      createdAt: z.number(),
      providerId: z.string().optional(),
      model: z.string().optional(),
      usage: zUsage.optional(),
      error: zErrorInfo.optional()
    })
  ),
  createdAt: z.number(),
  updatedAt: z.number()
})

export const zImageRequest = z.object({
  providerId: zProviderId,
  model: z.string().min(1).max(300),
  prompt: z.string().min(1).max(32_000),
  negativePrompt: z.string().max(8000).optional(),
  size: z.string().max(40).optional(),
  count: z.number().int().min(1).max(10)
})

export const zTtsRequest = z.object({
  providerId: zProviderId,
  model: z.string().min(1).max(300),
  voice: z.string().min(1).max(300),
  text: z.string().min(1).max(100_000)
})

export const zSttRequest = z.object({
  providerId: zProviderId,
  model: z.string().min(1).max(300),
  audioBase64: z
    .string()
    .min(1)
    .max(120 * MB),
  mime: z.string().max(200),
  fileName: z.string().max(500),
  language: z.string().max(20).optional()
})

export const zVideoRequest = z.object({
  providerId: zProviderId,
  model: z.string().min(1).max(300),
  prompt: z.string().min(1).max(32_000),
  imageBase64: z
    .string()
    .max(30 * MB)
    .optional(),
  imageMime: z.string().max(100).optional(),
  size: z.string().max(40).optional(),
  durationSeconds: z.number().int().min(1).max(120).optional()
})

const zModeDefault = z.object({ providerId: z.string().max(40), model: z.string().max(300) })

export const zSettingsPatch = z
  .object({
    theme: z.enum(['system', 'light', 'dark']),
    language: z.string().max(20),
    outputDir: z.string().max(2000),
    defaults: z.record(z.string(), zModeDefault.optional()),
    chat: z.object({
      temperature: z.number().min(0).max(2),
      maxTokens: z.number().int().min(1).max(1_000_000)
    })
  })
  .partial()

export const zConfig = z.record(z.string().max(100), z.string().max(2000))

export const zPrompt = z.object({
  id: zId,
  title: z.string().min(1).max(300),
  content: z.string().max(200_000),
  mode: z.enum(['any', 'chat', 'code', 'image', 'video', 'tts']),
  favourite: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number()
})
