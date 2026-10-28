/**
 * Stability AI — https://platform.stability.ai/docs/api-reference
 * Stable Image (v2beta) generation, image-to-image and upscaling. Responses are raw image
 * bytes (Accept: image/*); errors are JSON ({ name, errors: [...] }).
 */
import type { ImageModelInfo } from '@shared/types'
import { contentPolicyError, ProviderError } from '../errors'
import { fetchWithRetry, requestJson } from '../http'
import type { ImageInput, ImageOutput, ProviderAdapter, ProviderContext } from '../types'

export const STABILITY_BASE = 'https://api.stability.ai'
const ID = 'stability'
const RATIOS = ['1:1', '16:9', '9:16', '3:2', '2:3', '4:5', '5:4', '21:9', '9:21']

const MODELS: ImageModelInfo[] = [
  // TODO(verify): Ultra's image-to-image (image + strength) is newer than its text-to-image API.
  {
    id: 'stable-image-ultra',
    name: 'Stable Image Ultra',
    sizes: RATIOS,
    maxCount: 4,
    supportsNegativePrompt: true,
    supportsReference: true,
    referenceBeta: true
  },
  {
    id: 'stable-image-core',
    name: 'Stable Image Core',
    sizes: RATIOS,
    maxCount: 4,
    supportsNegativePrompt: true
  },
  {
    id: 'sd3.5-large',
    name: 'Stable Diffusion 3.5 Large',
    sizes: RATIOS,
    maxCount: 4,
    supportsNegativePrompt: true,
    supportsReference: true
  },
  {
    id: 'sd3.5-large-turbo',
    name: 'Stable Diffusion 3.5 Large Turbo',
    sizes: RATIOS,
    maxCount: 4,
    supportsNegativePrompt: false,
    supportsReference: true
  },
  {
    id: 'sd3.5-medium',
    name: 'Stable Diffusion 3.5 Medium',
    sizes: RATIOS,
    maxCount: 4,
    supportsNegativePrompt: true,
    supportsReference: true
  }
]

/** Which v2beta endpoint and form fields a model uses. */
export function stabilityEndpoint(model: string): { path: string; modelField?: string } {
  if (model === 'stable-image-ultra') return { path: '/v2beta/stable-image/generate/ultra' }
  if (model === 'stable-image-core') return { path: '/v2beta/stable-image/generate/core' }
  return { path: '/v2beta/stable-image/generate/sd3', modelField: model }
}

const ext = (mime: string) => (mime.split('/')[1] ?? 'png').replace('jpeg', 'jpg')

export function buildStabilityForm(req: {
  model: string
  prompt: string
  negativePrompt?: string
  size?: string
  reference?: ImageInput
  strength?: number
}): FormData {
  const { modelField } = stabilityEndpoint(req.model)
  const form = new FormData()
  form.append('prompt', req.prompt)
  form.append('output_format', 'png')
  if (modelField) form.append('model', modelField)
  if (req.negativePrompt?.trim()) form.append('negative_prompt', req.negativePrompt)
  if (req.reference) {
    // Image-to-image: aspect ratio comes from the reference image.
    if (modelField) form.append('mode', 'image-to-image')
    form.append(
      'image',
      new Blob([new Uint8Array(req.reference.data)], { type: req.reference.mime }),
      `reference.${ext(req.reference.mime)}`
    )
    form.append('strength', String(req.strength ?? 0.6))
  } else if (req.size && req.size !== 'default') {
    form.append('aspect_ratio', req.size)
  }
  return form
}

async function postForImage(
  ctx: ProviderContext,
  path: string,
  form: FormData
): Promise<ImageOutput> {
  const res = await fetchWithRetry(ctx, ID, `${STABILITY_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ctx.apiKey}`, Accept: 'image/*' },
    body: form
  })
  // Filtered results are returned as HTTP 200 with a blurred image and this header.
  if ((res.headers.get('finish-reason') ?? '').toUpperCase() === 'CONTENT_FILTERED') {
    throw contentPolicyError(ID, 'Stability AI filtered this image (content moderation).')
  }
  return {
    data: Buffer.from(await res.arrayBuffer()),
    mime: res.headers.get('content-type')?.split(';')[0] || 'image/png'
  }
}

export const stabilityAdapter: ProviderAdapter = {
  id: ID,
  name: 'Stability AI',
  description:
    'Stable Image Ultra/Core and Stable Diffusion 3.5 image generation, image-to-image and upscaling.',
  keyUrl: 'https://platform.stability.ai/account/keys',
  keyPlaceholder: 'sk-...',

  async testKey(ctx) {
    await requestJson(ctx, ID, `${STABILITY_BASE}/v1/user/account`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${ctx.apiKey}` }
    })
  },

  image: {
    models: MODELS,
    async generate(ctx, req) {
      if (req.reference && !MODELS.find((m) => m.id === req.model)?.supportsReference) {
        throw new ProviderError({
          kind: 'unsupported',
          providerId: ID,
          message: `${req.model} does not support reference images.`
        })
      }
      const out: ImageOutput[] = []
      for (let i = 0; i < Math.max(1, req.count); i++) {
        out.push(
          await postForImage(ctx, stabilityEndpoint(req.model).path, buildStabilityForm(req))
        )
      }
      return out
    },
    // TODO(verify): fast upscaler endpoint path and limits.
    upscaleBeta: true,
    async upscale(ctx, image) {
      const form = new FormData()
      form.append(
        'image',
        new Blob([new Uint8Array(image.data)], { type: image.mime }),
        `image.${ext(image.mime)}`
      )
      form.append('output_format', 'png')
      return postForImage(ctx, '/v2beta/stable-image/upscale/fast', form)
    }
  }
}
