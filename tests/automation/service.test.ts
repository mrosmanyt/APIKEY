import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AutomationService } from '../../src/main/automation/service'
import { FolderWatcher, listMatchingFiles, patternMatcher } from '../../src/main/automation/watcher'
import { tokenMatches, WebhookServer } from '../../src/main/automation/webhook'
import { Logger } from '../../src/main/logger'
import { AiService } from '../../src/main/services/ai'
import type { AppContext } from '../../src/main/services/context'
import { VideoService } from '../../src/main/services/video'
import { Storage } from '../../src/main/storage'
import { ProviderRegistry } from '../../src/providers/registry'
import type { ProviderAdapter } from '../../src/providers/types'
import type { Step, WorkflowRun } from '../../src/shared/automation'
import { fakeEncryptor, tmpDir } from '../helpers/fakes'
import { wf } from './helpers'

const SECRET = 'sk-test-SECRETKEY-0123456789abcdef'

const adapter: ProviderAdapter = {
  id: 'fake',
  name: 'Fake',
  description: '',
  keyUrl: 'https://x',
  keyPlaceholder: '',
  testKey: async () => {},
  chat: {
    models: [{ id: 'm' }],
    stream: async (ctx, req, h) => {
      if (ctx.apiKey !== SECRET) throw new Error('no key')
      const text = req.messages[0].content
      if (text.includes('FAIL')) throw new Error('provider exploded')
      h.onDelta(`echo:${text}`)
      return { usage: { inputTokens: 100_000, outputTokens: 100_000 } }
    }
  },
  image: {
    models: [],
    generate: async (_c, r) =>
      Array.from({ length: r.count }, () => ({ data: Buffer.from('png'), mime: 'image/png' }))
  }
}

const services: AutomationService[] = []

function setup(enabled = true) {
  const dir = tmpDir()
  const notes: string[] = []
  const events: string[] = []
  const storage = new Storage(path.join(dir, 'data'), fakeEncryptor)
  storage.settings.update({
    automation: { ...storage.settings.get().automation, enabled, notifyOnSuccess: true }
  })
  const ctx: AppContext = {
    storage,
    registry: new ProviderRegistry([adapter]),
    logger: new Logger(path.join(dir, 'logs')),
    fetch: async () => new Response('ok'),
    defaultOutputDir: path.join(dir, 'out'),
    emit: (channel) => events.push(channel)
  }
  const ai = new AiService(ctx)
  ai.saveKey('fake', SECRET)
  const video = new VideoService(ctx, ai, 60_000)
  const automation = new AutomationService(
    ctx,
    ai,
    video,
    { emit: ctx.emit, notify: (t, b) => notes.push(`${t}|${b}`), windowFocused: () => false },
    { dataDir: path.join(dir, 'data'), protectedDir: path.join(dir, 'data') }
  )
  services.push(automation)
  return { automation, storage, notes, events, dir, ctx }
}

afterEach(async () => {
  for (const s of services.splice(0)) await s.shutdown()
})

async function waitFor<T>(fn: () => T | undefined, ms = 3000): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const v = fn()
    if (v) return v
    if (Date.now() > end) throw new Error('timeout')
    await new Promise((r) => setTimeout(r, 10))
  }
}

const done = (a: AutomationService, id: string) =>
  waitFor(() => {
    const r = a.getRun(id)
    return r && r.status !== 'running' ? r : undefined
  })

const llm = (id: string, prompt: string): Step => ({
  id,
  type: 'llm',
  providerId: 'fake',
  model: 'm',
  prompt
})

