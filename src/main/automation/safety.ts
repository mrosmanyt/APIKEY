/**
 * Safety rules for workflows:
 *  - writes outside the output folder need the user's approval (per workflow, per folder);
 *  - HTTP calls need approval (per workflow, per host) — loopback hosts included — and the app's
 *    own webhook port can never be called (no self-trigger loops);
 *  - reading the app's own data folder (encrypted keys, license) is never allowed;
 *  - paths are compared after resolving symlinks/junctions, so a link cannot reach that folder.
 *  - max runs per hour.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Approval, WorkflowPermissions } from '@shared/automation'

/** True if `child` is `parent` or inside it (case-insensitive on Windows). */
export function isInside(parent: string, child: string): boolean {
  const norm = (p: string) => {
    const r = path.resolve(p)
    return process.platform === 'win32' ? r.toLowerCase() : r
  }
  const rel = path.relative(norm(parent), norm(child))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** Resolve a step path: relative paths are inside <outputDir>/automation. */
export function resolveStepPath(p: string, outputDir: string): string {
  const cleaned = p.trim().replace(/^["']|["']$/g, '')
  if (!cleaned) throw new Error('The file path is empty.')
  return path.isAbsolute(cleaned)
    ? path.normalize(cleaned)
    : path.resolve(outputDir, 'automation', cleaned)
}

/**
 * The real location of `p` with every symlink/junction resolved. For a path that doesn't exist
 * yet (a file about to be written), the nearest existing parent is resolved and the rest of the
 * path is appended.
 */
export function realPath(p: string): string {
  let current = path.resolve(p)
  const rest: string[] = []
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(current), ...rest)
    } catch (err) {
      const parent = path.dirname(current)
      const code = (err as NodeJS.ErrnoException).code
      if (parent === current || (code !== 'ENOENT' && code !== 'ENOTDIR'))
        return path.join(current, ...rest)
      rest.unshift(path.basename(current))
      current = parent
    }
  }
}

const insideReal = (parent: string, child: string) => isInside(realPath(parent), child)

export function checkWrite(
  target: string,
  outputDir: string,
  perms: WorkflowPermissions
): Approval | undefined {
  const real = realPath(target)
  if (insideReal(outputDir, real)) return undefined
  if (perms.writeFolders.some((f) => insideReal(f, real))) return undefined
  return { kind: 'write', target: path.dirname(real) }
}

/** The app's data folder (keys, settings, license) is off-limits — except the output folder if a user put it there. */
export function checkRead(
  target: string,
  protectedDir: string,
  outputDir?: string
): string | undefined {
  const real = realPath(target)
  if (outputDir && insideReal(outputDir, real)) return undefined
  return insideReal(protectedDir, real) || isInside(protectedDir, target)
    ? 'Workflows cannot read AI Hub’s private data folder.'
    : undefined
}

/** localhost, *.localhost, 127.0.0.0/8, 0.0.0.0, ::1 and IPv4-mapped loopback. `hostname` is URL.hostname. */
export function isLoopback(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '')
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) || h === '0.0.0.0') return true
  const v6 = h.replace(/^\[|\]$/g, '')
  return v6 === '::1' || v6 === '::' || /^::ffff:(127\.|7f[0-9a-f]{2}:)/.test(v6)
}

export interface UrlCheckOptions {
  /** The local webhook port: loopback requests to it are always refused. */
  webhookPort?: number
}

export function checkUrl(
  url: string,
  perms: WorkflowPermissions,
  opts: UrlCheckOptions = {}
): { approval?: Approval; error?: string; host?: string } {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return { error: `Not a valid URL: ${url}` }
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:')
    return { error: 'Only http(s) URLs are allowed.' }
  if (u.username || u.password) return { error: 'URLs with embedded credentials are not allowed.' }
  const host = u.host.toLowerCase()
  const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80))
  if (opts.webhookPort && port === opts.webhookPort && isLoopback(u.hostname))
    return {
      error: 'Workflows cannot call AI Hub’s own webhook (this could start an endless loop).',
      host
    }
  if (perms.httpHosts.map((h) => h.toLowerCase()).includes(host)) return { host }
  return { approval: { kind: 'http', target: host }, host }
}

/** Runs started within the last hour, for the max-runs-per-hour limit. */
export function runsInLastHour(startTimes: number[], now = Date.now()): number {
  return startTimes.filter((t) => now - t < 3_600_000).length
}
