/**
 * Automation orchestrator. Nothing here runs unless the module is enabled in Settings:
 * `apply()` starts the scheduler, folder watchers and (optional) webhook server only when
 * `settings.automation.enabled` is true, and stops all of them — and cancels running work —
 * when it is turned off.
 *
 * Workflows call AI providers only through AiService / VideoService, so API keys stay
 * encrypted in the main process and never appear in workflows, runs, logs or exports.
 */
import fs from 'node:fs'
import path from 'node:path'
import { newId } from '@shared/ids'
import type {
  Approval,
  AutomationSettings,
  BatchJob,
  BatchSource,
  RunSource,
  Workflow,
  WorkflowRun,
  WebhookInfo
} from '@shared/automation'
import type { TokenUsage } from '@shared/types'
import type { AiService } from '../services/ai'
import { outputDir, type AppContext } from '../services/context'
import type { VideoService } from '../services/video'
import { CollectionStore, JsonStore } from '../storage/jsonStore'
import { nextCronTime, scheduleToCron, validateCron } from './cron'
import { csvToRecords, txtLines } from './csv'
import { runWorkflow, type EngineDeps } from './engine'
import { exportPack, importPack } from './io'
import { checkUrl, checkWrite, resolveStepPath, runsInLastHour } from './safety'
import { allSteps, validateWorkflow } from './schema'
import { rowVars, templateVariables, type Vars } from './template'
import { applyDefaults, TEMPLATES, type DefaultModels } from './templates'
import { FolderWatcher, listMatchingFiles } from './watcher'
import { newToken, WebhookServer } from './webhook'

export interface AutomationHooks {
  emit(channel: string, payload: unknown): void
  notify(title: string, body: string): void
  windowFocused(): boolean
}

const MAX_RUNS_KEPT = 500
const MAX_BATCH_ITEMS = 10_000
const MAX_READ_BYTES = 10 * 1024 * 1024
const MAX_AUDIO_BYTES = 100 * 1024 * 1024
const MAX_HTTP_BYTES = 2 * 1024 * 1024
const HTTP_TIMEOUT_MS = 60_000
const VIDEO_TIMEOUT_MS = 70 * 60_000
const MAX_TIMER_MS = 24 * 3600_000

const AUDIO_MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm',
  '.flac': 'audio/flac'
}

interface BatchItem {
  input: string
  vars: Vars
}

interface BatchState {
  items: BatchItem[]
  controllers: Set<AbortController>
}

