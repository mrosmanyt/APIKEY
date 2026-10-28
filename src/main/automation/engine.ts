/**
 * Workflow engine. Executes steps in order with {{variables}}, conditions (next / stop /
 * go to step), loops, spending caps, approval checks and cancellation.
 *
 * All side effects go through EngineDeps, which the AutomationService implements with the
 * app's AiService (API keys stay in the main process) — and which tests replace with fakes.
 */
import { newId } from '@shared/ids'
import { redact } from '@shared/redact'
import type {
  Approval,
  ConditionOperator,
  RunSource,
  Step,
  StepRun,
  Workflow,
  WorkflowRun
} from '@shared/automation'
import type { TokenUsage } from '@shared/types'
import { splitItems } from './csv'
import { checkRead, checkUrl, checkWrite, realPath, resolveStepPath } from './safety'
import { clockVars, renderTemplate, type Vars } from './template'

export interface EngineDeps {
  outputDir: string
  /** App data folder; workflows may never read it. */
  protectedDir: string
  /** Local webhook port; HTTP steps can never call it (prevents self-trigger loops). */
  webhookPort?: number
  llm(
    r: {
      providerId: string
      model: string
      prompt: string
      systemPrompt?: string
      temperature?: number
      maxTokens?: number
    },
    signal: AbortSignal
  ): Promise<{ text: string; usage?: TokenUsage }>
  image(
    r: {
      providerId: string
      model: string
      prompt: string
      negativePrompt?: string
      size?: string
      count: number
    },
    signal: AbortSignal
  ): Promise<string[]>
  video(
    r: {
      providerId: string
      model: string
      prompt: string
      size?: string
      durationSeconds?: number
    },
    signal: AbortSignal
  ): Promise<string>
  tts(
    r: { providerId: string; model: string; voice: string; text: string },
    signal: AbortSignal
  ): Promise<string>
  stt(
    r: { providerId: string; model: string; filePath: string; language?: string },
    signal: AbortSignal
  ): Promise<string>
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string, append: boolean): Promise<void>
  /** One request, redirects NOT followed: a 3xx comes back with its Location header. */
  http(
    r: { method: string; url: string; headers: Record<string, string>; body?: string },
    signal: AbortSignal
  ): Promise<{ status: number; body: string; location?: string }>
  sleep(ms: number, signal: AbortSignal): Promise<void>
  /** Estimated USD for a chat call (0 when the price is unknown). */
  chatCost(providerId: string, model: string, usage: TokenUsage | undefined): number
  unitCosts: { image: number; video: number; tts: number; stt: number }
  now(): number
}

export interface RunOptions {
  /** Pre-generated run id (so callers can return it before the run finishes). */
  id?: string
  workflow: Workflow
  source: RunSource
  input?: string
  vars?: Vars
  batchId?: string
  signal?: AbortSignal
  /** Called whenever the run changes (for live UI updates and persistence). */
  onUpdate?: (run: WorkflowRun) => void
  /** Extra spend already counted against the cap (e.g. the rest of a batch). */
  priorSpendUsd?: () => number
  /** Retry: resume at this top-level step with the earlier outputs. */
  resume?: { fromStepId: string; outputs: Record<string, string>; retryOf: string }
}

const MAX_STEP_EXECUTIONS = 5000
const MAX_LOOP_ITEMS = 1000
const DISPLAY_LIMIT = 20_000
const OUTPUT_LIMIT = 500_000
const INPUT_LIMIT = 2000
const SECRET_HEADER = /authorization|api[-_]?key|token|secret|cookie|password/i
export const MAX_REDIRECTS = 5
/** Sent with every HTTP step; the local webhook refuses requests carrying it. */
export const AUTOMATION_HEADER = 'X-AI-Hub-Automation'

export class ApprovalNeeded extends Error {
  constructor(readonly approval: Approval) {
    super(
      approval.kind === 'write'
        ? `This workflow wants to write outside your output folder (${approval.target}). Approve it to continue.`
        : `This workflow wants to call an external website (${approval.target}). Approve it to continue.`
    )
  }
}

class CapReached extends Error {}
class StopRun extends Error {}

function cancelledError(): Error {
  const e = new Error('Run cancelled')
  e.name = 'AbortError'
  return e
}

