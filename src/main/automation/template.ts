/**
 * {{variable}} templating for workflow steps.
 *
 * Available names: {{input}}, {{stepId.output}}, {{stepId.status}} (HTTP), {{row.column}}
 * (CSV batch), {{loop.item}} / {{loop.index}}, {{trigger.file}} / {{trigger.fileName}},
 * {{file.path}} / {{file.name}} (folder batch), {{webhook.body}}, {{date}}, {{time}},
 * {{datetime}}, {{workflow.name}}. Unknown names render as "" and are reported.
 */
export type Vars = Record<string, string>

const TOKEN = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g

export function renderTemplate(template: string, vars: Vars): { text: string; missing: string[] } {
  const missing: string[] = []
  const text = (template ?? '').replace(TOKEN, (_, name: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name]
    missing.push(name)
    return ''
  })
  return { text, missing: [...new Set(missing)] }
}

/** Names referenced by a template (for the editor's "unknown variable" hints). */
export function templateVariables(template: string): string[] {
  return [...new Set([...(template ?? '').matchAll(TOKEN)].map((m) => m[1]))]
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Built-in date/time variables (local time). */
export function clockVars(now: Date): Vars {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}`
  return { date, time, datetime: `${date}_${time}-${pad(now.getSeconds())}` }
}

/** Turn a CSV row into {{row.column}} variables (column names lower-cased, spaces → _). */
export function rowVars(row: Record<string, string>): Vars {
  const out: Vars = {}
  for (const [k, v] of Object.entries(row))
    out[`row.${k.trim().toLowerCase().replace(/\s+/g, '_')}`] = v
  return out
}
