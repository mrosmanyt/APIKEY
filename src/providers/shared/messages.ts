import type { Attachment, ChatRequest } from '@shared/types'

/** Inline text attachments into the message body so every provider receives them. */
export function textWithAttachments(content: string, attachments?: Attachment[]): string {
  const textFiles = (attachments ?? []).filter((a) => a.kind === 'text' && a.text !== undefined)
  if (textFiles.length === 0) return content
  const blocks = textFiles.map((a) => `--- File: ${a.name} ---\n\`\`\`\n${a.text}\n\`\`\``)
  return `${content}\n\n${blocks.join('\n\n')}`.trim()
}

export function imageAttachments(attachments?: Attachment[]): Attachment[] {
  return (attachments ?? []).filter((a) => a.kind === 'image' && a.dataBase64)
}

export function hasImages(req: ChatRequest): boolean {
  return req.messages.some((m) => imageAttachments(m.attachments).length > 0)
}