describe('AutomationService', () => {
  it('does nothing while the module is off', async () => {
    const { automation } = setup(false)
    await automation.apply()
    expect(automation.isRunning()).toBe(false)
    automation.workflows.upsert(wf([llm('step1', 'x')]))
    expect(() => automation.runManually('wf_1')).toThrow(/turned off/)
    expect(await automation.trigger('wf_1', 'schedule')).toBeUndefined()
  })

  it('runs workflows through the main-process AI service without exposing keys', async () => {
    const { automation, dir } = setup()
    await automation.apply()
    automation.saveWorkflow(
      wf([
        llm('step1', 'Hello {{input}}'),
        { id: 'step2', type: 'writeFile', path: 'out.txt', content: '{{step1.output}}' }
      ])
    )
    const run = await done(automation, automation.runManually('wf_1', 'Ann'))
    expect(run.error).toBeUndefined()
    expect(run.status).toBe('success')
    expect(fs.readFileSync(path.join(dir, 'out', 'automation', 'out.txt'), 'utf8')).toBe(
      'echo:Hello Ann'
    )
    expect(run.costUsd).toBeCloseTo((100_000 * 3 + 100_000 * 15) / 1_000_000) // default chat estimate
    const persisted = fs.readFileSync(path.join(dir, 'data', 'automation-runs.json'), 'utf8')
    expect(persisted).not.toContain(SECRET)
    expect(JSON.stringify(automation.listWorkflows())).not.toContain(SECRET)
    expect(automation.exportWorkflows([])).not.toContain(SECRET)
  })

  it('never offers or stores an approval for the private data folder', async () => {
    const { automation, dir } = setup()
    await automation.apply()
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true })
    fs.symlinkSync(
      path.join(dir, 'data'),
      path.join(dir, 'docs', 'link'),
      process.platform === 'win32' ? 'junction' : 'dir'
    )
    automation.saveWorkflow(
      wf([
        {
          id: 'step1',
          type: 'writeFile',
          path: path.join(dir, 'docs', 'link', 'x.txt'),
          content: 'x'
        },
        { id: 'step2', type: 'writeFile', path: path.join(dir, 'data', 'y.txt'), content: 'y' },
        { id: 'step3', type: 'writeFile', path: path.join(dir, 'docs', 'ok.txt'), content: 'z' }
      ])
    )
    expect(automation.preflight('wf_1')).toEqual([
      { kind: 'write', target: fs.realpathSync.native(path.join(dir, 'docs')) }
    ])
    const w = automation.approve('wf_1', [
      { kind: 'write', target: path.join(dir, 'data') },
      { kind: 'write', target: path.join(dir, 'docs', 'link') },
      { kind: 'write', target: path.join(dir, 'docs') }
    ])
    expect(w.permissions.writeFolders).toEqual([path.join(dir, 'docs')])
    const run = await done(automation, automation.runManually('wf_1'))
    expect(run.status).toBe('failed')
    expect(run.error).toMatch(/private data folder/)
    expect(fs.existsSync(path.join(dir, 'data', 'x.txt'))).toBe(false)
  })

  it('pauses on approvals, approves, and retries from the failed step', async () => {
    const { automation, dir } = setup()
    await automation.apply()
    const outside = path.join(dir, 'elsewhere', 'r.txt')
    automation.saveWorkflow(
      wf([
        llm('step1', 'x'),
        { id: 'step2', type: 'writeFile', path: outside, content: '{{step1.output}}' }
      ])
    )
    expect(automation.preflight('wf_1')).toEqual([{ kind: 'write', target: path.dirname(outside) }])
    const first = await done(automation, automation.runManually('wf_1'))
    expect(first.status).toBe('needs_approval')
    const retried = await done(automation, automation.approveRun(first.id))
    expect(retried.status).toBe('success')
    expect(retried.steps.map((s) => s.stepId)).toEqual(['step2'])
    expect(fs.readFileSync(outside, 'utf8')).toBe('echo:x')
    expect(automation.workflows.get('wf_1')!.permissions.writeFolders).toEqual([
      path.dirname(outside)
    ])
    // Saving from the editor cannot grant or keep-alive approvals it did not get from approve().
    const saved = automation.saveWorkflow({
      ...automation.workflows.get('wf_1')!,
      permissions: { writeFolders: ['/'], httpHosts: ['evil.com'] }
    })
    expect(saved.permissions.httpHosts).toEqual([])
  })

  it('enforces max runs per hour for triggers and manual runs', async () => {
    const { automation } = setup()
    await automation.apply()
    automation.saveWorkflow(
      wf([llm('step1', 'x')], { safety: { spendingCapUsd: 0, maxRunsPerHour: 2 } })
    )
    await done(automation, automation.runManually('wf_1'))
    await done(automation, (await automation.trigger('wf_1', 'webhook'))!)
    expect(await automation.trigger('wf_1', 'schedule')).toBeUndefined()
    expect(() => automation.runManually('wf_1')).toThrow(/max runs per hour/)
  })

  it('notifies when background runs finish or fail', async () => {
    const { automation, notes } = setup()
    await automation.apply()
    automation.saveWorkflow(wf([llm('step1', '{{input}}')]))
    await done(automation, (await automation.trigger('wf_1', 'webhook', 'ok'))!)
    await done(automation, (await automation.trigger('wf_1', 'webhook', 'FAIL'))!)
    expect(notes[0]).toMatch(/^✔ Test workflow/)
    expect(notes[1]).toMatch(/^✖ Test workflow\|.*provider exploded/)
  })

  it('runs batches with concurrency, pause/resume, cancel and a spending cap', async () => {
    const { automation, dir } = setup()
    await automation.apply()
    const csv = path.join(dir, 'prompts.csv')
    fs.writeFileSync(csv, 'prompt,style\na cat,oil\na dog,ink\na bird,pencil\na fox,watercolor\n')
    automation.saveWorkflow(
      wf([
        {
          id: 'step1',
          type: 'writeFile',
          path: 'b/{{row.index}}.txt',
          content: '{{input}} in {{row.style}}'
        }
      ])
    )
    const job = automation.startBatch({
      workflowId: 'wf_1',
      source: 'csv',
      sourcePath: csv,
      concurrency: 2
    })
    expect(job).toMatchObject({ total: 4, status: 'running' })
    const finished = await waitFor(() =>
      automation.batches.get(job.id)?.status === 'completed'
        ? automation.batches.get(job.id)
        : undefined
    )
    expect(finished).toMatchObject({ done: 4, failed: 0 })
    expect(fs.readFileSync(path.join(dir, 'out', 'automation', 'b', '2.txt'), 'utf8')).toBe(
      'a dog in ink'
    )

    // Spending cap across the batch: each LLM item costs ~$1.80 → stops after the cap.
    const txt = path.join(dir, 'lines.txt')
    fs.writeFileSync(txt, 'one\ntwo\nthree\nfour\nfive\n')
    automation.saveWorkflow(
      wf([llm('step1', '{{input}}')], {
        id: 'wf_2',
        safety: { spendingCapUsd: 3, maxRunsPerHour: 0 }
      })
    )
    const capped = automation.startBatch({
      workflowId: 'wf_2',
      source: 'txt',
      sourcePath: txt,
      concurrency: 1
    })
    const c = await waitFor(() =>
      automation.batches.get(capped.id)?.status === 'capped' &&
      automation.batches.get(capped.id)?.running === 0
        ? automation.batches.get(capped.id)
        : undefined
    )
    expect(c.done + c.failed).toBeLessThan(5)
    expect(c.costUsd).toBeGreaterThanOrEqual(3)

    // Pause stops new items; resume continues; cancel stops everything.
    automation.saveWorkflow(wf([{ id: 'step1', type: 'delay', seconds: 0.05 }], { id: 'wf_3' }))
    const slow = automation.startBatch({
      workflowId: 'wf_3',
      source: 'txt',
      sourcePath: txt,
      concurrency: 1
    })
    automation.pauseBatch(slow.id)
    await new Promise((r) => setTimeout(r, 150))
    const paused = automation.batches.get(slow.id)!
    expect(paused.status).toBe('paused')
    expect(paused.done).toBeLessThan(5)
    automation.resumeBatch(slow.id)
    automation.cancelBatch(slow.id)
    expect(automation.batches.get(slow.id)!.status).toBe('cancelled')
  })

  it('batches over a folder expose {{trigger.file}} / {{file.name}}', async () => {
    const { automation, dir } = setup()
    await automation.apply()
    const folder = path.join(dir, 'in')
    fs.mkdirSync(folder)
    fs.writeFileSync(path.join(folder, 'a.txt'), 'alpha')
    fs.writeFileSync(path.join(folder, 'b.md'), 'beta')
    fs.writeFileSync(path.join(folder, 'skip.png'), 'x')
    automation.saveWorkflow(
      wf([
        { id: 'r', type: 'readFile', path: '{{trigger.file}}' },
        { id: 'w', type: 'writeFile', path: 'copy/{{file.name}}', content: '{{r.output}}!' }
      ])
    )
    const job = automation.startBatch({
      workflowId: 'wf_1',
      source: 'folder',
      sourcePath: folder,
      pattern: '*.txt;*.md',
      concurrency: 2
    })
    expect(job.total).toBe(2)
    await waitFor(() => (automation.batches.get(job.id)?.status === 'completed' ? true : undefined))
    expect(fs.readFileSync(path.join(dir, 'out', 'automation', 'copy', 'b.md'), 'utf8')).toBe(
      'beta!'
    )
  })

  it('stops schedules, watchers and running work when turned off', async () => {
    const { automation, storage, dir } = setup()
    await automation.apply()
    const folder = path.join(dir, 'watch')
    fs.mkdirSync(folder)
    automation.saveWorkflow(
      wf([{ id: 'step1', type: 'delay', seconds: 60 }], {
        trigger: { type: 'schedule', preset: 'hourly', minute: 0 }
      })
    )
    automation.saveWorkflow(
      wf([llm('step1', 'x')], { id: 'wf_2', trigger: { type: 'folder', folder } })
    )
    expect(Object.keys(automation.nextScheduledRuns())).toEqual(['wf_1'])
    const runId = automation.runManually('wf_1')
    storage.settings.update({
      automation: { ...storage.settings.get().automation, enabled: false }
    })
    await automation.apply()
    expect(automation.isRunning()).toBe(false)
    expect(automation.nextScheduledRuns()).toEqual({})
    expect((await done(automation, runId)).status).toBe('cancelled')
  })

  it('creates workflows from templates with the user’s providers, disabled', () => {
    const { automation } = setup()
    const w = automation.createFromTemplate('blog-post', {
      llm: { providerId: 'fake', model: 'm' }
    })
    expect(w.enabled).toBe(false)
    expect(
      w.steps
        .filter((s) => s.type === 'llm')
        .every((s) => s.type === 'llm' && s.providerId === 'fake')
    ).toBe(true)
    expect(() => automation.createFromTemplate('nope', {})).toThrow(/Unknown template/)
  })

  it('imports packs disabled and keeps run history capped', async () => {
    const { automation } = setup()
    await automation.apply()
    const pack = JSON.stringify({
      format: 'ai-hub-workflows',
      version: 1,
      workflows: [{ ...wf([llm('step1', 'x')]), enabled: true }]
    })
    expect(automation.importWorkflows(pack)).toEqual({ imported: 1, skipped: [] })
    expect(automation.listWorkflows()[0].enabled).toBe(false)
    const fakeRuns: WorkflowRun[] = Array.from({ length: 520 }, (_, i) => ({
      id: `run_${i}`,
      workflowId: 'x',
      workflowName: 'x',
      source: 'manual',
      vars: {},
      status: 'success',
      steps: [],
      outputs: {},
      costUsd: 0,
      startedAt: i
    }))
    automation.runs.replaceAll(fakeRuns)
    automation.saveWorkflow(wf([llm('step1', 'x')]))
    await done(automation, automation.runManually('wf_1'))
    expect(automation.runs.all().length).toBe(500)
  })
})

