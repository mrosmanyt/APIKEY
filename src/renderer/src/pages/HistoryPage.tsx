import { useCallback, useEffect, useState } from 'react'
import type { ConversationSummary } from '@shared/types'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { t } from '../i18n'
import { api, call, errorInfo } from '../lib/api'
import { formatTime } from '../lib/files'
import { useApp } from '../lib/store'

export function HistoryPage() {
  const page = useApp((s) => s.page)
  const providers = useApp((s) => s.providers)
  const openConversationIn = useApp((s) => s.openConversationIn)
  const showToast = useApp((s) => s.showToast)
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<ConversationSummary[]>([])
  const [renaming, setRenaming] = useState<{ id: string; title: string }>()

  const load = useCallback(async () => {
    setItems(
      await call(query.trim() ? api().conversations.search(query) : api().conversations.list())
    )
  }, [query])

  useEffect(() => {
    if (page !== 'history') return
    const h = setTimeout(() => void load(), 150)
    return () => clearTimeout(h)
  }, [load, page])

  const providerName = (id: string) => providers.find((p) => p.id === id)?.name ?? id

  const exportConv = async (id: string, format: 'markdown' | 'json') => {
    try {
      const path = await call(api().conversations.export(id, format))
      if (path) showToast(t('common.savedTo', { path }))
    } catch (err) {
      showToast(errorInfo(err).message, 'error')
    }
  }

  return (
    <>
      <PageHeader title={t('history.title')}>
        <input
          className="input w-72"
          placeholder={t('common.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-4xl space-y-2">
          {items.length === 0 && (
            <p className="py-16 text-center text-slate-500">
              {query ? t('history.noResults') : t('history.empty')}
            </p>
          )}
          {items.map((c) => (
            <div key={c.id} className="card flex flex-wrap items-center gap-3 p-3">
              <Icon name={c.mode === 'code' ? 'code' : 'chat'} className="h-5 w-5 text-slate-400" />
              <div className="min-w-0 flex-1">
                {renaming?.id === c.id ? (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault()
                      await call(api().conversations.rename(c.id, renaming.title))
                      setRenaming(undefined)
                      void load()
                    }}
                  >
                    <input
                      className="input"
                      value={renaming.title}
                      onChange={(e) => setRenaming({ ...renaming, title: e.target.value })}
                      autoFocus
                      onBlur={() => setRenaming(undefined)}
                      aria-label={t('history.renamePrompt')}
                    />
                  </form>
                ) : (
                  <button
                    className="block w-full truncate text-start font-medium hover:text-brand-600"
                    onClick={() => openConversationIn(c.mode, c.id)}
                  >
                    {c.title}
                  </button>
                )}
                <div className="text-xs text-slate-500">
                  {c.mode === 'code' ? t('history.codeMode') : t('history.chatMode')} ·{' '}
                  {providerName(c.providerId)} · {c.model} ·{' '}
                  {t('history.messages', { count: c.messageCount })} · {formatTime(c.updatedAt)}
                </div>
                {c.snippet && (
                  <div className="mt-1 truncate text-xs italic text-slate-500">{c.snippet}</div>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                <button
                  className="btn-ghost btn-sm"
                  onClick={() => openConversationIn(c.mode, c.id)}
                >
                  {t('common.open')}
                </button>
                <button
                  className="btn-ghost btn-sm"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setRenaming({ id: c.id, title: c.title })}
                >
                  <Icon name="edit" className="h-3.5 w-3.5" />
                  {t('common.rename')}
                </button>
                <button className="btn-ghost btn-sm" onClick={() => exportConv(c.id, 'markdown')}>
                  {t('history.exportMd')}
                </button>
                <button className="btn-ghost btn-sm" onClick={() => exportConv(c.id, 'json')}>
                  {t('history.exportJson')}
                </button>
                <button
                  className="btn-ghost btn-sm text-red-600"
                  onClick={async () => {
                    if (!window.confirm(t('common.confirmDelete'))) return
                    await call(api().conversations.delete(c.id))
                    void load()
                  }}
                >
                  <Icon name="trash" className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
