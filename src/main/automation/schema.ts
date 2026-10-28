/** zod schemas for workflows (IPC input and imported packs are never trusted). */
import { z } from 'zod'
import { CONDITION_OPERATORS, type Step, type Workflow } from '@shared/automation'

const str = (max = 100_000) => z.string().max(max)
const zStepId = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]{0,39}$/, 'Step ids use letters, numbers, - and _')
const zPid = z.string().regex(/^[a-z0-9_-]{1,40}$/)
const zModel = z.string().min(1).max(300)
const zBranch = z.union([
  z.object({ action: z.literal('next') }),
  z.object({ action: z.literal('stop') }),
  z.object({ action: z.literal('goto'), stepId: zStepId })
])

const base = { id: zStepId, name: str(200).optional(), disabled: z.boolean().optional() }

export const zStep: z.ZodType<Step> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({
      ...base,
      type: z.literal('llm'),
      providerId: zPid,
      model: zModel,
      prompt: str(),
      systemPrompt: str().optional(),
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().int().min(1).max(1_000_000).optional()
    }),
    z.object({
      ...base,
      type: z.literal('image'),
      providerId: zPid,
      model: zModel,
      prompt: str(),
      negativePrompt: str().optional(),
      size: str(40).optional(),
      count: z.number().int().min(1).max(10).optional()
    }),
    z.object({
      ...base,
      type: z.literal('video'),
      providerId: zPid,
      model: zModel,
      prompt: str(),
      size: str(40).optional(),
      durationSeconds: z.number().int().min(1).max(120).optional()
    }),
    z.object({
      ...base,
      type: z.literal('tts'),
      providerId: zPid,
      model: zModel,
      voice: str(300),
      text: str()
    }),
    z.object({
      ...base,
      type: z.literal('stt'),
      providerId: zPid,
      model: zModel,
      filePath: str(2000),
      language: str(20).optional()
    }),
    z.object({ ...base, type: z.literal('readFile'), path: str(2000) }),
    z.object({
      ...base,
      type: z.literal('writeFile'),
      path: str(2000),
      content: str(),
      append: z.boolean().optional()
    }),
    z.object({
      ...base,
      type: z.literal('http'),
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
      url: str(4000),
      headers: z
        .array(z.object({ name: str(200), value: str(4000) }))
        .max(50)
        .optional(),
      body: str().optional()
    }),
    z.object({
      ...base,
      type: z.literal('condition'),
      left: str(),
      operator: z.enum(CONDITION_OPERATORS as [string, ...string[]]) as z.ZodType<
        (typeof CONDITION_OPERATORS)[number]
      >,
      right: str().optional(),
      ifTrue: zBranch,
      ifFalse: zBranch
    }),
    z.object({ ...base, type: z.literal('delay'), seconds: z.number().min(0).max(86_400) }),
    z.object({
      ...base,
      type: z.literal('loop'),
      items: str(),
      separator: z.enum(['lines', 'json', 'comma']).optional(),
      maxItems: z.number().int().min(1).max(1000).optional(),
      steps: z.array(zStep).max(100)
    })
  ])
) as z.ZodType<Step>

export const zTrigger = z.discriminatedUnion('type', [
  z.object({ type: z.literal('manual') }),
  z.object({
    type: z.literal('schedule'),
    preset: z.enum(['hourly', 'daily', 'weekly', 'custom']),
    minute: z.number().int().min(0).max(59).optional(),
    time: z
      .string()
      .regex(/^\d{1,2}:\d{2}$/)
      .optional(),
    weekday: z.number().int().min(0).max(6).optional(),
    cron: str(200).optional()
  }),
  z.object({ type: z.literal('folder'), folder: str(2000), pattern: str(300).optional() }),
  z.object({ type: z.literal('webhook') })
])

export const zSafety = z.object({
  spendingCapUsd: z.number().min(0).max(100_000),
  maxRunsPerHour: z.number().int().min(0).max(10_000)
})

export const zPermissions = z.object({
  writeFolders: z.array(str(2000)).max(100),
  httpHosts: z.array(str(300)).max(100)
})

const workflowFields = {
  id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  name: z.string().min(1).max(200),
  description: str(5000).optional(),
  enabled: z.boolean(),
  trigger: zTrigger,
  steps: z.array(zStep).max(200),
  safety: zSafety,
  templateId: str(100).optional(),
  createdAt: z.number(),
  updatedAt: z.number()
}

export const zWorkflow: z.ZodType<Workflow> = z.object({
  ...workflowFields,
  permissions: zPermissions
}) as z.ZodType<Workflow>

/** Workflows inside an imported pack: permissions are ignored even if present. */
export const zPackWorkflow = z
  .object({
    ...workflowFields,
    permissions: zPermissions.optional(),
    enabled: z.boolean().optional()
  })
  .passthrough()

/** All step ids in a workflow, including loop bodies. */
export function allSteps(steps: Step[]): Step[] {
  return steps.flatMap((s) => (s.type === 'loop' ? [s, ...allSteps(s.steps)] : [s]))
}

/** Extra checks zod cannot express: unique ids and valid goto targets. */
export function validateWorkflow(w: Workflow): string[] {
  const problems: string[] = []
  const ids = allSteps(w.steps).map((s) => s.id)
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
  if (dupes.length) problems.push(`Duplicate step ids: ${[...new Set(dupes)].join(', ')}`)
  const checkLevel = (steps: Step[]) => {
    const here = new Set(steps.map((s) => s.id))
    for (const s of steps) {
      if (s.type === 'condition') {
        for (const b of [s.ifTrue, s.ifFalse]) {
          if (b.action === 'goto' && !here.has(b.stepId))
            problems.push(`${s.id}: "go to ${b.stepId}" must point to a step in the same list`)
        }
      }
      if (s.type === 'loop') checkLevel(s.steps)
    }
  }
  checkLevel(w.steps)
  if (w.trigger.type === 'folder' && !w.trigger.folder.trim() && w.enabled)
    problems.push('Choose a folder to watch.')
  return problems
}