describe('folder watcher', () => {
  it('matches patterns and ignores temporary files', () => {
    const m = patternMatcher('*.mp3; *.WAV')
    expect(m('a.MP3')).toBe(true)
    expect(m('a.wav')).toBe(true)
    expect(m('a.txt')).toBe(false)
    expect(patternMatcher('')('anything')).toBe(true)
    const dir = tmpDir()
    for (const f of ['b.txt', 'a.txt', '~$lock.txt', '.hidden.txt', 'c.txt.part'])
      fs.writeFileSync(path.join(dir, f), 'x')
    expect(listMatchingFiles(dir, '*.txt').map((f) => path.basename(f))).toEqual(['a.txt', 'b.txt'])
  })

  it('reports only new files, once their size is stable', async () => {
    const dir = tmpDir()
    fs.writeFileSync(path.join(dir, 'old.mp3'), 'existing')
    const seen: string[] = []
    const w = new FolderWatcher(dir, '*.mp3', (f) => seen.push(path.basename(f)), 60_000)
    w.start()
    fs.writeFileSync(path.join(dir, 'new.mp3'), 'abc')
    await w.scan() // first sighting: remember size
    expect(seen).toEqual([])
    await w.scan() // unchanged size → report
    await w.scan() // never twice
    w.stop()
    expect(seen).toEqual(['new.mp3'])
  })
})

