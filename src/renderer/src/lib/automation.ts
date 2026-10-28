import type { Step, StepType, Trigger, Workflow } from '@shared/automation'
import type { Capability, ProviderInfo, ProviderStatus, Settings } from '@shared/types'
import { newId } from '@shared/ids'
import { modelsFor, usableProviders, voicesFor } from './store'

const CAP: Partial<Record<StepType, Capability>> = {
  llm: 'chat',
  image: 'image',
  video: 'video',
  tts: 'tts',
  stt: 'stt'
}

export function capabilityOf(type: StepType): Capability | undefined {
  return CAP[type]
}

interface Ctx {
  providers: ProviderInfo[]
  statuses: Record<string, ProviderStatus>
  settings?: Settings
}

/** First usable provider/model for a capability (respecting the user's per-mode defaults). */
export function defaultModel(
  capability: Capability,
  ctx: Ctx
): { providerId: string; model: string } {
  const usable = usableProviders(ctx, capability)
  const mode = capability === 'chat' ? 'chat' : capability === 'image' ? 'image' : capability
  const def = ctx.settings?.defaults[mode as keyof Settings['defaults']]
  if (def && usable.some((p) => p.id === def.providerId)) return def
  const p = usable[0] ?? ctx.providers.find((x) => x.capabilities[capability])
  return {
    providerId: p?.id ?? '',
    model: (p && modelsFor(p, capability, ctx.settings)[0]?.id) ?? ''
  }
}

/** Next free stepN id across the whole workflow (including loop bodies). */
export function nextStepId(steps: Step[]): string {
  const ids = new Set<string>()
  const walk = (list: Step[]) =>
    list.forEach((s) => (ids.add(s.id), s.type === 'loop' && walk(s.steps)))
  walk(steps)
  let n = 1
  while (ids.has(`step${n}`)) n++
  return `step${n}`
}

export function newStep(type: StepType, id: string, ctx: Ctx): Step {
  const m = (cap: Capability) => defaultModel(cap, ctx)
  switch (type) {
    case 'llm':
      return { id, type, ...m('chat'), prompt: '' }
    case 'image':
      return { id, type, ...m('image'), prompt: '', count: 1 }
    case 'video':
      return { id, type, ...m('video'), prompt: '' }
    case 'tts': {
      const sel = m('tts')
      const p = ctx.providers.find((x) => x.id === sel.providerId)
      return { id, type, ...sel, voice: voicesFor(p, ctx.settings)[0]?.id ?? '', text: '' }
    }
    case 'stt':
      return { id, type, ...m('stt'), filePath: '{{input}}' }
    case 'readFile':
      return { id, type, path: '' }
    case 'writeFile':
      return { id, type, path: 'results/{{datetime}}.txt', content: '' }
    case 'http':
      return {
        id,
        type,
        method: 'POST',
        url: 'https://',
        headers: [{ name: 'Content-Type', value: 'application/json' }],
        body: ''
      }
    case 'condition':
      return {
        id,
        type,
        left: '',
        operator: 'contains',
        right: '',
        ifTrue: { action: 'next' },
        ifFalse: { action: 'stop' }
      }
    case 'delay':
      return { id, type, seconds: 5 }
    case 'loop':
      return { id, type, items: '', separator: 'lines', steps: [] }
  }
}

export function newWorkflow(name: string): Workflow {
  const now = Date.now()
  return {
    id: newId('wf_'),
    name,
    enabled: false,
    trigger: { type: 'manual' },
    steps: [],
    safety: { spendingCapUsd: 1, maxRunsPerHour: 30 },
    permissions: { writeFolders: [], httpHosts: [] },
    createdAt: now,
    updatedAt: now
  }
}

/** Variables available to a step: built-ins, trigger/batch variables and earlier steps. */
export function availableVars(trigger: Trigger, earlier: Step[], inLoop: boolean): string[] {
  const vars = ['input', 'date', 'time', 'datetime', 'workflow.name']
  if (trigger.type === 'folder') vars.push('trigger.file', 'trigger.fileName')
  if (trigger.type === 'webhook') vars.push('webhook.body')
  if (inLoop) vars.push('loop.item', 'loop.index', 'loop.count')
  for (const s of earlier) {
    vars.push(`${s.id}.output`)
    if (s.type === 'http') vars.push(`${s.id}.status`)
  }
  return vars
}

/** Replace a step anywhere in the tree. */
export function mapSteps(steps: Step[], fn: (s: Step) => Step): Step[] {
  return steps.map((s) => {
    const next = fn(s)
    return next.type === 'loop' ? { ...next, steps: mapSteps(next.steps, fn) } : next
  })
}

export function formatCost(usd: number): string {
  if (!usd) return '$0'
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`
}
