import { useEffect, useState } from 'react'
import type { RunStatus, StepRun, Workflow, WorkflowRun } from '@shared/automation'
import { CopyButton } from '../../components/CopyButton'
import { Icon } from '../../components/Icon'
import { t, tDynamic } from '../../i18n'
import { api, call, errorInfo } from '../../lib/api'
import { formatCost } from '../../lib/automation'
import { formatTime } from '../../lib/files'
import { useApp } from '../../lib/store'
import { ApproveDialog } from './WorkflowEditor'

const STATUS_CLS: Record<RunStatus | StepRun['status'], string> = {
  running: 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200',
  success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200',
  cancelled: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  skipped: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  capped: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
  needs_approval: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200'
}

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return (
    <span className={`badge ${STATUS_CLS[status]}`}>{tDynamic(`automation.status_${status}`)}</span>
  )
}

function duration(ms?: number): string {
  return t('automation.durationValue', { seconds: ((ms ?? 0) / 1000).toFixed(1) })
}

function StepDetail({ step }: { step: StepRun }) {
  const [open, setOpen] = useState(step.status === 'failed')
  const inputs = Object.entries(step.input)
  return (
    <div className="card p-3">
      <button className="flex w-full items-center gap-2 text-start" onClick={() => setOpen(!open)}>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} className="h-4 w-4 shrink-0" />
        <span className="font-mono text-xs text-slate-500">{step.stepId}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {step.name || tDynamic(`automation.type_${step.type}`)}
          {step.iteration !== undefined && (
            <span className="ms-2 text-xs text-slate-500">
              {t('automation.iteration', { n: String(step.iteration + 1) })}
            </span>
          )}
        </span>
        {step.costUsd ? (
          <span className="text-xs text-slate-500">
            {t('automation.estCost', { cost: formatCost(step.costUsd) })}
          </span>
        ) : null}
        <span className="text-xs text-slate-500">{duration(step.durationMs)}</span>
        <span className={`badge ${STATUS_CLS[step.status]}`}>
          {tDynamic(`automation.status_${step.status === 'skipped' ? 'cancelled' : step.status}`)}
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-2 text-xs">
          {step.error && (
            <p className="whitespace-pre-wrap rounded bg-red-50 p-2 text-red-700 dark:bg-red-900/30 dark:text-red-200">
              {step.error}
            </p>
          )}
          {inputs.length > 0 && (
            <div>
              <p className="label">{t('automation.stepInput')}</p>
              <dl className="space-y-1">
                {inputs.map(([k, v]) => (
                  <div key={k}>
                    <dt className="font-medium text-slate-500">{k}</dt>
                    <dd
                      className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-2 font-mono dark:bg-slate-900"
                      dir="auto"
                    >
                      {v}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              <p className="label mb-0">{t('automation.stepOutput')}</p>
              {step.outputTruncated && (
                <span className="text-slate-500">{t('automation.outputTruncated')}</span>
              )}
              {step.output && <CopyButton text={step.output} />}
            </div>
            <pre
              className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-2 font-mono dark:bg-slate-900"
              dir="auto"
            >
              {step.output || '—'}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}

export function RunsView({
  workflows,
  workflowId,
  onWorkflowChange,
  batchId
}: {
  workflows: Workflow[]
  workflowId?: string
  onWorkflowChange: (id: string | undefined) => void
  batchId?: string
}) {
  const showToast = useApp((s) => s.showToast)
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [selected, setSelected] = useState<string>()
  const [approving, setApproving] = useState<WorkflowRun>()

  const load = async () => setRuns(await call(api().automation.listRuns(workflowId)))
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId])

  useEffect(
    () =>
      api().automation.onRun((run) => {
        if (workflowId && run.workflowId !== workflowId) return
        setRuns((list) => {
          const i = list.findIndex((r) => r.id === run.id)
          if (i === -1) return [run, ...list]
          const next = list.slice()
          next[i] = run
          return next
        })
      }),
    [workflowId]
  )

  const shown = batchId ? runs.filter((r) => r.batchId === batchId) : runs
  const run = shown.find((r) => r.id === selected)

  const act = async (fn: () => Promise<string>) => {
    try {
      const id = await fn()
      setSelected(id)
    } catch (err) {
      showToast(errorInfo(err).message, 'error')
    }
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-80 shrink-0 flex-col border-e border-slate-200 dark:border-slate-800">
        <div className="flex gap-2 border-b border-slate-200 p-2 dark:border-slate-800">
          <select
            className="input min-w-0 flex-1"
            value={workflowId ?? ''}
            onChange={(e) => onWorkflowChange(e.target.value || undefined)}
          >
            <option value="">{t('automation.allWorkflows')}</option>
            {workflows.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <button
            className="btn-ghost btn-sm"
            title={t('automation.clearHistory')}
            onClick={async () => {
              if (!window.confirm(t('automation.clearConfirm'))) return
              await call(api().automation.clearRuns())
              setSelected(undefined)
              void load()
            }}
          >
            <Icon name="trash" className="h-4 w-4" />
          </button>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {shown.length === 0 && (
            <li className="p-4 text-sm text-slate-500">{t('automation.runsEmpty')}</li>
          )}
          {shown.map((r) => (
            <li key={r.id}>
              <button
                className={`w-full border-b border-slate-100 px-3 py-2 text-start dark:border-slate-800 ${
                  r.id === selected
                    ? 'bg-brand-50 dark:bg-brand-900/30'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
                onClick={() => setSelected(r.id)}
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {r.workflowName}
                  </span>
                  <RunStatusBadge status={r.status} />
                </div>
                <div className="mt-0.5 flex gap-2 text-xs text-slate-500">
                  <span>{tDynamic(`automation.source_${r.source}`)}</span>
                  <span>{formatTime(r.startedAt)}</span>
                  {r.durationMs !== undefined && <span>{duration(r.durationMs)}</span>}
                  {r.costUsd > 0 && <span>{formatCost(r.costUsd)}</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto p-4">
        {!run ? (
          <p className="py-16 text-center text-slate-500">{t('automation.selectRun')}</p>
        ) : (
          <div className="mx-auto max-w-3xl space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="me-auto text-lg font-semibold">{run.workflowName}</h2>
              <RunStatusBadge status={run.status} />
              {run.status === 'running' && (
                <button
                  className="btn-secondary btn-sm"
                  onClick={() => void call(api().automation.cancelRun(run.id))}
                >
                  <Icon name="stop" className="h-3.5 w-3.5" />
                  {t('automation.cancel')}
                </button>
              )}
              {(run.status === 'failed' ||
                run.status === 'capped' ||
                run.status === 'cancelled') && (
                <button
                  className="btn-primary btn-sm"
                  onClick={() => void act(() => call(api().automation.retryRun(run.id)))}
                >
                  <Icon name="refresh" className="h-3.5 w-3.5" />
                  {t('automation.retryFromFailed')}
                </button>
              )}
              {run.status === 'needs_approval' && run.approval && (
                <button className="btn-primary btn-sm" onClick={() => setApproving(run)}>
                  {t('automation.approveAndRetry')}
                </button>
              )}
            </div>
            <p className="text-xs text-slate-500">
              {t('automation.started', { time: formatTime(run.startedAt) })} ·{' '}
              {tDynamic(`automation.source_${run.source}`)}
              {run.durationMs !== undefined && ` · ${duration(run.durationMs)}`} ·{' '}
              {t('automation.estCost', { cost: formatCost(run.costUsd) })}
            </p>
            {run.input && (
              <pre
                className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs dark:bg-slate-900"
                dir="auto"
              >
                {run.input}
              </pre>
            )}
            {run.error && (
              <p className="whitespace-pre-wrap rounded bg-red-50 p-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-200">
                {run.error}
              </p>
            )}
            {run.steps.map((s, i) => (
              <StepDetail key={`${s.stepId}-${s.iteration ?? ''}-${i}`} step={s} />
            ))}
          </div>
        )}
      </div>
      {approving?.approval && (
        <ApproveDialog
          name={approving.workflowName}
          approvals={[approving.approval]}
          onClose={() => setApproving(undefined)}
          onAllow={() => {
            const id = approving.id
            setApproving(undefined)
            void act(() => call(api().automation.approveRun(id)))
          }}
        />
      )}
    </div>
  )
}
