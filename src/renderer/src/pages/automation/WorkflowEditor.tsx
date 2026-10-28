import { useEffect, useMemo, useRef, useState } from 'react'
import type { Approval, SchedulePreset, Trigger, Workflow } from '@shared/automation'
import { CopyButton } from '../../components/CopyButton'
import { Icon } from '../../components/Icon'
import { Modal } from '../../components/Modal'
import { t, tDynamic } from '../../i18n'
import { api, call, errorInfo } from '../../lib/api'
import { nextStepId } from '../../lib/automation'
import { formatTime } from '../../lib/files'
import { useApp } from '../../lib/store'
import { StepList } from './StepList'

const PRESETS: SchedulePreset[] = ['hourly', 'daily', 'weekly', 'custom']
const TRIGGERS: Trigger['type'][] = ['manual', 'schedule', 'folder', 'webhook']
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]

function weekdayName(d: number): string {
  // 2023-01-01 was a Sunday.
  return new Date(2023, 0, 1 + d).toLocaleDateString(undefined, { weekday: 'long' })
}

function defaultTrigger(type: Trigger['type']): Trigger {
  switch (type) {
    case 'schedule':
      return { type, preset: 'daily', time: '09:00', minute: 0, weekday: 1, cron: '0 9 * * 1-5' }
    case 'folder':
      return { type, folder: '', pattern: '' }
    default:
      return { type }
  }
}

export function ApproveDialog({
  name,
  approvals,
  onAllow,
  onClose
}: {
  name: string
  approvals: Approval[]
  onAllow: () => void
  onClose: () => void
}) {
  return (
    <Modal
      title={t('automation.approveTitle')}
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn-primary" onClick={onAllow}>
            {t('automation.allow')}
          </button>
        </>
      }
    >
      <p className="text-sm">{t('automation.approveIntro', { name })}</p>
      <ul className="my-3 space-y-1 text-sm">
        {approvals.map((a) => (
          <li key={`${a.kind}:${a.target}`} className="flex items-start gap-2">
            <Icon
              name={a.kind === 'write' ? 'folder' : 'external'}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <span className="break-all font-mono text-xs" dir="ltr">
              {a.kind === 'write'
                ? t('automation.approveWrite', { target: a.target })
                : t('automation.approveHttp', { target: a.target })}
            </span>
          </li>
        ))}
      </ul>
      <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
        {t('automation.approveWarning')}
      </p>
    </Modal>
  )
}