function abortError(): Error {
  const e = new Error('Cancelled')
  e.name = 'AbortError'
  return e
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export class AutomationService {
  readonly workflows: CollectionStore<Workflow>
  readonly runs: CollectionStore<WorkflowRun>
  readonly batches: CollectionStore<BatchJob>
  private readonly meta: JsonStore<{ webhookToken?: string }>
  private readonly active = new Map<string, AbortController>()
  private readonly live = new Map<string, WorkflowRun>()
  private readonly schedules = new Map<string, { timer: NodeJS.Timeout; next: number }>()
  private readonly watchers = new Map<string, FolderWatcher>()
  private readonly batchState = new Map<string, BatchState>()
  private webhook?: WebhookServer
  private webhookError?: string
  private started = false

  constructor(
    private readonly app: AppContext,
    private readonly ai: AiService,
    private readonly video: VideoService,
    private readonly hooks: AutomationHooks,
    private readonly dirs: { dataDir: string; protectedDir: string }
  ) {
    const p = (f: string) => path.join(dirs.dataDir, f)
    this.workflows = new CollectionStore<Workflow>(p('automation-workflows.json'))
    this.runs = new CollectionStore<WorkflowRun>(p('automation-runs.json'))
    this.batches = new CollectionStore<BatchJob>(p('automation-batches.json'))
    this.meta = new JsonStore(p('automation.json'), () => ({}))
  }

  get settings(): AutomationSettings {
    return this.app.storage.settings.get().automation
  }

  isEnabled(): boolean {
    return this.settings.enabled
  }

  isRunning(): boolean {
    return this.started
  }

  // ------------------------------------------------------------------ lifecycle

  /** Start or stop everything to match the settings. Call on startup and on every change. */
  async apply(): Promise<void> {
    if (this.isEnabled()) {
      if (!this.started) {
        this.started = true
        this.app.logger.info('Automation started')
        // Batches that were running when the app closed resume only when the user says so.
        for (const b of this.batches.all()) {
          if (b.status === 'running')
            this.batches.patch(b.id, { status: 'paused', running: 0, nextIndex: b.done + b.failed })
        }
      }
      this.reloadTriggers()
      await this.applyWebhook()
    } else if (this.started) {
      await this.stopAll()
    }
  }

  private async stopAll(): Promise<void> {
    this.started = false
    for (const { timer } of this.schedules.values()) clearTimeout(timer)
    this.schedules.clear()
    for (const w of this.watchers.values()) w.stop()
    this.watchers.clear()
    await this.webhook?.stop()
    this.webhook = undefined
    for (const c of this.active.values()) c.abort()
    for (const b of this.batches.all())
      if (b.status === 'running') this.batches.patch(b.id, { status: 'paused' })
    this.app.logger.info('Automation stopped')
  }

  async shutdown(): Promise<void> {
    if (this.started) await this.stopAll()
  }

  /** (Re)create schedules and folder watchers for enabled workflows. */
  reloadTriggers(): void {
    for (const { timer } of this.schedules.values()) clearTimeout(timer)
    this.schedules.clear()
    for (const w of this.watchers.values()) w.stop()
    this.watchers.clear()
    if (!this.started) return
    for (const wf of this.workflows.all()) {
      if (!wf.enabled) continue
      if (wf.trigger.type === 'schedule') this.armSchedule(wf)
      if (wf.trigger.type === 'folder' && wf.trigger.folder.trim()) {
        const folder = wf.trigger.folder
        if (!fs.existsSync(folder)) {
          this.app.logger.warn(`Automation: watched folder does not exist for "${wf.name}"`)
          continue
        }
        const watcher = new FolderWatcher(
          folder,
          wf.trigger.pattern,
          (file) => {
            void this.trigger(wf.id, 'folder', file, {
              'trigger.file': file,
              'trigger.fileName': path.basename(file)
            })
          },
          3000,
          (err) =>
            this.app.logger.warn(`Automation: folder watch error for "${wf.name}"`, err.message)
        )
        watcher.start()
        this.watchers.set(wf.id, watcher)
      }
    }
  }

  private armSchedule(wf: Workflow): void {
    if (wf.trigger.type !== 'schedule') return
    const cron = scheduleToCron(wf.trigger)
    if (validateCron(cron)) return
    const next = nextCronTime(cron, new Date())
    if (!next) return
    const delay = next.getTime() - Date.now()
    const timer = setTimeout(
      () => {
        if (Date.now() + 1000 < next.getTime()) {
          // Long delays are re-armed in chunks (setTimeout max ≈ 24.8 days).
          const fresh = this.workflows.get(wf.id)
          if (fresh) this.armSchedule(fresh)
          return
        }
        void this.trigger(wf.id, 'schedule')
        const fresh = this.workflows.get(wf.id)
        if (fresh?.enabled && this.started) this.armSchedule(fresh)
      },
      Math.min(Math.max(0, delay), MAX_TIMER_MS)
    )
    this.schedules.set(wf.id, { timer, next: next.getTime() })
  }

  nextScheduledRuns(): Record<string, number> {
    return Object.fromEntries([...this.schedules.entries()].map(([id, s]) => [id, s.next]))
  }

  // ------------------------------------------------------------------ webhook

  private token(): string {
    let t = this.meta.read().webhookToken
    if (!t) {
      t = newToken()
      this.meta.update((m) => ({ ...m, webhookToken: t }))
    }
    return t
  }

  regenerateToken(): WebhookInfo {
    this.meta.update((m) => ({ ...m, webhookToken: newToken() }))
    return this.webhookInfo()
  }

  private async applyWebhook(): Promise<void> {
    const s = this.settings
    const wanted = this.started && s.webhookEnabled
    if (!wanted || (this.webhook && this.webhook.port !== s.webhookPort)) {
      await this.webhook?.stop()
      this.webhook = undefined
    }
    if (!wanted || this.webhook) return
    const server = new WebhookServer(
      () => this.token(),
      async (workflowId, body) => {
        const wf = this.workflows.get(workflowId)
        if (!wf || !wf.enabled || wf.trigger.type !== 'webhook')
          return { status: 404, json: { error: 'No enabled webhook workflow with this id' } }
        const runId = await this.trigger(workflowId, 'webhook', body, { 'webhook.body': body })
        return runId
          ? { status: 202, json: { runId } }
          : { status: 429, json: { error: 'Run limit reached (max runs per hour)' } }
      }
    )
    try {
      await server.start(s.webhookPort)
      this.webhook = server
      this.webhookError = undefined
      this.app.logger.info(`Automation webhook listening on 127.0.0.1:${server.port}`)
    } catch (err) {
      this.webhookError =
        (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
          ? `Port ${s.webhookPort} is already in use. Choose another port.`
          : String((err as Error).message)
      this.app.logger.warn('Automation webhook could not start', this.webhookError)
    }
  }

  webhookInfo(): WebhookInfo {
    const port = this.webhook?.port || this.settings.webhookPort
    return {
      enabled: this.settings.webhookEnabled,
      running: Boolean(this.webhook?.running),
      baseUrl: `http://127.0.0.1:${port}`,
      token: this.token(),
      error: this.webhookError
    }
  }

  // ------------------------------------------------------------------ workflows

  listWorkflows(): Workflow[] {
    return [...this.workflows.all()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  saveWorkflow(w: Workflow): Workflow {
    const problems = validateWorkflow(w)
    if (problems.length) throw new Error(problems.join('\n'))
    const existing = this.workflows.get(w.id)
    // Approvals can only be added through approve(); the editor cannot grant them.
    const saved = this.workflows.upsert({
      ...w,
      permissions: existing?.permissions ?? { writeFolders: [], httpHosts: [] },
      createdAt: existing?.createdAt ?? w.createdAt,
      updatedAt: Date.now()
    })
    this.reloadTriggers()
    this.hooks.emit('automation:changed', null)
    return saved
  }

  deleteWorkflow(id: string): void {
    this.workflows.remove(id)
    this.reloadTriggers()
    this.hooks.emit('automation:changed', null)
  }

  /** Remove an approved folder/host from a workflow. */
  revokePermission(
    workflowId: string,
    kind: Approval['kind'],
    target: string
  ): Workflow | undefined {
    const wf = this.workflows.get(workflowId)
    if (!wf) return undefined
    const perms =
      kind === 'write'
        ? {
            ...wf.permissions,
            writeFolders: wf.permissions.writeFolders.filter((f) => f !== target)
          }
        : { ...wf.permissions, httpHosts: wf.permissions.httpHosts.filter((h) => h !== target) }
    return this.workflows.patch(workflowId, { permissions: perms, updatedAt: Date.now() })
  }

  templates() {
    return TEMPLATES
  }

  createFromTemplate(templateId: string, defaults: DefaultModels): Workflow {
    const tpl = TEMPLATES.find((t) => t.id === templateId)
    if (!tpl) throw new Error('Unknown template')
    const now = Date.now()
    const wf: Workflow = {
      ...structuredClone(tpl.workflow),
      steps: applyDefaults(structuredClone(tpl.workflow.steps), defaults),
      id: newId('wf_'),
      description: tpl.description,
      templateId,
      enabled: false,
      permissions: { writeFolders: [], httpHosts: [] },
      createdAt: now,
      updatedAt: now
    }
    this.workflows.upsert(wf)
    this.hooks.emit('automation:changed', null)
    return wf
  }

  /**
   * Approvals a manual run needs that can be known before running (literal paths/URLs, not
   * built from {{variables}}). The UI asks the user to confirm these first.
   */
  preflight(workflowId: string): Approval[] {
    const wf = this.requireWorkflow(workflowId)
    const out = outputDir(this.app)
    const found = new Map<string, Approval>()
    for (const s of allSteps(wf.steps)) {
      if (s.disabled) continue
      if (s.type === 'writeFile' && templateVariables(s.path).length === 0 && s.path.trim()) {
        const a = checkWrite(resolveStepPath(s.path, out), out, wf.permissions)
        if (a) found.set(`${a.kind}:${a.target}`, a)
      }
      if (s.type === 'http' && templateVariables(s.url).length === 0) {
        const a = checkUrl(s.url.trim(), wf.permissions).approval
        if (a) found.set(`${a.kind}:${a.target}`, a)
      }
    }
    return [...found.values()]
  }

  /** The user confirmed: allow this workflow to write to these folders / call these hosts. */
  approve(workflowId: string, approvals: Approval[]): Workflow {
    const wf = this.requireWorkflow(workflowId)
    const writeFolders = new Set(wf.permissions.writeFolders)
    const httpHosts = new Set(wf.permissions.httpHosts)
    for (const a of approvals) {
      if (a.kind === 'write') writeFolders.add(path.resolve(a.target))
      else httpHosts.add(a.target.toLowerCase())
    }
    this.app.logger.info(`Automation: approvals added to "${wf.name}"`, approvals)
    return this.workflows.patch(workflowId, {
      permissions: { writeFolders: [...writeFolders], httpHosts: [...httpHosts] },
      updatedAt: Date.now()
    })!
  }

  exportWorkflows(ids: string[]): string {
    const list = ids.length
      ? ids.map((id) => this.workflows.get(id)).filter((w): w is Workflow => Boolean(w))
      : this.workflows.all()
    return JSON.stringify(exportPack(list), null, 2)
  }

  importWorkflows(text: string): { imported: number; skipped: string[] } {
    const { workflows, skipped } = importPack(text)
    for (const w of workflows) this.workflows.upsert(w)
    this.hooks.emit('automation:changed', null)
    return { imported: workflows.length, skipped }
  }

  private requireWorkflow(id: string): Workflow {
    const wf = this.workflows.get(id)
    if (!wf) throw new Error('Workflow not found.')
    return wf
  }

  // ------------------------------------------------------------------ runs

  listRuns(workflowId?: string): WorkflowRun[] {
    const all = new Map(this.runs.all().map((r) => [r.id, r]))
    for (const r of this.live.values()) all.set(r.id, r)
    return [...all.values()]
      .filter((r) => !workflowId || r.workflowId === workflowId)
      .sort((a, b) => b.startedAt - a.startedAt)
  }

  getRun(id: string): WorkflowRun | undefined {
    return this.live.get(id) ?? this.runs.get(id)
  }

  clearRuns(): void {
    this.runs.replaceAll(this.runs.all().filter((r) => this.active.has(r.id)))
  }

  cancelRun(id: string): void {
    this.active.get(id)?.abort()
  }

  /** Manual run from the UI. Returns the run id immediately. */
  runManually(workflowId: string, input?: string): string {
    const runId = this.startRun(this.requireWorkflow(workflowId), 'manual', input, {})
    if (!runId)
      throw new Error(
        'This workflow reached its "max runs per hour" limit. Try again later or raise the limit.'
      )
    return runId
  }

  /** Automatic triggers (schedule, folder, webhook). Disabled workflows/module never run. */
  async trigger(
    workflowId: string,
    source: RunSource,
    input?: string,
    vars: Vars = {}
  ): Promise<string | undefined> {
    const wf = this.workflows.get(workflowId)
    if (!wf || !wf.enabled || !this.started) return undefined
    const runId = this.startRun(wf, source, input, vars)
    if (!runId) this.app.logger.warn(`Automation: "${wf.name}" skipped — max runs per hour reached`)
    return runId
  }

  /** Retry a finished run from its failed step, reusing the earlier steps' outputs. */
  retryRun(runId: string): string {
    const prev = this.getRun(runId)
    if (!prev) throw new Error('Run not found.')
    const wf = this.requireWorkflow(prev.workflowId)
    const from =
      prev.failedStepId && wf.steps.some((s) => s.id === prev.failedStepId)
        ? prev.failedStepId
        : wf.steps[0]?.id
    if (!from) throw new Error('This workflow has no steps.')
    return this.startRun(wf, 'retry', prev.input, prev.vars, {
      resume: { fromStepId: from, outputs: prev.outputs, retryOf: prev.id },
      batchId: prev.batchId,
      bypassLimit: true
    })!
  }

  /** Approve what a run was waiting for, then retry it from that step. */
  approveRun(runId: string): string {
    const prev = this.getRun(runId)
    if (!prev?.approval) throw new Error('This run is not waiting for an approval.')
    this.approve(prev.workflowId, [prev.approval])
    return this.retryRun(runId)
  }

  private persist(run: WorkflowRun, final = false): void {
    if (!final) {
      this.live.set(run.id, run)
      this.hooks.emit('automation:run', run)
      return
    }
    this.live.delete(run.id)
    this.runs.upsert(run)
    const all = this.runs.all()
    if (all.length > MAX_RUNS_KEPT)
      this.runs.replaceAll(
        [...all].sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_RUNS_KEPT)
      )
    this.hooks.emit('automation:run', run)
  }

  private startRun(
    wf: Workflow,
    source: RunSource,
    input: string | undefined,
    vars: Vars,
    extra: {
      resume?: { fromStepId: string; outputs: Record<string, string>; retryOf: string }
      batchId?: string
      priorSpendUsd?: () => number
      bypassLimit?: boolean
      onDone?: (r: WorkflowRun) => void
      controller?: AbortController
    } = {}
  ): string | undefined {
    if (!this.isEnabled()) throw new Error('Automation is turned off in Settings.')
    const limit = wf.safety.maxRunsPerHour
    if (limit > 0 && source !== 'batch' && !extra.bypassLimit) {
      const starts = this.listRuns(wf.id)
        .filter((r) => r.source !== 'batch')
        .map((r) => r.startedAt)
      if (runsInLastHour(starts) >= limit) return undefined
    }
    const id = newId('run_')
    const controller = extra.controller ?? new AbortController()
    this.active.set(id, controller)
    void runWorkflow(
      {
        id,
        workflow: wf,
        source,
        input,
        vars,
        batchId: extra.batchId,
        signal: controller.signal,
        resume: extra.resume,
        priorSpendUsd: extra.priorSpendUsd,
        onUpdate: (r) => {
          if (r.status === 'running') this.persist(r)
        }
      },
      this.engineDeps()
    )
      .then((run) => {
        this.persist(run, true)
        this.notifyFinished(run)
        extra.onDone?.(run)
      })
      .catch((err) => this.app.logger.error('Automation run crashed', err))
      .finally(() => this.active.delete(id))
    return id
  }

  private notifyFinished(run: WorkflowRun): void {
    const s = this.settings
    if (run.source === 'batch') return // batches notify once when finished
    if (run.source === 'manual' && this.hooks.windowFocused()) return
    const secs = Math.round((run.durationMs ?? 0) / 1000)
    if (run.status === 'success' && s.notifyOnSuccess)
      this.hooks.notify(`✔ ${run.workflowName}`, `Finished in ${secs}s`)
    if (run.status !== 'success' && run.status !== 'cancelled' && s.notifyOnFailure) {
      this.hooks.notify(`✖ ${run.workflowName}`, run.error ?? run.status)
    }
  }

  // ------------------------------------------------------------------ batches

  listBatches(): BatchJob[] {
    return [...this.batches.all()].sort((a, b) => b.createdAt - a.createdAt)
  }

  loadBatchItems(source: BatchSource, sourcePath: string, pattern?: string): BatchItem[] {
    let items: BatchItem[]
    if (source === 'folder') {
      items = listMatchingFiles(sourcePath, pattern).map((f) => {
        const name = path.basename(f)
        return {
          input: f,
          vars: { 'trigger.file': f, 'trigger.fileName': name, 'file.path': f, 'file.name': name }
        }
      })
    } else {
      const text = fs.readFileSync(sourcePath, 'utf8')
      if (source === 'txt')
        items = txtLines(text).map((line, i) => ({
          input: line,
          vars: { 'row.index': String(i + 1) }
        }))
      else {
        const { columns, records } = csvToRecords(text)
        const main = columns.find((c) => c.toLowerCase() === 'prompt') ?? columns[0]
        items = records
          .map((rec, i) => ({
            input: rec[main] ?? '',
            vars: { ...rowVars(rec), 'row.index': String(i + 1) }
          }))
          .filter((it) => it.input.trim())
      }
    }
    if (items.length > MAX_BATCH_ITEMS)
      throw new Error(
        `A batch can have at most ${MAX_BATCH_ITEMS} items (this file has ${items.length}).`
      )
    return items
  }

  startBatch(opts: {
    workflowId: string
    source: BatchSource
    sourcePath: string
    pattern?: string
    concurrency: number
  }): BatchJob {
    if (!this.isEnabled()) throw new Error('Automation is turned off in Settings.')
    const wf = this.requireWorkflow(opts.workflowId)
    const items = this.loadBatchItems(opts.source, opts.sourcePath, opts.pattern)
    if (!items.length) throw new Error('No items found in this file or folder.')
    const now = Date.now()
    const job: BatchJob = {
      id: newId('batch_'),
      workflowId: wf.id,
      workflowName: wf.name,
      source: opts.source,
      sourcePath: opts.sourcePath,
      pattern: opts.pattern,
      total: items.length,
      nextIndex: 0,
      done: 0,
      failed: 0,
      running: 0,
      concurrency: Math.min(8, Math.max(1, Math.round(opts.concurrency))),
      status: 'running',
      costUsd: 0,
      createdAt: now,
      updatedAt: now
    }
    this.batches.upsert(job)
    this.batchState.set(job.id, { items, controllers: new Set() })
    this.pumpBatch(job.id)
    return job
  }

  private patchBatch(id: string, changes: Partial<BatchJob>): BatchJob | undefined {
    const b = this.batches.patch(id, { ...changes, updatedAt: Date.now() })
    if (b) this.hooks.emit('automation:batch', b)
    return b
  }

  private pumpBatch(id: string): void {
    const state = this.batchState.get(id)
    let job = this.batches.get(id)
    const wf = job && this.workflows.get(job.workflowId)
    if (!state || !job || !wf) return
    while (job.status === 'running' && job.running < job.concurrency && job.nextIndex < job.total) {
      const item = state.items[job.nextIndex]
      const controller = new AbortController()
      state.controllers.add(controller)
      job = this.patchBatch(id, { nextIndex: job.nextIndex + 1, running: job.running + 1 })!
      this.startRun(wf, 'batch', item.input, item.vars, {
        batchId: id,
        controller,
        priorSpendUsd: () => this.batches.get(id)?.costUsd ?? 0,
        onDone: (run) => {
          state.controllers.delete(controller)
          const cur = this.batches.get(id)!
          const ok = run.status === 'success'
          const next: Partial<BatchJob> = {
            running: Math.max(0, cur.running - 1),
            done: cur.done + (ok ? 1 : 0),
            failed: cur.failed + (ok ? 0 : 1),
            costUsd: cur.costUsd + run.costUsd
          }
          if (run.status === 'capped' && cur.status === 'running') next.status = 'capped'
          const updated = this.patchBatch(id, next)!
          if (updated.status === 'running' && updated.nextIndex < updated.total) this.pumpBatch(id)
          else if (updated.running === 0 && updated.status === 'running')
            this.finishBatch(id, 'completed')
          else if (updated.running === 0 && updated.status === 'capped')
            this.finishBatch(id, 'capped')
        }
      })
    }
  }

  private finishBatch(id: string, status: BatchJob['status']): void {
    const b = this.patchBatch(id, { status })
    this.batchState.delete(id)
    if (!b) return
    const s = this.settings
    if (status === 'completed' && b.failed === 0 && s.notifyOnSuccess)
      this.hooks.notify(`✔ Batch: ${b.workflowName}`, `${b.done} of ${b.total} items done`)
    if ((status === 'capped' || b.failed > 0) && s.notifyOnFailure) {
      this.hooks.notify(
        `✖ Batch: ${b.workflowName}`,
        status === 'capped'
          ? 'Stopped at the spending cap'
          : `${b.failed} of ${b.total} items failed`
      )
    }
  }

  pauseBatch(id: string): BatchJob | undefined {
    const b = this.batches.get(id)
    return b?.status === 'running' ? this.patchBatch(id, { status: 'paused' }) : b
  }

  resumeBatch(id: string): BatchJob | undefined {
    if (!this.isEnabled()) throw new Error('Automation is turned off in Settings.')
    const b = this.batches.get(id)
    if (!b || (b.status !== 'paused' && b.status !== 'capped')) return b
    if (!this.batchState.has(id)) {
      // After a restart: reload the items from the source file/folder.
      this.batchState.set(id, {
        items: this.loadBatchItems(b.source, b.sourcePath, b.pattern),
        controllers: new Set()
      })
    }
    this.patchBatch(id, { status: 'running' })
    this.pumpBatch(id)
    return this.batches.get(id)
  }

  cancelBatch(id: string): BatchJob | undefined {
    const state = this.batchState.get(id)
    for (const c of state?.controllers ?? []) c.abort()
    this.batchState.delete(id)
    return this.patchBatch(id, { status: 'cancelled', running: 0 })
  }

  deleteBatch(id: string): void {
    this.cancelBatch(id)
    this.batches.remove(id)
  }

  // ------------------------------------------------------------------ engine wiring

  private estimateUsage(
    prompt: string,
    system: string | undefined,
    text: string,
    usage?: TokenUsage
  ): TokenUsage {
    if (usage && (usage.inputTokens !== undefined || usage.outputTokens !== undefined)) return usage
    return {
      inputTokens: Math.ceil(((system ?? '').length + prompt.length) / 4),
      outputTokens: Math.ceil(text.length / 4)
    }
  }

  engineDeps(): EngineDeps {
    const s = this.settings
    return {
      outputDir: outputDir(this.app),
      protectedDir: this.dirs.protectedDir,
      llm: async (r, signal) => {
        const res = await this.ai.completeChat(
          {
            providerId: r.providerId,
            model: r.model,
            systemPrompt: r.systemPrompt,
            temperature: r.temperature,
            maxTokens: r.maxTokens,
            messages: [{ role: 'user', content: r.prompt }]
          },
          signal
        )
        return {
          text: res.text,
          usage: this.estimateUsage(r.prompt, r.systemPrompt, res.text, res.usage)
        }
      },
      image: async (r) => (await this.ai.generateImages({ ...r })).map((img) => img.filePath),
      video: async (r, signal) => {
        const job = await this.video.submit({
          providerId: r.providerId,
          model: r.model,
          prompt: r.prompt,
          size: r.size,
          durationSeconds: r.durationSeconds
        })
        const started = Date.now()
        for (;;) {
          if (signal.aborted) {
            this.video.cancel(job.id)
            throw abortError()
          }
          const cur = this.app.storage.videos.get(job.id)
          if (cur?.status === 'completed' && cur.filePath) return cur.filePath
          if (cur?.status === 'failed' || cur?.status === 'cancelled')
            throw new Error(cur.error?.message ?? `Video ${cur.status}`)
          if (Date.now() - started > VIDEO_TIMEOUT_MS)
            throw new Error('Timed out waiting for the video.')
          await sleep(3000, signal)
        }
      },
      tts: async (r) => (await this.ai.textToSpeech(r)).filePath,
      stt: async (r) => {
        const stat = await fs.promises.stat(r.filePath)
        if (stat.size > MAX_AUDIO_BYTES) throw new Error('Audio file is larger than 100 MB.')
        const data = await fs.promises.readFile(r.filePath)
        const ext = path.extname(r.filePath).toLowerCase()
        const res = await this.ai.speechToText({
          providerId: r.providerId,
          model: r.model,
          audioBase64: data.toString('base64'),
          mime: AUDIO_MIME[ext] ?? 'application/octet-stream',
          fileName: path.basename(r.filePath),
          language: r.language
        })
        return res.text
      },
      readFile: async (p) => {
        const stat = await fs.promises.stat(p)
        if (stat.size > MAX_READ_BYTES) throw new Error('File is larger than 10 MB.')
        return (await fs.promises.readFile(p, 'utf8')).replace(/^\uFEFF/, '')
      },
      writeFile: async (p, content, append) => {
        await fs.promises.mkdir(path.dirname(p), { recursive: true })
        if (append) await fs.promises.appendFile(p, content, 'utf8')
        else await fs.promises.writeFile(p, content, 'utf8')
      },
      http: async (r, signal) => {
        const res = await this.app.fetch(r.url, {
          method: r.method,
          headers: r.headers,
          body: r.body,
          signal: AbortSignal.any([signal, AbortSignal.timeout(HTTP_TIMEOUT_MS)])
        })
        const text = await res.text()
        return { status: res.status, body: text.slice(0, MAX_HTTP_BYTES) }
      },
      sleep,
      chatCost: (_p, _m, u) =>
        ((u?.inputTokens ?? 0) * s.unitCosts.chatInputPer1M +
          (u?.outputTokens ?? 0) * s.unitCosts.chatOutputPer1M) /
        1_000_000,
      unitCosts: s.unitCosts,
      now: () => Date.now()
    }
  }
}
