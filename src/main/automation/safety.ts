/**
 * Safety rules for workflows:
 *  - writes outside the output folder need the user's approval (per workflow, per folder);
 *  - HTTP calls to external hosts need approval (per workflow, per host); loopback is allowed;
 *  - reading the app's own data folder (encrypted keys, license) is never allowed;
 *  - max runs per hour.
 */
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

export function checkWrite(
  target: string,
  outputDir: string,
  perms: WorkflowPermissions
): Approval | undefined {
  if (isInside(outputDir, target)) return undefined
  if (perms.writeFolders.some((f) => isInside(f, target))) return undefined
  return { kind: 'write', target: path.dirname(target) }
}

/** The app's data folder (keys, settings, license) is off-limits — except the output folder if a user put it there. */
export function checkRead(
  target: string,
  protectedDir: string,
  outputDir?: string
): string | undefined {
  if (outputDir && isInside(outputDir, target)) return undefined
  return isInside(protectedDir, target)
    ? 'Workflows cannot read AI Hub’s private data folder.'
    : undefined
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export function checkUrl(
  url: string,
  perms: WorkflowPermissions
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
  if (LOOPBACK.has(u.hostname.toLowerCase())) return { host }
  if (perms.httpHosts.map((h) => h.toLowerCase()).includes(host)) return { host }
  return { approval: { kind: 'http', target: host }, host }
}

/** Runs started within the last hour, for the max-runs-per-hour limit. */
export function runsInLastHour(startTimes: number[], now = Date.now()): number {
  return startTimes.filter((t) => now - t < 3_600_000).length
}
