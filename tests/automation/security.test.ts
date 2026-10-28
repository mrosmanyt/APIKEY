import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AUTOMATION_HEADER,
  MAX_REDIRECTS,
  runWorkflow,
  type EngineDeps
} from '../../src/main/automation/engine'
import {
  checkRead,
  checkUrl,
  checkWrite,
  isLoopback,
  realPath
} from '../../src/main/automation/safety'
import { WebhookServer } from '../../src/main/automation/webhook'
import type { Step } from '../../src/shared/automation'
import { tmpDir } from '../helpers/fakes'
import { fakeDeps, wf } from './helpers'

const none = { writeFolders: [], httpHosts: [] }

/** Directory symlink that also works on Windows without admin rights. */
function linkDir(target: string, link: string) {
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
}

describe('symlinks and junctions', () => {
  function layout() {
    const root = tmpDir()
    const appData = path.join(root, 'appdata')
    const out = path.join(root, 'out')
    const docs = path.join(root, 'docs')
    for (const d of [appData, out, docs]) fs.mkdirSync(d, { recursive: true })
    fs.writeFileSync(path.join(appData, 'keys.json'), '{"secret":true}')
    return { root, appData, out, docs }
  }

  it('realPath resolves links, including for files that do not exist yet', () => {
    const { appData, out } = layout()
    linkDir(appData, path.join(out, 'sneaky'))
    expect(realPath(path.join(out, 'sneaky', 'keys.json'))).toBe(
      path.join(fs.realpathSync.native(appData), 'keys.json')
    )
    expect(realPath(path.join(out, 'sneaky', 'new', 'deep', 'x.txt'))).toBe(
      path.join(fs.realpathSync.native(appData), 'new', 'deep', 'x.txt')
    )
    const missing = path.join(out, 'nope', 'a.txt')
    expect(realPath(missing)).toBe(path.join(fs.realpathSync.native(out), 'nope', 'a.txt'))
  })

  it('a link inside the output folder cannot reach the app data folder', () => {
    const { appData, out } = layout()
    linkDir(appData, path.join(out, 'sneaky'))
    const viaLink = path.join(out, 'sneaky', 'keys.json')
    expect(checkRead(viaLink, appData, out)).toMatch(/private/)
    // Writing through the link is no longer "inside the output folder" …
    expect(checkWrite(viaLink, out, none)).toEqual({
      kind: 'write',
      target: fs.realpathSync.native(appData)
    })
    // … and is refused for files that don't exist yet, too.
    expect(checkRead(path.join(out, 'sneaky', 'new.txt'), appData, out)).toMatch(/private/)
  })

  it('an approved folder that links into the app data folder does not unlock it', async () => {
    const { appData, out, docs } = layout()
    linkDir(appData, path.join(docs, 'link'))
    const target = path.join(docs, 'link', 'keys.json')
    const deps = fakeDeps({ outputDir: out, protectedDir: appData })
    const run = await runWorkflow(
      {
        workflow: wf([{ id: 'step1', type: 'writeFile', path: target, content: 'x' }], {
          permissions: { writeFolders: [docs], httpHosts: [] }
        }),
        source: 'manual'
      },
      deps
    )
    expect(run.status).toBe('failed')
    expect(run.error).toMatch(/private data folder/)
    expect(deps.log.calls.some((c) => c.kind === 'write')).toBe(false)
    const read = await runWorkflow(
      { workflow: wf([{ id: 'step1', type: 'readFile', path: target }]), source: 'manual' },
      deps
    )
    expect(read.error).toMatch(/private data folder/)
  })

  it('a link pointing into the output folder is treated as the output folder, and I/O uses the real path', async () => {
    const { out, docs, appData } = layout()
    linkDir(out, path.join(docs, 'to-out'))
    const viaLink = path.join(docs, 'to-out', 'r.txt')
    expect(checkWrite(viaLink, out, none)).toBeUndefined()
    const deps = fakeDeps({ outputDir: out, protectedDir: appData })
    const run = await runWorkflow(
      {
        workflow: wf([{ id: 'step1', type: 'writeFile', path: viaLink, content: 'hi' }]),
        source: 'manual'
      },
      deps
    )
    expect(run.status).toBe('success')
    expect([...deps.log.files.keys()]).toEqual([path.join(fs.realpathSync.native(out), 'r.txt')])
  })

  it('a user output folder that is itself a link still works', () => {
    const { root, appData, docs } = layout()
    const linkedOut = path.join(root, 'linked-out')
    linkDir(docs, linkedOut)
    expect(checkWrite(path.join(linkedOut, 'a.txt'), linkedOut, none)).toBeUndefined()
    expect(checkWrite(path.join(docs, 'a.txt'), linkedOut, none)).toBeUndefined()
    expect(checkRead(path.join(linkedOut, 'a.txt'), appData, linkedOut)).toBeUndefined()
  })
})

