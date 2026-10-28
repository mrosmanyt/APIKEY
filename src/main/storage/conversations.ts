import fs from 'node:fs'
import path from 'node:path'
import type { Conversation, ConversationSummary } from '@shared/types'
import { writeJsonAtomic } from './jsonStore'

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/

/** One JSON file per conversation, with an in-memory cache for listing and search. */
export class ConversationStore {
  private cache: Map<string, Conversation> | undefined

  constructor(private readonly dir: string) {}

  private file(id: string): string {
    if (!SAFE_ID.test(id)) throw new Error('Invalid conversation id')
    return path.join(this.dir, `${id}.json`)
  }

  private load(): Map<string, Conversation> {
    if (this.cache) return this.cache
    const map = new Map<string, Conversation>()
    if (fs.existsSync(this.dir)) {
      for (const name of fs.readdirSync(this.dir)) {
        if (!name.endsWith('.json')) continue
        try {
          const conv = JSON.parse(
            fs.readFileSync(path.join(this.dir, name), 'utf8')
          ) as Conversation
          if (conv?.id && Array.isArray(conv.messages)) map.set(conv.id, conv)
        } catch {
          /* skip unreadable files */
        }
      }
    }
    this.cache = map
    return map
  }

  list(): ConversationSummary[] {
    return [...this.load().values()].map(summarize).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  get(id: string): Conversation | undefined {
    return this.load().get(id)
  }

  all(): Conversation[] {
    return [...this.load().values()]
  }

  save(conv: Conversation): Conversation {
    const saved = { ...conv, updatedAt: Date.now() }
    writeJsonAtomic(this.file(conv.id), saved)
    this.load().set(conv.id, saved)
    return saved
  }

  rename(id: string, title: string): Conversation | undefined {
    const conv = this.get(id)
    if (!conv) return undefined
    return this.save({ ...conv, title: title.trim() || conv.title })
  }

  delete(id: string): void {
    const f = this.file(id)
    if (fs.existsSync(f)) fs.unlinkSync(f)
    this.load().delete(id)
  }

  search(query: string): ConversationSummary[] {
    const q = query.trim().toLowerCase()
    if (!q) return this.list()
    const results: ConversationSummary[] = []
    for (const conv of this.load().values()) {
      if (conv.title.toLowerCase().includes(q)) {
        results.push(summarize(conv))
        continue
      }
      const hit = conv.messages.find((m) => m.content.toLowerCase().includes(q))
      if (hit) {
        const i = hit.content.toLowerCase().indexOf(q)
        const start = Math.max(0, i - 40)
        const snippet = `${start > 0 ? '…' : ''}${hit.content.slice(start, i + q.length + 60)}`
        results.push({ ...summarize(conv), snippet })
      }
    }
    return results.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  replaceAll(convs: Conversation[]): void {
    for (const c of this.all()) this.delete(c.id)
    for (const c of convs) if (SAFE_ID.test(c.id)) this.save(c)
  }
}

function summarize(c: Conversation): ConversationSummary {
  return {
    id: c.id,
    title: c.title,
    mode: c.mode,
    providerId: c.providerId,
    model: c.model,
    messageCount: c.messages.length,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt
  }
}

export function conversationToMarkdown(c: Conversation): string {
  const lines = [
    `# ${c.title}`,
    '',
    `- Provider: ${c.providerId}`,
    `- Model: ${c.model}`,
    `- Created: ${new Date(c.createdAt).toISOString()}`,
    ''
  ]
  if (c.systemPrompt.trim()) lines.push('## System prompt', '', c.systemPrompt, '')
  for (const m of c.messages) {
    lines.push(`## ${m.role === 'user' ? 'You' : `Assistant${m.model ? ` (${m.model})` : ''}`}`, '')
    lines.push(m.content || (m.error ? `_Error: ${m.error.message}_` : ''))
    if (m.attachments?.length)
      lines.push('', `_Attachments: ${m.attachments.map((a) => a.name).join(', ')}_`)
    lines.push('')
  }
  return lines.join('\n')
}

/** Export JSON without heavy base64 attachment payloads. */
export function conversationToJson(c: Conversation): string {
  const slim = {
    ...c,
    messages: c.messages.map((m) => ({
      ...m,
      attachments: m.attachments?.map(({ dataBase64: _d, ...rest }) => rest)
    }))
  }
  return JSON.stringify(slim, null, 2)
}
