import { useCallback, useEffect, useState } from 'react'
import type { BatchJob, Workflow, WorkflowTemplate } from '@shared/automation'
import type { TemplateDefaults } from '../../../preload/api-types'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { PageHeader } from '../components/PageHeader'
import { t, tDynamic } from '../i18n'
import { api, call, errorInfo } from '../lib/api'
import { defaultModel, newWorkflow } from '../lib/automation'
import { useApp, usableProviders, voicesFor } from '../lib/store'
import { BatchView } from './automation/BatchView'
import { RunsView } from './automation/RunsView'
import { WorkflowEditor } from './automation/WorkflowEditor'

type Tab = 'workflows' | 'runs' | 'batch'

function TemplatePicker({
  onPick,
  onClose
}: {
  onPick: (id: string) => void
  onClose: () => void
}) {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  useEffect(() => {
    void call(api().automation.templates()).then(setTemplates)
  }, [])
  return (
    <Modal title={t('automation.templatesTitle')} onClose={onClose} wide>
      <div className="grid gap-3 sm:grid-cols-2">
        {templates.map((tpl) => (
          <div key={tpl.id} className="card flex flex-col p-4" data-testid={`template-${tpl.id}`}>
            <h3 className="font-semibold">{tpl.name}</h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{tpl.description}</p>
            <p className="mt-2 flex-1 text-xs text-slate-500">{tpl.howTo}</p>
            <button className="btn-primary btn-sm mt-3 w-fit" onClick={() => onPick(tpl.id)}>
              {t('automation.useTemplate')}
            </button>
          </div>
        ))}
      </div>
    </Modal>
  )
}

