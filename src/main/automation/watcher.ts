/**
 * Folder watch trigger. Polls the folder (robust on network drives and cloud-synced folders)
 * and uses fs.watch as a hint to scan sooner. Files already present when watching starts are
 * ignored; a new file is reported once its size has stopped changing (copy finished).
 */
import fs from 'node:fs'
import path from 'node:path'

/** "*.mp3;*.wav" / "*.txt, report*" → matcher (case-insensitive). Empty = everything. */
export function patternMatcher(pattern = ''): (name: string) => boolean {
  const parts = pattern
    .split(/[;,]/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (!parts.length) return () => true
  const res = parts.map(
    (p) =>
      new RegExp(
        `^${p
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.')}$`,
        'i'
      )
  )
  return (name) => res.some((r) => r.test(name))
}

/** Files (not folders, not hidden/temporary) in a folder matching a pattern, sorted by name. */
export function listMatchingFiles(folder: string, pattern?: string): string[] {
  const match = patternMatcher(pattern)
  return fs
    .readdirSync(folder, { withFileTypes: true })
    .filter(
      (d) =>
        d.isFile() &&
        !d.name.startsWith('.') &&
        !d.name.startsWith('~$') &&
        !/\.(tmp|part|crdownload)$/i.test(d.name) &&
        match(d.name)
    )
    .map((d) => path.join(folder, d.name))
    .sort((a, b) => a.localeCompare(b))
}

export class FolderWatcher {
  private timer?: NodeJS.Timeout
  private fsWatcher?: fs.FSWatcher
  private known = new Set<string>()
  private pending = new Map<string, number>()
  private scanning = false

  constructor(
    readonly folder: string,
    private readonly pattern: string | undefined,
    private readonly onFile: (file: string) => void,
    private readonly intervalMs = 3000,
    private readonly onError: (err: Error) => void = () => {}
  ) {}

  start(): void {
    try {
      for (const f of listMatchingFiles(this.folder, this.pattern)) this.known.add(f)
    } catch (err) {
      this.onError(err as Error)
    }
    this.timer = setInterval(() => void this.scan(), this.intervalMs)
    try {
      this.fsWatcher = fs.watch(this.folder, () => void this.scan())
      this.fsWatcher.on('error', () => undefined)
    } catch {
      /* polling still works */
    }
  }

  stop(): void {
    clearInterval(this.timer)
    this.fsWatcher?.close()
    this.timer = undefined
    this.fsWatcher = undefined
  }

  /** One scan. Exposed for tests. */
  async scan(): Promise<void> {
    if (this.scanning) return
    this.scanning = true
    try {
      if (!fs.existsSync(this.folder)) return
      for (const file of listMatchingFiles(this.folder, this.pattern)) {
        if (this.known.has(file)) continue
        let size: number
        try {
          size = fs.statSync(file).size
        } catch {
          continue
        }
        // Report only when the size is unchanged since the previous scan (copy finished).
        if (this.pending.get(file) === size && size > 0) {
          this.pending.delete(file)
          this.known.add(file)
          this.onFile(file)
        } else {
          this.pending.set(file, size)
        }
      }
    } catch (err) {
      this.onError(err as Error)
    } finally {
      this.scanning = false
    }
  }
}