export function evaluateCondition(left: string, op: ConditionOperator, right = ''): boolean {
  const l = left.trim()
  const r = right.trim()
  switch (op) {
    case 'contains':
      return l.toLowerCase().includes(r.toLowerCase())
    case 'notContains':
      return !l.toLowerCase().includes(r.toLowerCase())
    case 'equals':
      return l.toLowerCase() === r.toLowerCase()
    case 'notEquals':
      return l.toLowerCase() !== r.toLowerCase()
    case 'startsWith':
      return l.toLowerCase().startsWith(r.toLowerCase())
    case 'matches':
      try {
        return new RegExp(r, 'i').test(l)
      } catch {
        throw new Error(`Invalid pattern: ${r}`)
      }
    case 'isEmpty':
      return l === ''
    case 'notEmpty':
      return l !== ''
    case 'greaterThan':
    case 'lessThan': {
      const a = Number(l.replace(',', '.'))
      const b = Number(r.replace(',', '.'))
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false
      return op === 'greaterThan' ? a > b : a < b
    }
  }
}

const SENSITIVE_ON_REDIRECT = /^(authorization|cookie|proxy-authorization)$/i

/**
 * Sends an HTTP step's request, following up to MAX_REDIRECTS redirects by hand so every hop
 * passes the same URL check (a redirect to a new host needs its own approval). Credentials are
 * dropped when a redirect leaves the original origin; 303 (and 301/302 after POST) become GET.
 */
async function followRedirects(
  req: { method: string; url: string; headers: Record<string, string>; body?: string },
  check: (url: string) => void,
  onRedirect: (hop: number, url: string) => void,
  deps: EngineDeps,
  signal: AbortSignal
): Promise<{ status: number; body: string }> {
  const origin = new URL(req.url).origin
  let current = { ...req, headers: { ...req.headers } }
  for (let hop = 0; ; hop++) {
    check(current.url)
    for (const name of Object.keys(current.headers))
      if (name.toLowerCase() === AUTOMATION_HEADER.toLowerCase()) delete current.headers[name]
    current.headers[AUTOMATION_HEADER] = '1'
    const res = await deps.http(current, signal)
    if (res.status < 300 || res.status > 399 || res.status === 304 || !res.location) return res
    if (hop >= MAX_REDIRECTS) throw new Error(`Too many redirects (more than ${MAX_REDIRECTS}).`)
    let next: string
    try {
      next = new URL(res.location, current.url).toString()
    } catch {
      throw new Error(`Invalid redirect location: ${clip(res.location, 200)}`)
    }
    onRedirect(hop + 1, next)
    const toGet =
      res.status === 303 ||
      ((res.status === 301 || res.status === 302) && current.method === 'POST')
    const headers = { ...current.headers }
    if (new URL(next).origin !== origin)
      for (const name of Object.keys(headers))
        if (SENSITIVE_ON_REDIRECT.test(name)) delete headers[name]
    if (toGet)
      for (const name of Object.keys(headers))
        if (/^content-(type|length)$/i.test(name)) delete headers[name]
    current = {
      method: toGet ? 'GET' : current.method,
      url: next,
      headers,
      body: toGet ? undefined : current.body
    }
  }
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)