function TriggerEditor({
  trigger,
  onChange,
  nextRun
}: {
  trigger: Trigger
  onChange: (t: Trigger) => void
  nextRun?: number
}) {
  const [webhookBase, setWebhookBase] = useState<{ url: string; on: boolean }>()
  useEffect(() => {
    if (trigger.type !== 'webhook') return
    void call(api().automation.webhookInfo())
      .then((w) => setWebhookBase({ url: w.baseUrl, on: w.enabled && w.running }))
      .catch(() => undefined)
  }, [trigger.type])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {TRIGGERS.map((type) => (
          <button
            key={type}
            className={trigger.type === type ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
            onClick={() => trigger.type !== type && onChange(defaultTrigger(type))}
          >
            {tDynamic(`automation.trigger_${type}`)}
          </button>
        ))}
      </div>
      {trigger.type === 'schedule' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label">{t('automation.trigger_schedule')}</label>
              <select
                className="input"
                value={trigger.preset}
                onChange={(e) => onChange({ ...trigger, preset: e.target.value as SchedulePreset })}
              >
                {PRESETS.map((p) => (
                  <option key={p} value={p}>
                    {tDynamic(`automation.preset_${p}`)}
                  </option>
                ))}
              </select>
            </div>
            {trigger.preset === 'hourly' && (
              <div>
                <label className="label">{t('automation.minute')}</label>
                <input
                  type="number"
                  min={0}
                  max={59}
                  className="input w-24"
                  value={trigger.minute ?? 0}
                  onChange={(e) =>
                    onChange({
                      ...trigger,
                      minute: Math.min(59, Math.max(0, Number(e.target.value) || 0))
                    })
                  }
                />
              </div>
            )}
            {trigger.preset === 'weekly' && (
              <div>
                <label className="label">{t('automation.weekday')}</label>
                <select
                  className="input"
                  value={trigger.weekday ?? 1}
                  onChange={(e) => onChange({ ...trigger, weekday: Number(e.target.value) })}
                >
                  {WEEKDAYS.map((d) => (
                    <option key={d} value={d}>
                      {weekdayName(d)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {(trigger.preset === 'daily' || trigger.preset === 'weekly') && (
              <div>
                <label className="label">{t('automation.time')}</label>
                <input
                  type="time"
                  className="input w-32"
                  value={trigger.time ?? '09:00'}
                  onChange={(e) => onChange({ ...trigger, time: e.target.value || '09:00' })}
                />
              </div>
            )}
          </div>
          {trigger.preset === 'custom' && (
            <div>
              <label className="label">{t('automation.cron')}</label>
              <input
                className="input font-mono"
                dir="ltr"
                value={trigger.cron ?? ''}
                onChange={(e) => onChange({ ...trigger, cron: e.target.value })}
              />
              <p className="mt-1 text-xs text-slate-500">{t('automation.cronHint')}</p>
            </div>
          )}
          <p className="text-xs text-slate-500">
            {nextRun ? `${t('automation.nextRun', { time: formatTime(nextRun) })} · ` : ''}
            {t('automation.scheduleNote')}
          </p>
        </div>
      )}
      {trigger.type === 'folder' && (
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <div>
            <label className="label">{t('automation.folder')}</label>
            <div className="flex gap-2">
              <input
                className="input font-mono text-xs"
                dir="ltr"
                value={trigger.folder}
                onChange={(e) => onChange({ ...trigger, folder: e.target.value })}
              />
              <button
                className="btn-secondary btn-sm shrink-0"
                onClick={async () => {
                  const p = await call(api().automation.pickPath('folder'))
                  if (p) onChange({ ...trigger, folder: p })
                }}
              >
                {t('automation.browse')}
              </button>
            </div>
          </div>
          <div>
            <label className="label">{t('automation.pattern')}</label>
            <input
              className="input font-mono text-xs"
              dir="ltr"
              placeholder="*.mp3;*.wav"
              value={trigger.pattern ?? ''}
              onChange={(e) => onChange({ ...trigger, pattern: e.target.value })}
            />
          </div>
          <p className="text-xs text-slate-500 sm:col-span-2">{t('automation.patternHint')}</p>
        </div>
      )}
      {trigger.type === 'webhook' && (
        <div className="space-y-2 text-sm">
          {webhookBase && !webhookBase.on && (
            <p className="text-amber-700 dark:text-amber-300">{t('automation.webhookOff')}</p>
          )}
          <p className="text-xs text-slate-500">{t('automation.webhookNote')}</p>
        </div>
      )}
    </div>
  )
}

export function WorkflowEditor({
  workflow,
  nextRun,
  onSaved,
  onDeleted,
  onShowRuns
}: {
  workflow: Workflow
  nextRun?: number
  onSaved: (w: Workflow) => void
  onDeleted: () => void
  onShowRuns: () => void
}) {
  const showToast = useApp((s) => s.showToast)
  const [draft, setDraft] = useState(workflow)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [runOpen, setRunOpen] = useState(false)
  const [input, setInput] = useState('')
  const [approvals, setApprovals] = useState<Approval[]>()
  const [webhookUrl, setWebhookUrl] = useState<string>()
  const draftRef = useRef(draft)
  draftRef.current = draft

  // A new workflow selected, or the saved copy changed elsewhere (e.g. permissions revoked).
  useEffect(() => {
    if (draftRef.current.id !== workflow.id || !dirty) {
      setDraft(workflow)
      setDirty(false)
    } else {
      setDraft((d) => ({ ...d, permissions: workflow.permissions }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow])

  useEffect(() => {
    if (draft.trigger.type !== 'webhook') return
    void call(api().automation.webhookInfo())
      .then((w) => setWebhookUrl(`${w.baseUrl}/run/${draft.id}`))
      .catch(() => undefined)
  }, [draft.trigger.type, draft.id])

  const update = (patch: Partial<Workflow>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setDirty(true)
  }
  const nextId = useMemo(() => () => nextStepId(draftRef.current.steps), [])

  const save = async (): Promise<Workflow | undefined> => {
    setBusy(true)
    try {
      const saved = await call(
        api().automation.saveWorkflow({
          ...draft,
          name: draft.name.trim() || t('automation.untitled')
        })
      )
      setDraft(saved)
      setDirty(false)
      onSaved(saved)
      return saved
    } catch (err) {
      showToast(errorInfo(err).message, 'error')
      return undefined
    } finally {
      setBusy(false)
    }
  }

  const startRun = async () => {
    try {
      await call(api().automation.run(draft.id, input.trim() || undefined))
      setRunOpen(false)
      setApprovals(undefined)
      onShowRuns()
    } catch (err) {
      showToast(errorInfo(err).message, 'error')
    }
  }

  const prepareRun = async () => {
    const saved = dirty ? await save() : draft
    if (!saved) return
    try {
      const needed = await call(api().automation.preflight(saved.id))
      if (needed.length) setApprovals(needed)
      else await startRun()
    } catch (err) {
      showToast(errorInfo(err).message, 'error')
    }
  }

  const allow = async () => {
    if (!approvals) return
    try {
      const w = await call(api().automation.approve(draft.id, approvals))
      onSaved(w)
      await startRun()
    } catch (err) {
      showToast(errorInfo(err).message, 'error')
    }
  }

  const remove = async () => {
    if (!window.confirm(t('automation.deleteConfirm', { name: draft.name }))) return
    await call(api().automation.deleteWorkflow(draft.id))
    onDeleted()
  }

  const exportOne = async () => {
    const saved = dirty ? await save() : draft
    if (!saved) return
    const p = await call(api().automation.export([saved.id]))
    if (p) showToast(t('automation.exported', { path: p }))
  }

  const revoke = async (kind: Approval['kind'], target: string) => {
    const w = await call(api().automation.revoke(draft.id, kind, target))
    if (w) onSaved(w)
  }

  const perms = [
    ...draft.permissions.writeFolders.map((target) => ({ kind: 'write' as const, target })),
    ...draft.permissions.httpHosts.map((target) => ({ kind: 'http' as const, target }))
  ]

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input min-w-[12rem] flex-1 text-lg font-semibold"
          aria-label={t('automation.name')}
          placeholder={t('automation.untitled')}
          dir="auto"
          value={draft.name}
          onChange={(e) => update({ name: e.target.value })}
        />
        {dirty && <span className="text-xs text-amber-600">{t('automation.unsaved')}</span>}
        <button className="btn-secondary" onClick={() => void save()} disabled={busy || !dirty}>
          {t('automation.save')}
        </button>
        <button
          className="btn-primary"
          onClick={() => setRunOpen(true)}
          disabled={busy || !draft.steps.length}
        >
          <Icon name="play" />
          {t('automation.run')}
        </button>
        <button
          className="btn-ghost btn-sm"
          onClick={() => void exportOne()}
          title={t('automation.export')}
        >
          <Icon name="download" className="h-4 w-4" />
        </button>
        <button
          className="btn-ghost btn-sm text-red-600"
          onClick={() => void remove()}
          title={t('automation.deleteWorkflow')}
        >
          <Icon name="trash" className="h-4 w-4" />
        </button>
      </div>

      <div className="card space-y-3 p-4">
        <div>
          <label className="label">{t('automation.description')}</label>
          <input
            className="input"
            dir="auto"
            value={draft.description ?? ''}
            onChange={(e) => update({ description: e.target.value })}
          />
        </div>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={draft.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
          />
          <span>
            <span className="font-medium">{t('automation.enabled')}</span>
            <span className="block text-xs text-slate-500">{t('automation.enabledHint')}</span>
          </span>
        </label>
      </div>

      <div className="card space-y-3 p-4">
        <h3 className="font-semibold">{t('automation.trigger')}</h3>
        <TriggerEditor
          trigger={draft.trigger}
          onChange={(trigger) => update({ trigger })}
          nextRun={nextRun}
        />
        {draft.trigger.type === 'webhook' && webhookUrl && (
          <div className="flex items-center gap-2">
            <code
              className="min-w-0 flex-1 truncate rounded bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800"
              dir="ltr"
            >
              {webhookUrl}
            </code>
            <CopyButton text={webhookUrl} />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">{t('automation.steps')}</h3>
        <StepList
          steps={draft.steps}
          onChange={(steps) => update({ steps })}
          trigger={draft.trigger}
          before={[]}
          nextId={nextId}
        />
      </div>

      <div className="card space-y-3 p-4">
        <h3 className="font-semibold">{t('automation.safety')}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">{t('automation.spendingCap')}</label>
            <input
              type="number"
              min={0}
              step={0.1}
              className="input"
              value={draft.safety.spendingCapUsd}
              onChange={(e) =>
                update({
                  safety: {
                    ...draft.safety,
                    spendingCapUsd: Math.max(0, Number(e.target.value) || 0)
                  }
                })
              }
            />
            <p className="mt-1 text-xs text-slate-500">{t('automation.spendingCapHint')}</p>
          </div>
          <div>
            <label className="label">{t('automation.maxRunsPerHour')}</label>
            <input
              type="number"
              min={0}
              step={1}
              className="input"
              value={draft.safety.maxRunsPerHour}
              onChange={(e) =>
                update({
                  safety: {
                    ...draft.safety,
                    maxRunsPerHour: Math.max(0, Math.round(Number(e.target.value) || 0))
                  }
                })
              }
            />
          </div>
        </div>
        <div>
          <p className="label">{t('automation.permissions')}</p>
          {perms.length === 0 ? (
            <p className="text-xs text-slate-500">{t('automation.noPermissions')}</p>
          ) : (
            <ul className="space-y-1">
              {perms.map((p) => (
                <li key={`${p.kind}:${p.target}`} className="flex items-center gap-2 text-xs">
                  <Icon
                    name={p.kind === 'write' ? 'folder' : 'external'}
                    className="h-3.5 w-3.5 shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate font-mono" dir="ltr">
                    {p.target}
                  </span>
                  <button
                    className="btn-ghost btn-sm text-red-600"
                    onClick={() => void revoke(p.kind, p.target)}
                  >
                    {t('automation.revoke')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {runOpen && !approvals && (
        <Modal
          title={t('automation.runNow')}
          onClose={() => setRunOpen(false)}
          footer={
            <>
              <button className="btn-ghost" onClick={() => setRunOpen(false)}>
                {t('common.cancel')}
              </button>
              <button className="btn-primary" onClick={() => void prepareRun()}>
                <Icon name="play" />
                {t('automation.run')}
              </button>
            </>
          }
        >
          <label className="label">{t('automation.runInput')}</label>
          <textarea
            className="input"
            rows={4}
            dir="auto"
            autoFocus
            placeholder={t('automation.runInputPlaceholder')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </Modal>
      )}
      {approvals && (
        <ApproveDialog
          name={draft.name}
          approvals={approvals}
          onAllow={() => void allow()}
          onClose={() => {
            setApprovals(undefined)
            setRunOpen(false)
          }}
        />
      )}
    </div>
  )
}
