/**
 * Local text extraction for chat attachments. Runs in the main process; nothing is uploaded
 * anywhere except as text inside the chat request the user sends.
 */
import type { ExtractedFile } from '@shared/types'
import { ProviderError } from '../../providers/errors'

/** ~1.5M characters ≈ 375k tokens — beyond any current model, and within the IPC limits. */
export const MAX_EXTRACTED_CHARS = 1_500_000
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024

export type DocumentKind = 'pdf' | 'docx' | 'text'

export function documentKind(name: string, mime: string): DocumentKind | undefined {
  const lower = name.toLowerCase()
  if (mime === 'application/pdf' || lower.endsWith('.pdf')) return 'pdf'
  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lower.endsWith('.docx')
  )
    return 'docx'
  if (mime.startsWith('text/') || lower.endsWith('.txt')) return 'text'
  return undefined
}

function unsupported(message: string): ProviderError {
  return new ProviderError({ kind: 'unsupported', message })
}

/** Normalise whitespace: unify newlines, drop trailing spaces, collapse 3+ blank lines. */
export function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function extractPdf(data: Buffer): Promise<{ text: string; pages: number }> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  let pdf
  try {
    pdf = await getDocumentProxy(new Uint8Array(data))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/password/i.test(msg))
      throw unsupported('This PDF is password-protected. Remove the password and try again.')
    throw unsupported('This PDF could not be read (it may be damaged).')
  }
  const { totalPages, text } = await extractText(pdf, { mergePages: false })
  const pages = (Array.isArray(text) ? text : [text]).map((t, i) => `[Page ${i + 1}]\n${t}`)
  return { text: pages.join('\n\n'), pages: totalPages }
}

async function extractDocx(data: Buffer): Promise<string> {
  const mammoth = await import('mammoth')
  try {
    const { value } = await (mammoth.default ?? mammoth).extractRawText({ buffer: data })
    return value
  } catch {
    throw unsupported(
      'This Word document could not be read. Save it as .docx (Word 2007 or newer) and try again.'
    )
  }
}

export async function extractDocument(
  name: string,
  mime: string,
  data: Buffer
): Promise<ExtractedFile> {
  if (data.length > MAX_DOCUMENT_BYTES) throw unsupported('The file is larger than 50 MB.')
  const kind = documentKind(name, mime)
  if (!kind) {
    if (name.toLowerCase().endsWith('.doc')) {
      throw unsupported('Old .doc files are not supported. Open it in Word and save as .docx.')
    }
    throw unsupported('Only PDF, DOCX and text files can be read.')
  }
  let raw: string
  let pages: number | undefined
  if (kind === 'pdf') {
    const r = await extractPdf(data)
    raw = r.text
    pages = r.pages
  } else if (kind === 'docx') {
    raw = await extractDocx(data)
  } else {
    raw = data.toString('utf8').replace(/^\uFEFF/, '')
  }
  const text = cleanText(raw)
  if (!text.replace(/\[Page \d+\]/g, '').trim()) {
    throw unsupported(
      kind === 'pdf'
        ? 'No text found in this PDF. It may be a scanned image — try a model that accepts images instead.'
        : 'This file contains no text.'
    )
  }
  const truncated = text.length > MAX_EXTRACTED_CHARS
  return {
    text: truncated ? text.slice(0, MAX_EXTRACTED_CHARS) : text,
    pages,
    truncated,
    originalChars: text.length
  }
}