export async function runWorkflow(opts: RunOptions, deps: EngineDeps): Promise<WorkflowRun> {
  const { workflow } = opts
  const signal = opts.signal ?? new AbortController().signal
  const started = deps.now()
  const run: WorkflowRun = {
    id: opts.id ?? newId('run_'),
    workflowId: workflow.id,
    workflowName: workflow.name,
    source: opts.source,
    batchId: opts.batchId,
    input: opts.input,
    vars: opts.vars ?? {},
    status: 'running',
    steps: [],
    outputs: { ...(opts.resume?.outputs ?? {}) },
    costUsd: 0,
    startedAt: started,
    retryOf: opts.resume?.retryOf
  }
  const vars: Vars = {
    ...clockVars(new Date(started)),
    'workflow.name': workflow.name,
    input: opts.input ?? '',
    ...(opts.vars ?? {})
  }
  for (const [id, out] of Object.entries(run.outputs)) vars[`${id}.output`] = out
  const update = () => opts.onUpdate?.({ ...run, steps: [...run.steps] })
  const cap = workflow.safety.spendingCapUsd
  let executions = 0

  const spend = (usd: number) => {
    if (usd > 0) run.costUsd += usd
  }
  const capReached = () => cap > 0 && run.costUsd + (opts.priorSpendUsd?.() ?? 0) >= cap

  const t = (s: string | undefined) => renderTemplate(s ?? '', vars).text

  async function execStep(step: Step, iteration?: number): Promise<string> {
    const input: Record<string, string> = {}
    const rec = (k: string, v: string | undefined) => {
      if (v !== undefined && v !== '') input[k] = redact(clip(v, INPUT_LIMIT))
    }
    const t0 = deps.now()
    const stepRun: StepRun = {
      stepId: step.id,
      name: step.name,
      type: step.type,
      iteration,
      status: 'success',
      input,
      output: '',
      startedAt: t0,
      durationMs: 0
    }
    run.steps.push(stepRun)
    update()
    const finish = (status: StepRun['status'], output = '', error?: string) => {
      stepRun.status = status
      stepRun.output = redact(clip(output, DISPLAY_LIMIT))
      stepRun.outputTruncated = output.length > DISPLAY_LIMIT || undefined
      stepRun.error = error ? redact(error) : undefined
      stepRun.durationMs = deps.now() - t0
      update()
    }
    if (step.disabled) {
      finish('skipped')
      return vars[`${step.id}.output`] ?? ''
    }
    if (signal.aborted) throw cancelledError()
    const costly = ['llm', 'image', 'video', 'tts', 'stt'].includes(step.type)
    if (costly && capReached()) {
      finish('skipped', '', 'Spending cap reached')
      throw new CapReached()
    }
    try {
      let out = ''
      switch (step.type) {
        case 'llm': {
          const prompt = t(step.prompt)
          rec('provider', `${step.providerId} / ${step.model}`)
          rec('prompt', prompt)
          rec('systemPrompt', t(step.systemPrompt))
          const r = await deps.llm(
            {
              providerId: step.providerId,
              model: step.model,
              prompt,
              systemPrompt: t(step.systemPrompt) || undefined,
              temperature: step.temperature,
              maxTokens: step.maxTokens
            },
            signal
          )
          out = r.text
          stepRun.costUsd = deps.chatCost(step.providerId, step.model, r.usage)
          break
        }
        case 'image': {
          const prompt = t(step.prompt)
          rec('provider', `${step.providerId} / ${step.model}`)
          rec('prompt', prompt)
          const count = Math.min(10, Math.max(1, step.count ?? 1))
          const files = await deps.image(
            {
              providerId: step.providerId,
              model: step.model,
              prompt,
              negativePrompt: t(step.negativePrompt) || undefined,
              size: step.size,
              count
            },
            signal
          )
          out = files.join('\n')
          stepRun.costUsd = deps.unitCosts.image * files.length
          break
        }
        case 'video': {
          const prompt = t(step.prompt)
          rec('provider', `${step.providerId} / ${step.model}`)
          rec('prompt', prompt)
          out = await deps.video(
            {
              providerId: step.providerId,
              model: step.model,
              prompt,
              size: step.size,
              durationSeconds: step.durationSeconds
            },
            signal
          )
          stepRun.costUsd = deps.unitCosts.video
          break
        }
        case 'tts': {
          const text = t(step.text)
          rec('provider', `${step.providerId} / ${step.model} / ${step.voice}`)
          rec('text', text)
          out = await deps.tts(
            { providerId: step.providerId, model: step.model, voice: step.voice, text },
            signal
          )
          stepRun.costUsd = deps.unitCosts.tts
          break
        }
        case 'stt': {
          const filePath = resolveStepPath(t(step.filePath), deps.outputDir)
          rec('provider', `${step.providerId} / ${step.model}`)
          rec('file', filePath)
          const blocked = checkRead(filePath, deps.protectedDir, deps.outputDir)
          if (blocked) throw new Error(blocked)
          out = await deps.stt(
            {
              providerId: step.providerId,
              model: step.model,
              filePath: realPath(filePath),
              language: step.language
            },
            signal
          )
          stepRun.costUsd = deps.unitCosts.stt
          break
        }
        case 'readFile': {
          const p = resolveStepPath(t(step.path), deps.outputDir)
          rec('path', p)
          const blocked = checkRead(p, deps.protectedDir, deps.outputDir)
          if (blocked) throw new Error(blocked)
          out = await deps.readFile(realPath(p))
          break
        }
        case 'writeFile': {
          const p = resolveStepPath(t(step.path), deps.outputDir)
          const content = t(step.content)
          rec('path', p)
          rec('content', content)
          // Refuse the private folder first, so the user is never asked to approve it.
          if (checkRead(p, deps.protectedDir, deps.outputDir))
            throw new Error('Workflows cannot write into AI Hub’s private data folder.')
          const approval = checkWrite(p, deps.outputDir, workflow.permissions)
          if (approval) throw new ApprovalNeeded(approval)
          await deps.writeFile(realPath(p), content, Boolean(step.append))
          out = p
          break
        }
        case 'http': {
          const url = t(step.url).trim()
          const headers: Record<string, string> = {}
          for (const h of step.headers ?? []) if (h.name.trim()) headers[h.name.trim()] = t(h.value)
          const body = step.method === 'GET' || step.method === 'DELETE' ? undefined : t(step.body)
          rec('request', `${step.method} ${url}`)
          for (const name of Object.keys(headers))
            rec(`header ${name}`, SECRET_HEADER.test(name) ? '[hidden]' : headers[name])
          rec('body', body)
          const res = await followRedirects(
            { method: step.method, url, headers, body },
            (u) => {
              const check = checkUrl(u, workflow.permissions, { webhookPort: deps.webhookPort })
              if (check.error) throw new Error(check.error)
              if (check.approval) throw new ApprovalNeeded(check.approval)
            },
            (hop, next) => rec(`redirect ${hop}`, next),
            deps,
            signal
          )
          vars[`${step.id}.status`] = String(res.status)
          out = res.body
          if (res.status >= 400) {
            vars[`${step.id}.output`] = out
            throw new Error(`HTTP ${res.status}: ${clip(res.body, 300)}`)
          }
          break
        }
        case 'delay': {
          const secs = Math.min(24 * 3600, Math.max(0, Number(step.seconds) || 0))
          rec('seconds', String(secs))
          await deps.sleep(secs * 1000, signal)
          break
        }
        case 'condition':
        case 'loop':
          throw new Error('internal: handled by execList')
      }
      spend(stepRun.costUsd ?? 0)
      if (out.length > OUTPUT_LIMIT) out = out.slice(0, OUTPUT_LIMIT)
      vars[`${step.id}.output`] = out
      finish('success', out)
      return out
    } catch (err) {
      spend(stepRun.costUsd ?? 0)
      const aborted = signal.aborted || (err as Error)?.name === 'AbortError'
      finish(
        aborted ? 'cancelled' : 'failed',
        '',
        aborted ? 'Cancelled' : err instanceof Error ? err.message : String(err)
      )
      throw aborted ? cancelledError() : err
    }
  }

  async function execList(steps: Step[], iteration?: number, startIndex = 0): Promise<void> {
    let i = startIndex
    while (i < steps.length) {
      if (++executions > MAX_STEP_EXECUTIONS)
        throw new Error('Too many steps executed — check your conditions for an endless loop.')
      if (signal.aborted) throw cancelledError()
      const step = steps[i]
      if (step.type === 'condition' && !step.disabled) {
        const left = t(step.left)
        const right = t(step.right)
        const t0 = deps.now()
        let result: boolean
        try {
          result = evaluateCondition(left, step.operator, right)
        } catch (err) {
          run.steps.push({
            stepId: step.id,
            name: step.name,
            type: 'condition',
            iteration,
            status: 'failed',
            input: { left: clip(left, INPUT_LIMIT) },
            output: '',
            error: String((err as Error).message),
            startedAt: t0,
            durationMs: 0
          })
          throw err
        }
        const branch = result ? step.ifTrue : step.ifFalse
        vars[`${step.id}.output`] = String(result)
        run.steps.push({
          stepId: step.id,
          name: step.name,
          type: 'condition',
          iteration,
          status: 'success',
          input: {
            left: redact(clip(left, INPUT_LIMIT)),
            operator: step.operator,
            right: redact(clip(right, INPUT_LIMIT))
          },
          output: `${result} → ${branch.action === 'goto' ? `go to ${branch.stepId}` : branch.action}`,
          startedAt: t0,
          durationMs: 0
        })
        update()
        if (branch.action === 'stop') throw new StopRun()
        if (branch.action === 'goto') {
          const target = steps.findIndex((s) => s.id === branch.stepId)
          if (target < 0)
            throw new Error(
              `Condition ${step.id}: step "${branch.stepId}" not found at this level.`
            )
          i = target
          continue
        }
        i++
        continue
      }
      if (step.type === 'loop' && !step.disabled) {
        const raw = t(step.items)
        const t0 = deps.now()
        let items: string[]
        try {
          items = splitItems(raw, step.separator)
        } catch (err) {
          run.steps.push({
            stepId: step.id,
            name: step.name,
            type: 'loop',
            iteration,
            status: 'failed',
            input: { items: clip(raw, INPUT_LIMIT) },
            output: '',
            error: (err as Error).message,
            startedAt: t0,
            durationMs: 0
          })
          throw err
        }
        const limit = Math.min(MAX_LOOP_ITEMS, step.maxItems || MAX_LOOP_ITEMS)
        items = items.slice(0, limit)
        const loopRun: StepRun = {
          stepId: step.id,
          name: step.name,
          type: 'loop',
          iteration,
          status: 'success',
          input: { items: `${items.length} items` },
          output: '',
          startedAt: t0,
          durationMs: 0
        }
        run.steps.push(loopRun)
        const results: string[] = []
        const last = step.steps[step.steps.length - 1]
        for (let k = 0; k < items.length; k++) {
          vars['loop.item'] = items[k]
          vars['loop.index'] = String(k + 1)
          vars['loop.count'] = String(items.length)
          await execList(step.steps, k + 1)
          if (last) results.push(vars[`${last.id}.output`] ?? '')
        }
        delete vars['loop.item']
        delete vars['loop.index']
        const out = results.join('\n')
        vars[`${step.id}.output`] = out
        loopRun.output = redact(clip(out, DISPLAY_LIMIT))
        loopRun.durationMs = deps.now() - t0
        if (iteration === undefined) run.outputs[step.id] = out
        update()
        i++
        continue
      }
      const out = await execStep(step, iteration)
      if (iteration === undefined) run.outputs[step.id] = out.slice(0, OUTPUT_LIMIT)
      if (capReached() && i < steps.length - 1) throw new CapReached()
      i++
    }
  }

  const topIndexOf = (stepId: string | undefined) =>
    workflow.steps.findIndex((s) => s.id === stepId)
  let start = 0
  if (opts.resume) {
    start = topIndexOf(opts.resume.fromStepId)
    if (start < 0) start = 0
  }

  try {
    await execList(workflow.steps, undefined, start)
    run.status = 'success'
  } catch (err) {
    // The failed top-level step: the last step run without an iteration, or the loop containing it.
    const lastTop = [...run.steps].reverse().find((s) => s.iteration === undefined)
    if (err instanceof StopRun) {
      run.status = 'success'
    } else if (err instanceof CapReached) {
      run.status = 'capped'
      run.error = `Stopped: the spending cap of $${cap.toFixed(2)} was reached (estimated $${(run.costUsd + (opts.priorSpendUsd?.() ?? 0)).toFixed(4)}).`
    } else if (err instanceof ApprovalNeeded) {
      run.status = 'needs_approval'
      run.approval = err.approval
      run.error = err.message
      run.failedStepId = lastTop?.stepId
    } else if ((err as Error)?.name === 'AbortError') {
      run.status = 'cancelled'
      run.error = 'Cancelled'
      run.failedStepId = lastTop?.stepId
    } else {
      run.status = 'failed'
      run.error = redact(err instanceof Error ? err.message : String(err))
      run.failedStepId = lastTop?.stepId
    }
  }
  run.finishedAt = deps.now()
  run.durationMs = run.finishedAt - started
  update()
  return run
}
