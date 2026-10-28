import { describe, expect, it } from 'vitest'
import {
  cleanText,
  documentKind,
  extractDocument,
  MAX_EXTRACTED_CHARS
} from '../src/main/services/documents'
import { makeDocx, makePdf } from './helpers/documents'

describe('document extraction', () => {
  it('detects supported kinds', () => {
    expect(documentKind('a.PDF', '')).toBe('pdf')
    expect(documentKind('a.docx', '')).toBe('docx')
    expect(documentKind('notes.txt', '')).toBe('text')
    expect(documentKind('x', 'text/plain')).toBe('text')
    expect(documentKind('a.doc', 'application/msword')).toBeUndefined()
  })

  it('extracts PDF text per page', async () => {
    const out = await extractDocument(
      'report.pdf',
      'application/pdf',
      makePdf(['Quarterly revenue grew', 'Second page text'])
    )
    expect(out.pages).toBe(2)
    expect(out.text).toContain('[Page 1]')
    expect(out.text).toContain('Quarterly revenue grew')
    expect(out.text).toContain('[Page 2]')
    expect(out.text).toContain('Second page text')
    expect(out.truncated).toBe(false)
  })

  it('extracts DOCX text', async () => {
    const out = await extractDocument(
      'letter.docx',
      '',
      await makeDocx(['Dear Sir,', 'Thanks for the invoice.'])
    )
    expect(out.text).toContain('Dear Sir,')
    expect(out.text).toContain('Thanks for the invoice.')
  })

  it('reads TXT (strips BOM, normalises newlines)', async () => {
    const out = await extractDocument(
      'a.txt',
      'text/plain',
      Buffer.from('﻿line 1\r\nline 2   \r\n\r\n\r\n\r\nline 3')
    )
    expect(out.text).toBe('line 1\nline 2\n\nline 3')
  })

  it('truncates very large text and reports it', async () => {
    const big = 'word '.repeat(MAX_EXTRACTED_CHARS / 4)
    const out = await extractDocument('big.txt', 'text/plain', Buffer.from(big))
    expect(out.truncated).toBe(true)
    expect(out.text.length).toBe(MAX_EXTRACTED_CHARS)
    expect(out.originalChars).toBeGreaterThan(MAX_EXTRACTED_CHARS)
  })

  it('gives clear errors for unsupported or broken files', async () => {
    await expect(
      extractDocument('old.doc', 'application/msword', Buffer.from('x'))
    ).rejects.toThrow(/save as \.docx/i)
    await expect(extractDocument('a.zip', 'application/zip', Buffer.from('x'))).rejects.toThrow(
      /Only PDF, DOCX/
    )
    await expect(
      extractDocument('bad.pdf', 'application/pdf', Buffer.from('not a pdf'))
    ).rejects.toThrow(/could not be read/)
    await expect(extractDocument('bad.docx', '', Buffer.from('not a zip'))).rejects.toThrow(
      /could not be read/
    )
    await expect(
      extractDocument('empty.txt', 'text/plain', Buffer.from('   \n  '))
    ).rejects.toThrow(/no text/)
  })

  it('cleanText collapses blank lines', () => {
    expect(cleanText('a\n\n\n\nb')).toBe('a\n\nb')
  })
})