export function AutomationPage() {
  const providers = useApp((s) => s.providers)
  const statuses = useApp((s) => s.statuses)
  const settings = useApp((s) => s.settings)
  const showToast = useApp((s) => s.showToast)
  const [tab, setTab] = useState<Tab>('workflows')
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [selected, setSelected] = useState<string>()
  const [draftNew, setDraftNew] = useState<Workflow>()
  const [picking, setPicking] = useState(false)
  const [nextRuns, setNextRuns] = useState<Record<string, number>>({})
  const [runsFilter, setRunsFilter] = useState<string>()
  const [batchFilter, setBatchFilter] = useState<string>()

  const load = useCallback(async () => {
    const [list, status] = await Promise.all([
      call(api().automation.listWorkflows()),
      call(api().automation.status())
    ])
    setWorkflows(list)
    setNextRuns(status.nextRuns)
  }, [])

  useEffect(() => {
    void load()
    return api().automation.onChanged(() => void load())
  }, [load])

  const ctx = { providers, statuses, settings }

  const templateDefaults = (): TemplateDefaults => {
    const d: TemplateDefaults = {}
    const caps = { llm: 'chat', image: 'image', video: 'video', tts: 'tts', stt: 'stt' } as const
    for (const [type, cap] of Object.entries(caps) as Array<
      [keyof typeof caps, (typeof caps)[keyof typeof caps]]
    >) {
      if (!usableProviders(ctx, cap).length) continue
      const m = defaultModel(cap, ctx)
      if (!m.providerId || !m.model) continue
      const voice =
        type === 'tts'
          ? voicesFor(
              providers.find((p) => p.id === m.providerId),
              settings
            )[0]?.id
          : undefined
      d[type] = { ...m, voice }
    }
    return d
  }

  const fromTemplate = async (id: string) => {
    try {
      const wf = await call(api().automation.createFromTemplate(id, templateDefaults()))
      setPicking(false)
      setDraftNew(undefined)
      await load()
      setSelected(wf.id)
    } catch (err) {
      showToast(errorInfo(err).message, 'error')
    }
  }

  const importPack = async () => {
    try {
      const res = await call(api().automation.import())
      if (!res) return
      showToast(
        t('automation.imported', { count: res.imported }) +
          (res.skipped.length
            ? ` ${t('automation.importSkipped', { list: res.skipped.join(', ') })}`
            : '')
      )
      void load()
    } catch (err) {
      showToast(errorInfo(err).message, 'error')
    }
  }

  const exportAll = async () => {
    try {
      const p = await call(api().automation.export(workflows.map((w) => w.id)))
      if (p) showToast(t('automation.exported', { path: p }))
    } catch (err) {
      showToast(errorInfo(err).message, 'error')
    }
  }

  const current = draftNew ?? workflows.find((w) => w.id === selected)

  return (
    <>
      <PageHeader title={t('automation.title')}>
        <div className="flex gap-1" role="tablist">
          {(['workflows', 'runs', 'batch'] as Tab[]).map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'}
              onClick={() => {
                setTab(id)
                if (id === 'runs') setBatchFilter(undefined)
              }}
            >
              {tDynamic(`automation.tab${id[0].toUpperCase()}${id.slice(1)}`)}
            </button>
          ))}
        </div>
      </PageHeader>

      {tab === 'workflows' && (
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-64 shrink-0 flex-col border-e border-slate-200 dark:border-slate-800">
            <div className="grid grid-cols-2 gap-1 border-b border-slate-200 p-2 dark:border-slate-800">
              <button
                className="btn-primary btn-sm"
                onClick={() => {
                  setDraftNew(newWorkflow(t('automation.untitled')))
                  setSelected(undefined)
                }}
              >
                <Icon name="plus" className="h-3.5 w-3.5" />
                {t('automation.newWorkflow')}
              </button>
              <button className="btn-secondary btn-sm" onClick={() => setPicking(true)}>
                {t('automation.fromTemplate')}
              </button>
              <button className="btn-ghost btn-sm" onClick={() => void importPack()}>
                <Icon name="upload" className="h-3.5 w-3.5" />
                {t('automation.import')}
              </button>
              <button
                className="btn-ghost btn-sm"
                disabled={!workflows.length}
                onClick={() => void exportAll()}
              >
                <Icon name="download" className="h-3.5 w-3.5" />
                {t('automation.exportAll')}
              </button>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {workflows.length === 0 && !draftNew && (
                <li className="p-4 text-sm text-slate-500">{t('automation.noWorkflows')}</li>
              )}
              {workflows.map((w) => (
                <li key={w.id}>
                  <button
                    className={`flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-start text-sm dark:border-slate-800 ${
                      w.id === current?.id
                        ? 'bg-brand-50 dark:bg-brand-900/30'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                    onClick={() => {
                      setDraftNew(undefined)
                      setSelected(w.id)
                    }}
                  >
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${w.enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                      title={w.enabled ? t('automation.enabled') : undefined}
                    />
                    <span className="min-w-0 flex-1 truncate">{w.name}</span>
                    <span className="text-xs text-slate-500">
                      {tDynamic(`automation.trigger_${w.trigger.type}`)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
          <div className="min-w-0 flex-1 overflow-y-auto">
            {current ? (
              <WorkflowEditor
                key={current.id}
                workflow={current}
                nextRun={nextRuns[current.id]}
                onSaved={(w) => {
                  setDraftNew(undefined)
                  setSelected(w.id)
                  void load()
                }}
                onDeleted={() => {
                  setDraftNew(undefined)
                  setSelected(undefined)
                  void load()
                }}
                onShowRuns={() => {
                  setRunsFilter(current.id)
                  setTab('runs')
                }}
              />
            ) : (
              <p className="py-16 text-center text-slate-500">{t('automation.selectWorkflow')}</p>
            )}
          </div>
        </div>
      )}
      {tab === 'runs' && (
        <RunsView
          workflows={workflows}
          workflowId={runsFilter}
          onWorkflowChange={setRunsFilter}
          batchId={batchFilter}
        />
      )}
      {tab === 'batch' && (
        <BatchView
          workflows={workflows}
          onViewRuns={(b: BatchJob) => {
            setRunsFilter(b.workflowId)
            setBatchFilter(b.id)
            setTab('runs')
          }}
        />
      )}
      {picking && (
        <TemplatePicker onPick={(id) => void fromTemplate(id)} onClose={() => setPicking(false)} />
      )}
    </>
  )
}