describe('loopback hosts and the webhook port', () => {
  it('detects loopback in all its spellings', () => {
    for (const u of [
      'http://localhost/',
      'http://LOCALHOST./',
      'http://app.localhost/',
      'http://127.0.0.1/',
      'http://127.8.9.10/',
      'http://2130706433/',
      'http://0x7f.1/',
      'http://0.0.0.0/',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/'
    ])
      expect(isLoopback(new URL(u).hostname), u).toBe(true)
    for (const u of ['http://example.com/', 'http://10.0.0.1/', 'http://[2001:db8::1]/'])
      expect(isLoopback(new URL(u).hostname), u).toBe(false)
  })

  it('requires approval for loopback hosts like any other host', () => {
    expect(checkUrl('http://localhost:11434/api', none).approval).toEqual({
      kind: 'http',
      target: 'localhost:11434'
    })
    expect(checkUrl('http://[::1]:8080/', none).approval?.target).toBe('[::1]:8080')
    expect(
      checkUrl('http://127.0.0.1:5000/', { writeFolders: [], httpHosts: ['127.0.0.1:5000'] })
    ).toEqual({ host: '127.0.0.1:5000' })
  })

  it('never allows the app’s own webhook port, even when approved', () => {
    const approved = { writeFolders: [], httpHosts: ['127.0.0.1:17345', 'localhost:17345'] }
    const opts = { webhookPort: 17345 }
    for (const u of [
      'http://127.0.0.1:17345/run/wf_1',
      'http://localhost:17345/run/wf_1',
      'http://2130706433:17345/',
      'http://[::1]:17345/',
      'http://[::ffff:127.0.0.1]:17345/'
    ])
      expect(checkUrl(u, approved, opts).error, u).toMatch(/own webhook/)
    // Port 80 webhook: the default port counts.
    expect(checkUrl('http://localhost/', none, { webhookPort: 80 }).error).toMatch(/own webhook/)
    // Same port on another machine is fine (with approval).
    expect(checkUrl('http://example.com:17345/', none, opts).approval).toBeDefined()
  })

  it('an HTTP step to the webhook port fails without calling it', async () => {
    const deps = fakeDeps({ webhookPort: 17345 })
    const run = await runWorkflow(
      {
        workflow: wf(
          [{ id: 'step1', type: 'http', method: 'POST', url: 'http://127.0.0.1:17345/run/wf_1' }],
          { permissions: { writeFolders: [], httpHosts: ['127.0.0.1:17345'] } }
        ),
        source: 'manual'
      },
      deps
    )
    expect(run.status).toBe('failed')
    expect(run.error).toMatch(/own webhook/)
    expect(deps.log.calls.filter((c) => c.kind === 'http')).toHaveLength(0)
  })
})

