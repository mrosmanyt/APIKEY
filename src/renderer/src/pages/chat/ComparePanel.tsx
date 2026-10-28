import { useRef, useState } from 'react'
import { newId } from '@shared/ids'
import type { AppErrorInfo, TokenUsage } from '@shared/types'
import { CopyButton } from '../../components/CopyButton'
import { ErrorBox } from '../../components/ErrorBox'
import { Icon } from '../../components/Icon'
import { Markdown } from '../../components/Markdown'
import { ProviderModelPicker } from '../../components/ProviderModelPicker'
import { t } from '../../i18n'
import { startChatStream, stopChatStream } from '../../lib/chatStream'
import { modelsFor, usableProviders, useApp } from '../../lib/store'
import type { Selection } from '../../lib/selection'

interface Column {
  key: string
  sel?: Selection
  text: string
  error?: AppErrorInfo
  usage?: TokenUsage
  requestId?: string
}

export function ComparePanel() {
  const providers = useApp((s) => s.providers)
  const statuses = useApp((s) => s.statuses)
  const settings = useApp((s) => s.settings)!
  const usable = usableProviders({ providers, statuses }, 'chat')

  const initialSel = (i: number): Selection | undefined => {
    const p = usable[i % Math.max(1, usable.length)]
    return p
      ? {
          providerId: p.id,
          model:
            modelsFor(p, 'chat', settings)[i < usable.length ? 0 : 1]?.id ??
            modelsFor(p, 'chat', settings)[0]?.id ??
            ''
        }
      : undefined
  }

  const [columns, setColumns] = useState<Column[]>(() =>
    [0, 1].map((i) => ({ key: newId('col_'), sel: initialSel(i), text: '' }))
  )
  const [prompt, setPrompt] = useState('')
  const [lastPrompt, setLastPrompt] = useState('')
  const colsRef = useRef(columns)
  colsRef.current = columns

  const patch = (key: string, fn: (c: Column) => Column) =>
    setColumns((cols) => cols.map((c) => (c.key === key ? fn(c) : c)))
  const busy = columns.some((c) => c.requestId)

  const sendAll = () => {
    if (!prompt.trim() || busy) return
    setLastPrompt(prompt)
    for (const col of colsRef.current) {
      if (!col.sel?.model) continue
      const rid = startChatStream(
        {
          providerId: col.sel.providerId,
          model: col.sel.model,
          temperature: settings.chat.temperature,
          maxTokens: settings.chat.maxTokens,
          messages: [{ role: 'user', content: prompt }]
        },
        {
          onDelta: (text) => patch(col.key, (c) => ({ ...c, text: c.text + text })),
          onDone: (usage) => patch(col.key, (c) => ({ ...c, usage, requestId: undefined })),
          onError: (error) => patch(col.key, (c) => ({ ...c, error, requestId: undefined }))
        }
      )
      patch(col.key, (c) => ({
        ...c,
        text: '',
        error: undefined,
        usage: undefined,
        requestId: rid
      }))
    }
    setPrompt('')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-4 pt-3 text-sm text-slate-500">
        <span className="mr-auto">{t('compare.hint')}</span>
        {columns.length < 3 && (
          <button
            className="btn-secondary btn-sm"
            onClick={() =>
              setColumns((c) => [...c, { key: newId('col_'), sel: initialSel(c.length), text: '' }])
            }
          >
            <Icon name="plus" className="h-3.5 w-3.5" />
            {t('compare.addColumn')}
          </button>
        )}
      </div>
      {lastPrompt && (
        <div className="mx-4 mt-2 truncate rounded-lg bg-brand-600 px-3 py-2 text-sm text-white">
          {lastPrompt}
        </div>
      )}
      <div
        className="grid min-h-0 flex-1 gap-3 p-4"
        style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
      >
        {columns.map((col) => (
          <div key={col.key} className="card flex min-h-0 flex-col">
            <div className="flex items-start gap-1 border-b border-slate-200 p-2 dark:border-slate-800">
              <div className="min-w-0 flex-1">
                <ProviderModelPicker
                  capability="chat"
                  value={col.sel}
                  onChange={(sel) => patch(col.key, (c) => ({ ...c, sel }))}
                />
              </div>
              {columns.length > 2 && (
                <button
                  className="btn-ghost btn-sm mt-5"
                  title={t('compare.removeColumn')}
                  onClick={() => setColumns((c) => c.filter((x) => x.key !== col.key))}
                >
                  <Icon name="x" />
                </button>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {col.text ? (
                <Markdown text={col.text} />
              ) : (
                !col.error && (
                  <p className="text-sm text-slate-400">
                    {col.requestId ? t('chat.thinking') : t('compare.waiting')}
                  </p>
                )
              )}
              {col.error && col.error.kind !== 'cancelled' && (
                <ErrorBox error={col.error} compact />
              )}
            </div>
            <div className="flex items-center gap-2 border-t border-slate-200 px-3 py-1 text-xs text-slate-500 dark:border-slate-800">
              {col.usage && (
                <span>
                  {t('chat.tokens', {
                    input: col.usage.inputTokens ?? '–',
                    output: col.usage.outputTokens ?? '–'
                  })}
                </span>
              )}
              <span className="ml-auto" />
              {col.text && <CopyButton text={col.text} />}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-end gap-2 border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <textarea
          className="input min-h-[42px] flex-1 resize-none"
          rows={2}
          placeholder={t('compare.placeholder')}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              sendAll()
            }
          }}
        />
        {busy ? (
          <button
            className="btn-danger"
            onClick={() => columns.forEach((c) => c.requestId && stopChatStream(c.requestId))}
          >
            <Icon name="stop" />
            {t('chat.stop')}
          </button>
        ) : (
          <button className="btn-primary" onClick={sendAll} disabled={!prompt.trim()}>
            <Icon name="send" />
            {t('compare.sendAll')}
          </button>
        )}
      </div>
    </div>
  )
}