describe('webhook server', () => {
  it('listens on 127.0.0.1, requires the token and passes the body', async () => {
    const calls: Array<[string, string]> = []
    const server = new WebhookServer(
      () => 'tok-123',
      async (id, body) => {
        calls.push([id, body])
        return { status: 202, json: { runId: 'run_1' } }
      }
    )
    const port = await server.start(0)
    const base = `http://127.0.0.1:${port}`
    try {
      expect((await fetch(`${base}/health`)).status).toBe(200)
      expect((await fetch(`${base}/run/wf_1`, { method: 'POST', body: 'x' })).status).toBe(401)
      expect(
        (
          await fetch(`${base}/run/wf_1`, {
            method: 'POST',
            headers: { Authorization: 'Bearer wrong' },
            body: 'x'
          })
        ).status
      ).toBe(401)
      const ok = await fetch(`${base}/run/wf_1`, {
        method: 'POST',
        headers: { Authorization: 'Bearer tok-123' },
        body: '{"topic":"cats"}'
      })
      expect(ok.status).toBe(202)
      expect(await ok.json()).toEqual({ runId: 'run_1' })
      const auth = { Authorization: 'Bearer tok-123' }
      expect((await fetch(`${base}/run/wf_1`, { method: 'GET', headers: auth })).status).toBe(405)
      expect((await fetch(`${base}/elsewhere`, { method: 'POST', headers: auth })).status).toBe(404)
      const big = await fetch(`${base}/run/wf_1`, {
        method: 'POST',
        headers: auth,
        body: 'x'.repeat(1024 * 1024 + 10)
      }).catch(() => undefined)
      if (big) expect(big.status).toBe(413)
      expect(calls).toEqual([['wf_1', '{"topic":"cats"}']])
    } finally {
      await server.stop()
    }
    expect(tokenMatches('a', 'ab')).toBe(false)
    expect(tokenMatches(undefined, 'ab')).toBe(false)
  })

  it('is started by the service only when enabled, with a persistent random token', async () => {
    const { automation, storage } = setup()
    storage.settings.update({
      automation: { ...storage.settings.get().automation, webhookEnabled: true, webhookPort: 0 }
    })
    await automation.apply()
    const info = automation.webhookInfo()
    expect(info.running).toBe(true)
    expect(info.token.length).toBeGreaterThanOrEqual(32)
    expect(info.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    automation.saveWorkflow(
      wf([llm('step1', 'from webhook: {{webhook.body}}')], { trigger: { type: 'webhook' } })
    )
    const res = await fetch(`${info.baseUrl}/run/wf_1`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${info.token}` },
      body: 'hello'
    })
    expect(res.status).toBe(202)
    const { runId } = (await res.json()) as { runId: string }
    expect((await done(automation, runId)).outputs.step1).toBe('echo:from webhook: hello')
    expect(automation.regenerateToken().token).not.toBe(info.token)
  })
})
