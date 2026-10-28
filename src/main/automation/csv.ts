/** CSV (RFC 4180-ish) and TXT parsing for batch runs. */

/** Parse CSV text into rows of cells. Handles quotes, escaped quotes ("") and newlines in quotes. */
export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const src = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
    } else if (ch === '"' && cell === '') {
      quoted = true
    } else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/** Excel in many locales saves CSV with ";" — pick whichever appears more in the header. */
export function detectDelimiter(text: string): string {
  const header = text.split(/\r?\n/, 1)[0] ?? ''
  const count = (c: string) => header.split(c).length - 1
  return count(';') > count(',') ? ';' : count('\t') > count(',') ? '\t' : ','
}

/** CSV with a header row → objects keyed by header. Duplicate/empty headers get col1, col2… */
export function csvToRecords(text: string): {
  columns: string[]
  records: Array<Record<string, string>>
} {
  const [header, ...rest] = parseCsv(text)
  if (!header) return { columns: [], records: [] }
  const seen = new Set<string>()
  const columns = header.map((h, i) => {
    let name = h.trim() || `col${i + 1}`
    while (seen.has(name)) name = `${name}_${i + 1}`
    seen.add(name)
    return name
  })
  const records = rest.map((cells) =>
    Object.fromEntries(columns.map((c, i) => [c, (cells[i] ?? '').trim()]))
  )
  return { columns, records }
}

/** Non-empty, trimmed lines of a text file. */
export function txtLines(text: string): string[] {
  return text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

/** Split a loop's list: one item per line (default), a JSON array, or comma-separated. */
export function splitItems(
  text: string,
  separator: 'lines' | 'json' | 'comma' = 'lines'
): string[] {
  if (separator === 'json') {
    const parsed = JSON.parse(text) as unknown
    if (!Array.isArray(parsed)) throw new Error('Loop items are not a JSON array')
    return parsed.map((v) => (typeof v === 'string' ? v : JSON.stringify(v)))
  }
  if (separator === 'comma')
    return text
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  return txtLines(text)
}