describe('HTTP redirects', () => {
  type Req = Parameters<EngineDeps['http']>[0]
  /** Fake transport: a map of URL → response. */
  function transport(routes: Record<string, { status: number; location?: string; body?: string }>) {
    const seen: Req[] = []
    const http: EngineDeps['http'] = async (r) => {
      seen.push(structuredClone(r))
      const hit = routes[r.url]
      if (!hit) return { status: 404, body: 'not found' }
      return { status: hit.status, body: hit.body ?? '', location: hit.location }
    }
    return { http, seen }
  }
  const get = (url: string, extra: Partial<Extract<Step, { type: 'http' }>> = {}): Step => ({
    id: 'step1',
    type: 'http',
    method: 'GET',
    url,
    ...extra
  })
  const allow = (...hosts: string[]) => ({ permissions: { writeFolders: [], httpHosts: hosts } })

  it('follows a same-host redirect (relative Location) and records each hop', async () => {
    const t = transport({
      'https://a.example/start': { status: 302, location: '/next?x=1' },
      'https://a.example/next?x=1': { status: 200, body: 'done' }
    })
    const run = await runWorkflow(
      { workflow: wf([get('https://a.example/start')], allow('a.example')), source: 'manual' },
      fakeDeps({ http: t.http })
    )
    expect(run.status).toBe('success')
    expect(run.outputs.step1).toBe('done')
    expect(t.seen.map((r) => r.url)).toEqual([
      'https://a.example/start',
      'https://a.example/next?x=1'
    ])
    expect(run.steps[0].input['redirect 1']).toBe('https://a.example/next?x=1')
    for (const r of t.seen) expect(r.headers[AUTOMATION_HEADER]).toBe('1')
  })

  it('a redirect to a new host needs its own approval', async () => {
    const t = transport({
      'https://a.example/go': { status: 301, location: 'https://b.example/landing' },
      'https://b.example/landing': { status: 200, body: 'b' }
    })
    const first = await runWorkflow(
      { workflow: wf([get('https://a.example/go')], allow('a.example')), source: 'manual' },
      fakeDeps({ http: t.http })
    )
    expect(first.status).toBe('needs_approval')
    expect(first.approval).toEqual({ kind: 'http', target: 'b.example' })
    expect(t.seen.map((r) => r.url)).toEqual(['https://a.example/go'])

    const second = await runWorkflow(
      {
        workflow: wf([get('https://a.example/go')], allow('a.example', 'b.example')),
        source: 'manual'
      },
      fakeDeps({ http: t.http })
    )
    expect(second.status).toBe('success')
    expect(second.outputs.step1).toBe('b')
  })

  it('refuses redirects to loopback/the webhook and to non-http schemes', async () => {
    const t = transport({
      'https://a.example/hook': { status: 307, location: 'http://127.0.0.1:17345/run/wf_1' },
      'https://a.example/local': { status: 302, location: 'http://localhost:9000/admin' },
      'https://a.example/file': { status: 302, location: 'file:///etc/passwd' }
    })
    const deps = fakeDeps({ http: t.http, webhookPort: 17345 })
    const run = (url: string) =>
      runWorkflow({ workflow: wf([get(url)], allow('a.example')), source: 'manual' }, deps)
    const hook = await run('https://a.example/hook')
    expect(hook.status).toBe('failed')
    expect(hook.error).toMatch(/own webhook/)
    const local = await run('https://a.example/local')
    expect(local.status).toBe('needs_approval')
    expect(local.approval?.target).toBe('localhost:9000')
    const file = await run('https://a.example/file')
    expect(file.error).toMatch(/Only http/)
    expect(t.seen.map((r) => r.url)).not.toContain('http://127.0.0.1:17345/run/wf_1')
  })

  it(`follows at most ${MAX_REDIRECTS} redirects`, async () => {
    const routes: Record<string, { status: number; location: string }> = {}
    for (let i = 0; i < 10; i++)
      routes[`https://a.example/${i}`] = { status: 302, location: `/${i + 1}` }
    const t = transport(routes)
    const loop = await runWorkflow(
      { workflow: wf([get('https://a.example/0')], allow('a.example')), source: 'manual' },
      fakeDeps({ http: t.http })
    )
    expect(loop.status).toBe('failed')
    expect(loop.error).toMatch(/Too many redirects/)
    expect(t.seen).toHaveLength(MAX_REDIRECTS + 1)

    const ok = transport({
      ...Object.fromEntries(
        Array.from({ length: MAX_REDIRECTS }, (_, i) => [
          `https://a.example/${i}`,
          { status: 308, location: `/${i + 1}` }
        ])
      ),
      [`https://a.example/${MAX_REDIRECTS}`]: { status: 200, body: 'end' }
    })
    const exact = await runWorkflow(
      { workflow: wf([get('https://a.example/0')], allow('a.example')), source: 'manual' },
      fakeDeps({ http: ok.http })
    )
    expect(exact.status).toBe('success')
  })

  it('303 (and 302 after POST) switch to GET without the body; 307 keeps both', async () => {
    const t = transport({
      'https://a.example/303': { status: 303, location: '/see' },
      'https://a.example/302': { status: 302, location: '/see' },
      'https://a.example/307': { status: 307, location: '/again' },
      'https://a.example/see': { status: 200, body: 'seen' },
      'https://a.example/again': { status: 200, body: 'again' }
    })
    const post = (url: string) =>
      runWorkflow(
        {
          workflow: wf(
            [
              get(url, {
                method: 'POST',
                body: '{"a":1}',
                headers: [{ name: 'Content-Type', value: 'application/json' }]
              })
            ],
            allow('a.example')
          ),
          source: 'manual'
        },
        fakeDeps({ http: t.http })
      )
    await post('https://a.example/303')
    await post('https://a.example/302')
    await post('https://a.example/307')
    const after = (from: string) => t.seen[t.seen.findIndex((r) => r.url === from) + 1]
    for (const from of ['https://a.example/303', 'https://a.example/302']) {
      expect(after(from).method).toBe('GET')
      expect(after(from).body).toBeUndefined()
      expect(after(from).headers['Content-Type']).toBeUndefined()
    }
    expect(after('https://a.example/307')).toMatchObject({ method: 'POST', body: '{"a":1}' })
  })

  it('drops credentials when a redirect leaves the original origin', async () => {
    const t = transport({
      'https://a.example/x': { status: 302, location: 'https://b.example/y' },
      'https://b.example/y': { status: 200, body: 'ok' }
    })
    const run = await runWorkflow(
      {
        workflow: wf(
          [
            get('https://a.example/x', {
              headers: [
                { name: 'Authorization', value: 'Bearer s3cret' },
                { name: 'Cookie', value: 'sid=1' },
                { name: 'Accept', value: 'text/plain' },
                { name: AUTOMATION_HEADER, value: 'spoofed' }
              ]
            })
          ],
          allow('a.example', 'b.example')
        ),
        source: 'manual'
      },
      fakeDeps({ http: t.http })
    )
    expect(run.status).toBe('success')
    expect(t.seen[0].headers.Authorization).toBe('Bearer s3cret')
    expect(t.seen[1].headers.Authorization).toBeUndefined()
    expect(t.seen[1].headers.Cookie).toBeUndefined()
    expect(t.seen[1].headers.Accept).toBe('text/plain')
    expect(t.seen[1].headers[AUTOMATION_HEADER]).toBe('1')
  })
})

