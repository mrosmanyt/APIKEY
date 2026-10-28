/**
 * Minimal 5-field cron (minute hour day-of-month month day-of-week) with *, lists (1,2),
 * ranges (1-5) and steps (*\/15, 0-30/5). Day-of-week 0 or 7 = Sunday. When both day fields
 * are restricted, a time matches if EITHER matches (standard cron behaviour).
 */
import type { Trigger } from '@shared/automation'

interface Field {
  values: Set<number>
  any: boolean
}

const RANGES: Array<[number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7]
]

function parseField(text: string, [min, max]: [number, number]): Field {
  const values = new Set<number>()
  const any = text === '*'
  for (const part of text.split(',')) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part)
    if (!m) throw new Error(`Invalid cron field "${text}"`)
    const step = m[2] ? Number(m[2]) : 1
    if (step < 1) throw new Error(`Invalid step in "${text}"`)
    let lo = min
    let hi = max
    if (m[1] !== '*') {
      const [a, b] = m[1].split('-').map(Number)
      lo = a
      hi = b ?? (m[2] ? max : a)
    }
    if (lo < min || hi > max || lo > hi) throw new Error(`Cron value out of range in "${text}"`)
    for (let v = lo; v <= hi; v += step) values.add(v)
  }
  return { values, any }
}

export interface CronExpr {
  minute: Field
  hour: Field
  dom: Field
  month: Field
  dow: Field
}

export function parseCron(expr: string): CronExpr {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5)
    throw new Error('A cron expression needs 5 fields: minute hour day month weekday')
  const [minute, hour, dom, month, dow] = parts.map((p, i) => parseField(p, RANGES[i]))
  if (dow.values.has(7)) dow.values.add(0)
  return { minute, hour, dom, month, dow }
}

export function cronMatches(c: CronExpr, d: Date): boolean {
  if (
    !c.minute.values.has(d.getMinutes()) ||
    !c.hour.values.has(d.getHours()) ||
    !c.month.values.has(d.getMonth() + 1)
  ) {
    return false
  }
  const domOk = c.dom.values.has(d.getDate())
  const dowOk = c.dow.values.has(d.getDay())
  if (c.dom.any && c.dow.any) return true
  if (c.dom.any) return dowOk
  if (c.dow.any) return domOk
  return domOk || dowOk
}

/** Next matching minute strictly after `from` (local time). Searches up to ~4 years. */
export function nextCronTime(expr: string | CronExpr, from: Date): Date | undefined {
  const c = typeof expr === 'string' ? parseCron(expr) : expr
  const d = new Date(from.getTime())
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + 1)
  for (let i = 0; i < 60 * 24 * 366 * 4; i++) {
    if (!c.month.values.has(d.getMonth() + 1)) {
      d.setMonth(d.getMonth() + 1, 1)
      d.setHours(0, 0, 0, 0)
      continue
    }
    if (cronMatches(c, d)) return d
    if (!c.hour.values.has(d.getHours())) {
      d.setHours(d.getHours() + 1, 0, 0, 0)
      continue
    }
    d.setMinutes(d.getMinutes() + 1)
  }
  return undefined
}

function hm(time = '09:00'): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  const h = m ? Math.min(23, Number(m[1])) : 9
  const min = m ? Math.min(59, Number(m[2])) : 0
  return [h, min]
}

/** Cron expression for a schedule trigger (presets or custom). */
export function scheduleToCron(t: Extract<Trigger, { type: 'schedule' }>): string {
  switch (t.preset) {
    case 'hourly':
      return `${Math.min(59, Math.max(0, t.minute ?? 0))} * * * *`
    case 'daily': {
      const [h, m] = hm(t.time)
      return `${m} ${h} * * *`
    }
    case 'weekly': {
      const [h, m] = hm(t.time)
      return `${m} ${h} * * ${Math.min(6, Math.max(0, t.weekday ?? 1))}`
    }
    default:
      return (t.cron ?? '').trim()
  }
}

export function validateCron(expr: string): string | undefined {
  try {
    parseCron(expr)
    return undefined
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}
