import { useEffect, useState } from 'react'
import { newId } from '@shared/ids'
import type { PromptMode, SavedPrompt } from '@shared/types'
import { CopyButton } from '../components/CopyButton'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { PageHeader } from '../components/PageHeader'
import { t, tDynamic } from '../i18n'
import { api, call } from '../lib/api'
import { useApp, type Page } from '../lib/store'

const MODES: PromptMode[] = ['any', 'chat', 'code', 'image', 'video', 'tts']
const TARGET: Record<PromptMode, Page> = {
  any: 'chat',
  chat: 'chat',
  code: 'code',
  image: 'images',
  video: 'video',
  tts: 'audio'
}

function blank(): SavedPrompt {
  const now = Date.now()
  return {
    id: newId('p_'),
    title: '',
    content: '',
    mode: 'any',
    favourite: false,
    createdAt: now,
    updatedAt: now
  }
}

export function PromptsPage() {
  const applyPrompt = useApp((s) => s.applyPrompt)
  const [prompts, setPrompts] = useState<SavedPrompt[]>([])
  const [editing, setEditing] = useState<SavedPrompt>()
  const [query, setQuery] = useState('')
  const [favOnly, setFavOnly] = useState(false)

  const load = async () => setPrompts(await call(api().prompts.list()))
  useEffect(() => {
    void load()
  }, [])

  const save = async (p: SavedPrompt) => {
    await call(api().prompts.save(p))
    setEditing(undefined)
    void load()
  }

  const list = prompts
    .filter((p) => !favOnly || p.favourite)
    .filter((p) => !query || `${p.title} ${p.content}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => Number(b.favourite) - Number(a.favourite) || b.updatedAt - a.updatedAt)

  return (
    <>
      <PageHeader title={t('prompts.title')}>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={favOnly} onChange={(e) => setFavOnly(e.target.checked)} />
          {t('prompts.favouritesOnly')}
        </label>
        <input
          className="input w-60"
          placeholder={t('common.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn-primary" onClick={() => setEditing(blank())}>
          <Icon name="plus" />
          {t('prompts.new')}
        </button>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {list.length === 0 && (
          <p className="py-16 text-center text-slate-500">{t('prompts.empty')}</p>
        )}
        <div className="mx-auto grid max-w-6xl grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
          {list.map((p) => (
            <div key={p.id} className="card flex flex-col p-4">
              <div className="flex items-start gap-2">
                <h3 className="min-w-0 flex-1 truncate font-semibold">{p.title}</h3>
                <button
                  className={p.favourite ? 'text-amber-500' : 'text-slate-400 hover:text-amber-500'}
                  title={t('prompts.favourite')}
                  onClick={() => save({ ...p, favourite: !p.favourite })}
                >
                  <Icon name="star" />
                </button>
              </div>
              <span className="badge mt-1 w-fit bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {tDynamic(`prompts.mode_${p.mode}`)}
              </span>
              <p className="mt-2 line-clamp-4 flex-1 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">
                {p.content}
              </p>
              <div className="mt-3 flex flex-wrap gap-1">
                <button
                  className="btn-primary btn-sm"
                  onClick={() => applyPrompt({ page: TARGET[p.mode], text: p.content })}
                >
                  {t('common.use')}
                </button>
                <CopyButton text={p.content} />
                <button className="btn-ghost btn-sm" onClick={() => setEditing(p)}>
                  <Icon name="edit" className="h-3.5 w-3.5" />
                  {t('common.edit')}
                </button>
                <button
                  className="btn-ghost btn-sm ml-auto text-red-600"
                  title={t('common.delete')}
                  onClick={async () => {
                    if (!window.confirm(t('common.confirmDelete'))) return
                    await call(api().prompts.delete(p.id))
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
      {editing && (
        <PromptEditor prompt={editing} onClose={() => setEditing(undefined)} onSave={save} />
      )}
    </>
  )
}

function PromptEditor({
  prompt,
  onClose,
  onSave
}: {
  prompt: SavedPrompt
  onClose: () => void
  onSave: (p: SavedPrompt) => void
}) {
  const [p, setP] = useState(prompt)
  const valid = p.title.trim() && p.content.trim()
  return (
    <Modal
      title={prompt.title ? prompt.title : t('prompts.new')}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="btn-primary"
            disabled={!valid}
            onClick={() => onSave({ ...p, title: p.title.trim() })}
          >
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
          <div>
            <label className="label">{t('prompts.titleLabel')}</label>
            <input
              className="input"
              value={p.title}
              onChange={(e) => setP({ ...p, title: e.target.value })}
              autoFocus
            />
          </div>
          <div>
            <label className="label">{t('prompts.mode')}</label>
            <select
              className="input"
              value={p.mode}
              onChange={(e) => setP({ ...p, mode: e.target.value as PromptMode })}
            >
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {tDynamic(`prompts.mode_${m}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="label">{t('prompts.content')}</label>
          <textarea
            className="input min-h-[14rem]"
            value={p.content}
            onChange={(e) => setP({ ...p, content: e.target.value })}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={p.favourite}
            onChange={(e) => setP({ ...p, favourite: e.target.checked })}
          />
          {t('prompts.favourite')}
        </label>
      </div>
    </Modal>
  )
}
