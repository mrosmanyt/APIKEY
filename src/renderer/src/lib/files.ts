import { newId } from '@shared/ids'
import type { AppErrorInfo, Attachment } from '@shared/types'
import { api, call, errorInfo } from './api'

export const MAX_IMAGE_MB = 20
export const MAX_TEXT_MB = 2

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const TEXT_EXT =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|yaml|yml|toml|ini|cfg|conf|log|html?|css|scss|less|js|jsx|mjs|cjs|ts|tsx|py|rb|php|java|kt|kts|swift|go|rs|c|h|cpp|hpp|cc|cs|fs|vb|sql|sh|bash|zsh|ps1|bat|cmd|r|lua|pl|dart|scala|vue|svelte|graphql|proto|env\.example|gitignore|dockerfile)$/i

export function readAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result)
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export type AttachmentResult =
  | { ok: true; attachment: Attachment }
  | { ok: false; reason: 'too_large' | 'unsupported' }
  | { ok: false; reason: 'error'; error: AppErrorInfo }

export const MAX_DOCUMENT_MB = 50
const DOC_EXT = /\.(pdf|docx?)$/i
const DOC_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]

export function isDocument(file: { name: string; type: string }): boolean {
  return DOC_TYPES.includes(file.type) || DOC_EXT.test(file.name)
}

/** PDF/DOCX (and oversized .txt) text is extracted locally in the main process. */
async function documentToAttachment(file: File): Promise<AttachmentResult> {
  if (file.size > MAX_DOCUMENT_MB * 1024 * 1024) return { ok: false, reason: 'too_large' }
  try {
    const out = await call(
      api().files.extract({ name: file.name, mime: file.type, base64: await readAsBase64(file) })
    )
    return {
      ok: true,
      attachment: {
        id: newId('att_'),
        name: file.name,
        mime: file.type || 'text/plain',
        kind: 'text',
        size: file.size,
        text: out.text,
        pages: out.pages,
        truncated: out.truncated || undefined
      }
    }
  } catch (err) {
    return { ok: false, reason: 'error', error: errorInfo(err) }
  }
}

export async function fileToAttachment(file: File): Promise<AttachmentResult> {
  if (isDocument(file)) return documentToAttachment(file)
  if (IMAGE_TYPES.includes(file.type)) {
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) return { ok: false, reason: 'too_large' }
    return {
      ok: true,
      attachment: {
        id: newId('att_'),
        name: file.name,
        mime: file.type,
        kind: 'image',
        size: file.size,
        dataBase64: await readAsBase64(file)
      }
    }
  }
  if (
    file.type.startsWith('text/') ||
    TEXT_EXT.test(file.name) ||
    file.type === 'application/json'
  ) {
    // Large text files go through the extractor, which truncates them safely.
    if (file.size > MAX_TEXT_MB * 1024 * 1024) return documentToAttachment(file)
    return {
      ok: true,
      attachment: {
        id: newId('att_'),
        name: file.name,
        mime: file.type || 'text/plain',
        kind: 'text',
        size: file.size,
        text: await file.text()
      }
    }
  }
  return { ok: false, reason: 'unsupported' }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleString()
}

export function mediaUrl(kind: 'image' | 'audio' | 'video', id: string, version?: number): string {
  return `aihub-media://${kind}/${encodeURIComponent(id)}${version ? `?v=${version}` : ''}`
}
