import path from 'node:path'
import type { Step, Workflow } from '../../src/shared/automation'
import type { EngineDeps } from '../../src/main/automation/engine'

export function wf(steps: Step[], overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: 'wf_1',
    name: 'Test workflow',
    enabled: true,
    trigger: { type: 'manual' },
    steps,
    safety: { spendingCapUsd: 0, maxRunsPerHour: 0 },
    permissions: { writeFolders: [], httpHosts: [] },
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

export interface FakeLog {
  calls: Array<{ kind: string; args: unknown }>
  files: Map<string, string>
}

export function fakeDeps(
  overrides: Partial<EngineDeps> = {},
  root = '/tmp/aihub-fake'
): EngineDeps & { log: FakeLog } {
  const log: FakeLog = { calls: [], files: new Map() }
  let clock = 1_000
  const deps: EngineDeps & { log: FakeLog } = {
    log,
    outputDir: path.join(root, 'out'),
    protectedDir: path.join(root, 'userData'),
    llm: async (r) => {
      log.calls.push({ kind: 'llm', args: r })
      return { text: `LLM(${r.prompt})`, usage: { inputTokens: 1000, outputTokens: 1000 } }
    },
    image: async (r) => {
      log.calls.push({ kind: 'image', args: r })
      return Array.from({ length: r.count }, (_, i) => `/img/${i}.png`)
    },
    video: async (r) => {
      log.calls.push({ kind: 'video', args: r })
      return '/vid/1.mp4'
    },
    tts: async (r) => {
      log.calls.push({ kind: 'tts', args: r })
      return '/aud/1.mp3'
    },
    stt: async (r) => {
      log.calls.push({ kind: 'stt', args: r })
      return `transcript of ${path.basename(r.filePath)}`
    },
    readFile: async (p) => {
      log.calls.push({ kind: 'read', args: p })
      if (!log.files.has(p)) throw new Error(`ENOENT: ${p}`)
      return log.files.get(p)!
    },
    writeFile: async (p, c, append) => {
      log.calls.push({ kind: 'write', args: { p, c, append } })
      log.files.set(p, append ? (log.files.get(p) ?? '') + c : c)
    },
    http: async (r) => {
      log.calls.push({ kind: 'http', args: r })
      return { status: 200, body: `{"ok":true,"url":"${r.url}"}` }
    },
    sleep: async () => {},
    chatCost: (_p, _m, u) => (((u?.inputTokens ?? 0) + (u?.outputTokens ?? 0)) * 1) / 1_000_000, // $1 per 1M
    unitCosts: { image: 0.04, video: 0.5, tts: 0.01, stt: 0.006 },
    now: () => (clock += 10),
    ...overrides
  }
  return deps
}
