/**
 * Optional local webhook server for "Local webhook" triggers. OFF unless the user enables it.
 *  - Listens on 127.0.0.1 only (never reachable from other computers).
 *  - Every request needs the random token in the "Authorization: Bearer <token>" header. It is
 *    never accepted in the URL (URLs end up in logs, shell history and browser history).
 *  - Requests sent by an automation HTTP step are refused, so a workflow can't trigger itself.
 *  - POST /run/<workflowId> with any text/JSON body (max 1 MB) → {{webhook.body}}.
 */
import crypto from 'node:crypto'
import http from 'node:http'
import { AUTOMATION_HEADER } from './engine'

export const MAX_WEBHOOK_BODY = 1024 * 1024

export function newToken(): string {
  return crypto.randomBytes(24).toString('base64url')
}

export function tokenMatches(given: string | undefined, expected: string): boolean {
  if (!given || !expected) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export type WebhookHandler = (
  workflowId: string,
  body: string
) => Promise<{ status: number; json: unknown }>

export class WebhookServer {
  private server?: http.Server
  port = 0

  constructor(
    private readonly getToken: () => string,
    private readonly handler: WebhookHandler
  ) {}

  get running(): boolean {
    return Boolean(this.server?.listening)
  }

  start(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => void this.handle(req, res))
      server.on('error', reject)
      server.listen(port, '127.0.0.1', () => {
        this.server = server
        const addr = server.address()
        this.port = typeof addr === 'object' && addr ? addr.port : port
        resolve(this.port)
      })
    })
  }

  stop(): Promise<void> {
    const s = this.server
    this.server = undefined
    return new Promise((resolve) => (s ? s.close(() => resolve()) : resolve()))
  }

  private send(res: http.ServerResponse, status: number, json: unknown) {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(json))
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (req.method === 'GET' && url.pathname === '/health') return this.send(res, 200, { ok: true })

    if (req.headers[AUTOMATION_HEADER.toLowerCase()] !== undefined)
      return this.send(res, 403, { error: 'Workflows cannot call the AI Hub webhook' })
    const auth = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.authorization ?? '')?.[1]
    if (!tokenMatches(auth, this.getToken()))
      return this.send(res, 401, { error: 'Invalid or missing token' })

    const m = /^\/run\/([A-Za-z0-9_-]{1,80})$/.exec(url.pathname)
    if (!m) return this.send(res, 404, { error: 'Use POST /run/<workflowId>' })
    if (req.method !== 'POST') return this.send(res, 405, { error: 'Use POST' })

    let size = 0
    const chunks: Buffer[] = []
    try {
      for await (const chunk of req) {
        size += (chunk as Buffer).length
        if (size > MAX_WEBHOOK_BODY)
          return this.send(res, 413, { error: 'Body too large (max 1 MB)' })
        chunks.push(chunk as Buffer)
      }
    } catch {
      return this.send(res, 400, { error: 'Could not read body' })
    }
    try {
      const out = await this.handler(m[1], Buffer.concat(chunks).toString('utf8'))
      this.send(res, out.status, out.json)
    } catch (err) {
      this.send(res, 500, { error: err instanceof Error ? err.message : 'Error' })
    }
  }
}
