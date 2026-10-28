import fs from 'node:fs'
import path from 'node:path'
import { redactValue } from '@shared/redact'

type Level = 'debug' | 'info' | 'warn' | 'error'

const MAX_BYTES = 5 * 1024 * 1024

/**
 * Append-only log file with simple rotation (app.log -> app.1.log). Every message and
 * metadata value passes through redaction before being written.
 */
export class Logger {
  readonly file: string

  constructor(
    readonly dir: string,
    private readonly echo = false
  ) {
    this.file = path.join(dir, 'app.log')
  }

  debug(msg: string, meta?: unknown) {
    this.write('debug', msg, meta)
  }
  info(msg: string, meta?: unknown) {
    this.write('info', msg, meta)
  }
  warn(msg: string, meta?: unknown) {
    this.write('warn', msg, meta)
  }
  error(msg: string, meta?: unknown) {
    this.write('error', msg, meta)
  }

  private write(level: Level, msg: string, meta?: unknown) {
    const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${redactValue(msg)}${
      meta === undefined ? '' : ` ${redactValue(meta)}`
    }\n`
    if (this.echo) {
      if (level === 'error') console.error(line.trimEnd())
      else if (level === 'warn') console.warn(line.trimEnd())
      else process.stdout.write(line)
    }
    try {
      fs.mkdirSync(this.dir, { recursive: true })
      this.rotateIfNeeded()
      fs.appendFileSync(this.file, line, 'utf8')
    } catch {
      /* never crash because of logging */
    }
  }

  private rotateIfNeeded() {
    try {
      const { size } = fs.statSync(this.file)
      if (size > MAX_BYTES) fs.renameSync(this.file, path.join(this.dir, 'app.1.log'))
    } catch {
      /* file does not exist yet */
    }
  }
}

let current: Logger | undefined

export function initLogger(dir: string, echo: boolean): Logger {
  current = new Logger(dir, echo)
  return current
}

export function log(): Logger {
  if (!current) current = new Logger(path.join(process.cwd(), 'logs'), true)
  return current
}
