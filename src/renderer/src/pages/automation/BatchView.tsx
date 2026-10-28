import { useEffect, useState } from 'react'
import type { BatchJob, BatchSource, Workflow } from '@shared/automation'
import { Icon } from '../../components/Icon'
import { t, tDynamic } from '../../i18n'
import { api, call, errorInfo } from '../../lib/api'
import { formatCost } from '../../lib/automation'
import { formatTime } from '../../lib/files'
import { useApp } from '../../lib/store'

const SOURCES: Array<{ id: BatchSource; label: string }> = [
  { id: 'csv', label: 'automation.source_csv' },
  { id: 'txt', label: 'automation.source_txt' },
  { id: 'folder', label: 'automation.source_folderFiles' }
]

export function BatchView({
  workflows,
  onViewRuns
}: {
  workflows: Workflow[]
  onViewRuns: (b: BatchJob) => void
}) {
  const showToast = useApp((s) => s.showToast)
  const [batches, setBatches] = useState<BatchJob[]>([])
  const [workflowId, setWorkflowId] = useState(workflows[0]?.id ?? '')
  const [source, setSource] = useState<BatchSource>('csv')
  const [sourcePath, setSourcePath] = useState('')
  const [pattern, setPattern] = useState('')
  const [concurrency, setConcurrency] = useState(2)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void call(api().automation.listBatches()).then(setBatches)
    return api().automation.onBatch((b) =>
      setBatches((list) => {
        const i = list.findIndex((x) => x.id === b.id)
        if (i === -1) return [b, ...list]
        const next = list.slice()
        next[i] = b
        return next
      })
    )
  }, [])

  useEffect(() => {
    if (!workflows.some((w) => w.id === workflowId)) setWorkflowId(workflows[0]?.id ?? '')
  }, [workflows, workflowId])

  const start = async () => {
    setBusy(true)
    try {
      const job = await call(
        api().automation.startBatch({
          workflowId,
          source,
          sourcePath,
          pattern: source === 'folder' ? pattern.trim() || undefined : undefined,
          concurrency
        })
      )
      setBatches((list) => [job, ...list.filter((b) => b.id !== job.id)])
    } catch (err) {
      showToast(errorInfo(err).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const act = async (fn: () => Promise<BatchJob | null>) => {
    try {
      const b = await fn()
      if (b) setBatches((list) => list.map((x) => (x.id === b.id ? b : x)))
    } catch (err) {
      showToast(errorInfo(err).message, 'error')
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="card space-y-3 p-4">
          <p className="text-sm text-slate-500">{t('automation.batchIntro')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">{t('automation.batchWorkflow')}</label>
              <select
                className="input"
                value={workflowId}
                onChange={(e) => setWorkflowId(e.target.value)}
              >
                {workflows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">{t('automation.batchSource')}</label>
              <select
                className="input"
                value={source}
                onChange={(e) => {
                  setSource(e.target.value as BatchSource)
                  setSourcePath('')
                }}
              >
                {SOURCES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {tDynamic(s.label)}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label">{t('automation.batchFile')}</label>
              <div className="flex gap-2">
                <input
                  className="input font-mono text-xs"
                  dir="ltr"
                  value={sourcePath}
                  onChange={(e) => setSourcePath(e.target.value)}
                />
                <button
                  className="btn-secondary btn-sm shrink-0"
                  onClick={async () => {
                    const p = await call(
                      api().automation.pickPath(
                        source === 'folder' ? 'folder' : 'file',
                        source === 'folder' ? undefined : [source]
                      )
                    )
                    if (p) setSourcePath(p)
                  }}
                >
                  {t('automation.browse')}
                </button>
              </div>
            </div>
            {source === 'folder' && (
              <div>
                <label className="label">{t('automation.pattern')}</label>
                <input
                  className="input font-mono text-xs"
                  dir="ltr"
                  placeholder="*.mp3;*.wav"
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                />
              </div>
            )}
            <div>
              <label className="label">{t('automation.concurrency')}</label>
              <input
                type="number"
                min={1}
                max={8}
                className="input w-28"
                value={concurrency}
                onChange={(e) =>
                  setConcurrency(Math.min(8, Math.max(1, Math.round(Number(e.target.value) || 1))))
                }
              />
            </div>
          </div>
          <button
            className="btn-primary"
            disabled={busy || !workflowId || !sourcePath.trim()}
            onClick={() => void start()}
          >
            <Icon name="play" />
            {t('automation.startBatch')}
          </button>
        </div>

        <h3 className="font-semibold">{t('automation.batches')}</h3>
        {batches.length === 0 && (
          <p className="text-sm text-slate-500">{t('automation.noBatches')}</p>
        )}
        {batches.map((b) => {
          const pct = b.total ? Math.round(((b.done + b.failed) / b.total) * 100) : 0
          const active = b.status === 'running' || b.status === 'paused'
          return (
            <div key={b.id} className="card p-4" data-testid="batch">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{b.workflowName}</span>
                <span className="badge bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {tDynamic(`automation.batch_${b.status}`)}
                </span>
                {b.status === 'running' && (
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => void act(() => call(api().automation.pauseBatch(b.id)))}
                  >
                    <Icon name="pause" className="h-3.5 w-3.5" />
                    {t('automation.pause')}
                  </button>
                )}
                {b.status === 'paused' && (
                  <button
                    className="btn-primary btn-sm"
                    onClick={() => void act(() => call(api().automation.resumeBatch(b.id)))}
                  >
                    <Icon name="play" className="h-3.5 w-3.5" />
                    {t('automation.resume')}
                  </button>
                )}
                {active && (
                  <button
                    className="btn-ghost btn-sm"
                    onClick={() => void act(() => call(api().automation.cancelBatch(b.id)))}
                  >
                    <Icon name="stop" className="h-3.5 w-3.5" />
                    {t('common.cancel')}
                  </button>
                )}
                <button className="btn-ghost btn-sm" onClick={() => onViewRuns(b)}>
                  {t('automation.viewRuns')}
                </button>
                {!active && (
                  <button
                    className="btn-ghost btn-sm text-red-600"
                    title={t('common.delete')}
                    onClick={async () => {
                      await call(api().automation.deleteBatch(b.id))
                      setBatches((list) => list.filter((x) => x.id !== b.id))
                    }}
                  >
                    <Icon name="trash" className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <p className="mt-1 truncate font-mono text-xs text-slate-500" dir="ltr">
                {b.sourcePath}
              </p>
              <div className="mt-2 h-2 overflow-hidden rounded bg-slate-200 dark:bg-slate-800">
                <div className="h-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {t('automation.batchProgress', {
                  done: String(b.done),
                  failed: String(b.failed),
                  running: String(b.running),
                  total: String(b.total)
                })}{' '}
                · {formatCost(b.costUsd)} · {formatTime(b.createdAt)}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
