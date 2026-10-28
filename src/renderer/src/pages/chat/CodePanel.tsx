import { useMemo } from 'react'
import type { ChatMessage } from '@shared/types'
import { CopyButton } from '../../components/CopyButton'
import { Icon } from '../../components/Icon'
import { t } from '../../i18n'
import { api, call, errorInfo } from '../../lib/api'
import { extractCodeBlocks, suggestFileName } from '../../lib/code'
import { useApp } from '../../lib/store'

export function CodePanel({ messages }: { messages: ChatMessage[] }) {
  const showToast = useApp((s) => s.showToast)
  const blocks = useMemo(
    () =>
      messages.filter((m) => m.role === 'assistant').flatMap((m) => extractCodeBlocks(m.content)),
    [messages]
  )

  return (
    <aside className="hidden w-[26rem] shrink-0 flex-col border-s border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950 xl:flex">
      <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold dark:border-slate-800">
        {t('chat.codeBlocks')} ({blocks.length})
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {blocks.length === 0 && (
          <p className="p-4 text-center text-sm text-slate-500">{t('chat.noCodeBlocks')}</p>
        )}
        {blocks.map((b, i) => {
          const name = suggestFileName(b, i)
          return (
            <div
              key={i}
              className="overflow-hidden rounded-lg border border-slate-700 bg-[#0d1117] text-slate-100"
            >
              <div className="flex items-center gap-1 border-b border-slate-700 px-2 py-1 text-xs text-slate-400">
                <span className="me-auto truncate" title={name}>
                  {b.fileName ?? b.language}
                </span>
                <CopyButton
                  text={b.code}
                  className="btn btn-sm text-slate-300 hover:bg-slate-700"
                  label={false}
                />
                <button
                  className="btn btn-sm text-slate-300 hover:bg-slate-700"
                  title={t('chat.saveToFile')}
                  onClick={async () => {
                    try {
                      const path = await call(api().files.saveText(name, b.code))
                      if (path) showToast(t('common.savedTo', { path }))
                    } catch (err) {
                      showToast(errorInfo(err).message, 'error')
                    }
                  }}
                >
                  <Icon name="download" className="h-3.5 w-3.5" />
                </button>
              </div>
              <pre className="max-h-64 overflow-auto p-2 font-mono text-[12px] leading-snug">
                {b.code}
              </pre>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