describe('webhook authentication', () => {
  const servers: WebhookServer[] = []
  afterEach(async () => {
    for (const s of servers.splice(0)) await s.stop()
  })

  async function start() {
    const calls: string[] = []
    const server = new WebhookServer(
      () => 'tok-123',
      async (id) => {
        calls.push(id)
        return { status: 202, json: { ok: true } }
      }
    )
    servers.push(server)
    const port = await server.start(0)
    return { base: `http://127.0.0.1:${port}`, calls }
  }

  it('accepts the token only in the Authorization: Bearer header', async () => {
    const { base, calls } = await start()
    const post = (url: string, headers: Record<string, string> = {}) =>
      fetch(url, { method: 'POST', headers, body: 'x' }).then((r) => r.status)
    expect(await post(`${base}/run/wf_1?token=tok-123`)).toBe(401)
    expect(await post(`${base}/run/wf_1`, { 'X-Token': 'tok-123' })).toBe(401)
    expect(await post(`${base}/run/wf_1`, { Authorization: 'tok-123' })).toBe(401)
    expect(await post(`${base}/run/wf_1`, { Authorization: 'Basic tok-123' })).toBe(401)
    expect(await post(`${base}/run/wf_1`, { Authorization: 'Bearer tok-123 extra' })).toBe(401)
    expect(calls).toEqual([])
    expect(await post(`${base}/run/wf_1`, { Authorization: 'Bearer tok-123' })).toBe(202)
    expect(calls).toEqual(['wf_1'])
  })

  it('refuses requests sent by an automation HTTP step', async () => {
    const { base, calls } = await start()
    const res = await fetch(`${base}/run/wf_1`, {
      method: 'POST',
      headers: { Authorization: 'Bearer tok-123', [AUTOMATION_HEADER]: '1' },
      body: 'x'
    })
    expect(res.status).toBe(403)
    expect(calls).toEqual([])
  })
})

describe('service HTTP transport', () => {
  const closers: Array<() => void> = []
  afterEach(() => closers.splice(0).forEach((c) => c()))

  function serve(handler: http.RequestListener): Promise<string> {
    return new Promise((resolve) => {
      const s = http.createServer(handler)
      s.listen(0, '127.0.0.1', () => {
        closers.push(() => s.close())
        resolve(`127.0.0.1:${(s.address() as AddressInfo).port}`)
      })
    })
  }

  it('requests with redirect: "manual" and hands each hop back to the engine', async () => {
    const b = await serve((_q, r) => r.end('from b'))
    const a = await serve((q, r) => {
      if (q.url === '/start') {
        r.writeHead(302, { Location: `http://${b}/end` })
        return r.end()
      }
      r.end('a')
    })
    const { AutomationService } = await import('../../src/main/automation/service')
    const inits: RequestInit[] = []
    const svc = Object.create(AutomationService.prototype) as InstanceType<typeof AutomationService>
    Object.assign(svc, {
      app: {
        fetch: (u: string, init: RequestInit) => {
          inits.push(init)
          return fetch(u, init)
        },
        storage: {
          settings: {
            get: () => ({
              outputDir: '',
              automation: {
                webhookPort: 17345,
                unitCosts: { chatInputPer1M: 0, chatOutputPer1M: 0 }
              }
            })
          }
        }
      },
      dirs: { dataDir: tmpDir(), protectedDir: tmpDir() }
    })
    const deps = svc.engineDeps()
    const signal = new AbortController().signal
    const hop = await deps.http({ method: 'GET', url: `http://${a}/start`, headers: {} }, signal)
    expect(hop).toMatchObject({ status: 302, location: `http://${b}/end` })
    expect(inits[0].redirect).toBe('manual')
    expect(deps.webhookPort).toBe(17345)

    const run = await runWorkflow(
      {
        workflow: wf([{ id: 'step1', type: 'http', method: 'GET', url: `http://${a}/start` }], {
          permissions: { writeFolders: [], httpHosts: [a] }
        }),
        source: 'manual'
      },
      { ...fakeDeps(), http: deps.http }
    )
    expect(run.status).toBe('needs_approval')
    expect(run.approval).toEqual({ kind: 'http', target: b })
  })
})
