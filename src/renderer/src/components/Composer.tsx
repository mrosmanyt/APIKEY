import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Attachment } from '@shared/types'
import { t } from '../i18n'
import {
  fileToAttachment,
  formatBytes,
  MAX_DOCUMENT_MB,
  MAX_IMAGE_MB,
  MAX_TEXT_MB
} from '../lib/files'
import { attachmentTokens, formatTokens, sizeWarning } from '../lib/tokens'
import { useApp } from '../lib/store'
import { Icon } from './Icon'

export function Composer({
  placeholder,
  busy,
  onSend,
  onStop,
  allowImages,
  extraButtons,
  value,
  onValueChange,
  contextWindow
}: {
  placeholder: string
  busy: boolean
  onSend: (text: string, attachments: Attachment[]) => void
  onStop: () => void
  allowImages: boolean
  extraButtons?: ReactNode
  value: string
  onValueChange: (v: string) => void
  /** Selected model's context window (tokens), for the "too large" warning. */
  contextWindow?: number
}) {
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const showToast = useApp((s) => s.showToast)

  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 280)}px`
  }, [value])

  const addFiles = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      const res = await fileToAttachment(f)
      if (res.ok) {
        setAttachments((a) => [...a, res.attachment])
        if (res.attachment.truncated)
          showToast(t('chat.attachmentTruncated', { name: f.name }), 'error')
      } else if (res.reason === 'too_large')
        showToast(
          t('chat.attachmentTooLarge', {
            name: f.name,
            max: f.type.startsWith('image/')
              ? MAX_IMAGE_MB
              : /\.(pdf|docx)$/i.test(f.name)
                ? MAX_DOCUMENT_MB
                : MAX_TEXT_MB
          }),
          'error'
        )
      else if (res.reason === 'error') showToast(`${f.name}: ${res.error.message}`, 'error')
      else showToast(t('chat.attachmentUnsupported', { name: f.name }), 'error')
    }
  }

  const hasImages = attachments.some((a) => a.kind === 'image')
  const blocked = hasImages && !allowImages
  const size = sizeWarning(
    attachmentTokens(attachments) + Math.ceil(value.length / 4),
    contextWindow
  )

  const send = () => {
    if (busy || blocked || (!value.trim() && attachments.length === 0)) return
    onSend(value, attachments)
    setAttachments([])
  }

  return (
    <div
      className="border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files)
      }}
    >
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800"
            >
              {a.kind === 'image' ? (
                <img
                  src={`data:${a.mime};base64,${a.dataBase64}`}
                  alt=""
                  className="h-8 w-8 rounded object-cover"
                />
              ) : (
                <Icon name="code" className="h-4 w-4" />
              )}
              <span className="max-w-[12rem] truncate">{a.name}</span>
              <span className="text-slate-500">
                {a.pages ? `${t('chat.pages', { count: a.pages })} · ` : ''}
                {a.text !== undefined
                  ? t('chat.approxTokens', { tokens: formatTokens(Math.ceil(a.text.length / 4)) })
                  : formatBytes(a.size)}
              </span>
              {a.truncated && (
                <span className="badge bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                  {t('chat.truncated')}
                </span>
              )}
              <button
                className="text-slate-500 hover:text-red-600"
                onClick={() => setAttachments((x) => x.filter((y) => y.id !== a.id))}
                aria-label={t('common.delete')}
              >
                <Icon name="x" className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      {blocked && <div className="mb-2 text-xs text-amber-600">{t('chat.visionUnsupported')}</div>}
      {size.level === 'too_large' && (
        <div
          className="mb-2 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
          role="alert"
        >
          <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t(size.assumed ? 'chat.tooLargeUnknown' : 'chat.tooLarge', {
              tokens: formatTokens(size.tokens),
              limit: formatTokens(size.limit)
            })}
          </span>
        </div>
      )}
      {size.level === 'info' && attachments.length > 0 && (
        <div className="mb-2 text-xs text-slate-500">
          {t('chat.contextUse', {
            tokens: formatTokens(size.tokens),
            limit: formatTokens(size.limit)
          })}
        </div>
      )}
      <div className="flex items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <button
          className="btn-ghost"
          onClick={() => fileRef.current?.click()}
          title={t('chat.attach')}
          aria-label={t('chat.attach')}
        >
          <Icon name="paperclip" className="h-5 w-5" />
        </button>
        {extraButtons}
        <textarea
          ref={taRef}
          data-composer="true"
          dir={value ? 'auto' : undefined}
          rows={1}
          className="input max-h-72 min-h-[42px] flex-1 resize-none"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files)
            if (files.length) {
              e.preventDefault()
              void addFiles(files)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
        />
        {busy ? (
          <button className="btn-danger" onClick={onStop}>
            <Icon name="stop" />
            {t('chat.stop')}
          </button>
        ) : (
          <button
            className="btn-primary"
            onClick={send}
            disabled={blocked || (!value.trim() && attachments.length === 0)}
          >
            <Icon name="send" />
            {t('chat.send')}
          </button>
        )}
      </div>
    </div>
  )
}
