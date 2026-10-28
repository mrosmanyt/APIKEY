import { useState } from 'react'
import type { ChatMessage } from '@shared/types'
import { CopyButton } from '../../components/CopyButton'
import { ErrorBox } from '../../components/ErrorBox'
import { Icon } from '../../components/Icon'
import { Markdown } from '../../components/Markdown'
import { formatUsd } from '@shared/pricing'
import { t } from '../../i18n'
import { useMessageCost } from '../../lib/cost'

export function MessageView({
  message,
  streaming,
  canRegenerate,
  canEdit,
  onRegenerate,
  onEdit
}: {
  message: ChatMessage
  streaming: boolean
  canRegenerate: boolean
  canEdit: boolean
  onRegenerate: () => void
  onEdit: (text: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const isUser = message.role === 'user'
  const cost = useMessageCost(message.providerId, message.model, message.usage)

  return (
    <div className={`group flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          isUser
            ? 'bg-slate-300 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
            : 'bg-gradient-to-br from-brand-500 to-violet-600 text-white'
        }`}
      >
        {isUser ? t('chat.you').slice(0, 1) : 'AI'}
      </div>
      <div className={`min-w-0 max-w-[85%] ${isUser ? 'items-end' : ''} flex flex-col`}>
        <div
          className={`rounded-2xl px-4 py-2 ${
            isUser
              ? 'bg-brand-600 text-white'
              : 'border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
          }`}
        >
          {message.attachments && message.attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {message.attachments.map((a) =>
                a.kind === 'image' && a.dataBase64 ? (
                  <img
                    key={a.id}
                    src={`data:${a.mime};base64,${a.dataBase64}`}
                    alt={a.name}
                    className="max-h-40 rounded-lg"
                  />
                ) : (
                  <span
                    key={a.id}
                    className={`badge ${isUser ? 'bg-white/20' : 'bg-slate-100 dark:bg-slate-800'}`}
                  >
                    <Icon name="code" className="h-3 w-3" />
                    {a.name}
                  </span>
                )
              )}
            </div>
          )}
          {editing ? (
            <div className="flex w-[min(40rem,70vw)] flex-col gap-2">
              <textarea
                className="input min-h-[6rem] text-slate-900 dark:text-slate-100"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <button className="btn-ghost btn-sm text-white" onClick={() => setEditing(false)}>
                  {t('common.cancel')}
                </button>
                <button
                  className="btn-secondary btn-sm"
                  onClick={() => {
                    setEditing(false)
                    onEdit(draft)
                  }}
                  disabled={!draft.trim()}
                >
                  {t('chat.saveAndResend')}
                </button>
              </div>
            </div>
          ) : isUser ? (
            <div className="whitespace-pre-wrap break-words text-sm" dir="auto">
              {message.content}
            </div>
          ) : message.content ? (
            <Markdown text={message.content} />
          ) : streaming ? (
            <div className="flex items-center gap-2 py-1 text-sm text-slate-500">
              <span className="h-2 w-2 animate-pulse rounded-full bg-brand-500" />
              {t('chat.thinking')}
            </div>
          ) : null}
          {message.error && message.error.kind !== 'cancelled' && (
            <div className="mt-2">
              <ErrorBox error={message.error} compact />
            </div>
          )}
          {message.error?.kind === 'cancelled' && (
            <div className="mt-1 text-xs italic text-slate-500">{t('chat.stopped')}</div>
          )}
        </div>
        {!streaming && !editing && (
          <div
            className={`mt-1 flex items-center gap-1 text-xs text-slate-500 opacity-0 transition group-hover:opacity-100 ${isUser ? 'justify-end' : ''}`}
          >
            {message.content && <CopyButton text={message.content} />}
            {canEdit && (
              <button
                className="btn-ghost btn-sm"
                onClick={() => {
                  setDraft(message.content)
                  setEditing(true)
                }}
              >
                <Icon name="edit" className="h-3.5 w-3.5" />
                {t('chat.editLast')}
              </button>
            )}
            {canRegenerate && (
              <button className="btn-ghost btn-sm" onClick={onRegenerate}>
                <Icon name="refresh" className="h-3.5 w-3.5" />
                {t('chat.regenerate')}
              </button>
            )}
            {!isUser && message.model && <span className="px-1">{message.model}</span>}
            {message.usage && (message.usage.inputTokens || message.usage.outputTokens) ? (
              <span
                className="px-1"
                title={message.usage.estimated ? t('chat.tokensEstimated') : undefined}
              >
                {message.usage.estimated ? '≈ ' : ''}
                {t('chat.tokens', {
                  input: message.usage.inputTokens ?? '–',
                  output: message.usage.outputTokens ?? '–'
                })}
              </span>
            ) : null}
            {cost !== undefined && (
              <span className="px-1" title={t('chat.costHint')}>
                ≈ {formatUsd(cost)}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
