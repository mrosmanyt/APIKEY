import { useState } from 'react'
import type { PromptMode, SavedPrompt } from '@shared/types'
import { t } from '../i18n'
import { api, call } from '../lib/api'
import { Icon } from './Icon'
import { Modal } from './Modal'

/** Button that opens the prompt library and inserts the chosen prompt. */
export function PromptPickerButton({
  modes,
  onPick
}: {
  modes: PromptMode[]
  onPick: (text: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [prompts, setPrompts] = useState<SavedPrompt[]>([])
  const [q, setQ] = useState('')

  const show = async () => {
    setPrompts(await call(api().prompts.list()))
    setQ('')
    setOpen(true)
  }

  const list = prompts
    .filter((p) => modes.includes(p.mode) || p.mode === 'any')
    .filter((p) => !q || `${p.title} ${p.content}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(b.favourite) - Number(a.favourite) || b.updatedAt - a.updatedAt)

  return (
    <>
      <button
        className="btn-ghost"
        onClick={show}
        title={t('chat.insertPrompt')}
        aria-label={t('chat.insertPrompt')}
      >
        <Icon name="prompts" className="h-5 w-5" />
      </button>
      {open && (
        <Modal title={t('prompts.pick')} onClose={() => setOpen(false)}>
          <input
            className="input mb-3"
            placeholder={t('common.search')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          {list.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">{t('prompts.empty')}</p>
          ) : (
            <ul className="space-y-2">
              {list.map((p) => (
                <li key={p.id}>
                  <button
                    className="w-full rounded-lg border border-slate-200 p-3 text-left hover:border-brand-400 hover:bg-brand-50 dark:border-slate-700 dark:hover:bg-slate-800"
                    onClick={() => {
                      onPick(p.content)
                      setOpen(false)
                    }}
                  >
                    <div className="flex items-center gap-1 font-medium">
                      {p.favourite && <Icon name="star" className="h-3.5 w-3.5 text-amber-500" />}
                      {p.title}
                    </div>
                    <div className="line-clamp-2 text-xs text-slate-500">{p.content}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </>
  )
}
