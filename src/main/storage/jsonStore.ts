import fs from 'node:fs'
import path from 'node:path'

/**
 * Tiny JSON-file store with atomic writes (write to temp file, then rename) and recovery
 * from corrupt files (the corrupt file is kept as *.corrupt-<time> and defaults are used).
 *
 * We use JSON files instead of SQLite to avoid native-module rebuilds for Electron; see
 * DECISIONS.md.
 */
export class JsonStore<T> {
  private cache: T | undefined

  constructor(
    readonly filePath: string,
    private readonly defaults: () => T
  ) {}

  read(): T {
    if (this.cache !== undefined) return this.cache
    this.cache = this.load()
    return this.cache
  }

  write(value: T): void {
    this.cache = value
    writeJsonAtomic(this.filePath, value)
  }

  update(fn: (current: T) => T): T {
    const next = fn(this.read())
    this.write(next)
    return next
  }

  /** Drop the in-memory cache (for tests / after restore). */
  reload(): T {
    this.cache = undefined
    return this.read()
  }

  private load(): T {
    if (!fs.existsSync(this.filePath)) return this.defaults()
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8')
      if (!raw.trim()) return this.defaults()
      return JSON.parse(raw) as T
    } catch {
      try {
        fs.renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`)
      } catch {
        /* ignore */
      }
      return this.defaults()
    }
  }
}

export function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  fs.renameSync(tmp, filePath)
}

/** A store holding an array of records with string ids. */
export class CollectionStore<T extends { id: string }> {
  private readonly store: JsonStore<T[]>

  constructor(filePath: string) {
    this.store = new JsonStore<T[]>(filePath, () => [])
  }

  all(): T[] {
    return this.store.read()
  }

  get(id: string): T | undefined {
    return this.all().find((r) => r.id === id)
  }

  upsert(record: T): T {
    this.store.update((list) => {
      const idx = list.findIndex((r) => r.id === record.id)
      if (idx >= 0) {
        const copy = [...list]
        copy[idx] = record
        return copy
      }
      return [record, ...list]
    })
    return record
  }

  patch(id: string, changes: Partial<T>): T | undefined {
    const existing = this.get(id)
    if (!existing) return undefined
    return this.upsert({ ...existing, ...changes })
  }

  remove(id: string): T | undefined {
    const existing = this.get(id)
    if (existing) this.store.update((list) => list.filter((r) => r.id !== id))
    return existing
  }

  replaceAll(records: T[]): void {
    this.store.write(records)
  }
}
