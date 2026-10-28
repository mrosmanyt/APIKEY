import { useState, type ReactNode } from 'react'
import {
  CONDITION_OPERATORS,
  STEP_TYPES,
  type Branch,
  type Step,
  type StepType,
  type Trigger
} from '@shared/automation'
import { Icon } from '../../components/Icon'
import { ProviderModelPicker } from '../../components/ProviderModelPicker'
import { t, tDynamic } from '../../i18n'
import { api, call } from '../../lib/api'
import { availableVars, capabilityOf, newStep } from '../../lib/automation'
import { useApp, voicesFor } from '../../lib/store'

interface ListProps {
  steps: Step[]
  onChange: (steps: Step[]) => void
  trigger: Trigger
  /** Steps that run before this list (for {{variables}}). */
  before: Step[]
  inLoop?: boolean
  /** Generates a new unique step id across the whole workflow. */
  nextId: () => string
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

function TextArea({
  value,
  onChange,
  rows = 3,
  mono
}: {
  value: string
  onChange: (v: string) => void
  rows?: number
  mono?: boolean
}) {
  return (
    <textarea
      className={`input ${mono ? 'font-mono text-xs' : ''}`}
      rows={rows}
      dir="auto"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

function PathInput({
  value,
  onChange,
  kind,
  extensions
}: {
  value: string
  onChange: (v: string) => void
  kind: 'file' | 'save' | 'folder'
  extensions?: string[]
}) {
  return (
    <div className="flex gap-2">
      <input
        className="input font-mono text-xs"
        dir="ltr"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="btn-secondary btn-sm shrink-0"
        onClick={async () => {
          const p = await call(api().automation.pickPath(kind, extensions))
          if (p) onChange(p)
        }}
      >
        {t('automation.browse')}
      </button>
    </div>
  )
}

function BranchSelect({
  value,
  onChange,
  siblings,
  self
}: {
  value: Branch
  onChange: (b: Branch) => void
  siblings: Step[]
  self: string
}) {
  const key = value.action === 'goto' ? `goto:${value.stepId}` : value.action
  return (
    <select
      className="input"
      value={key}
      onChange={(e) => {
        const v = e.target.value
        onChange(
          v.startsWith('goto:') ? { action: 'goto', stepId: v.slice(5) } : ({ action: v } as Branch)
        )
      }}
    >
      <option value="next">{t('automation.branch_next')}</option>
      <option value="stop">{t('automation.branch_stop')}</option>
      {siblings
        .filter((s) => s.id !== self)
        .map((s) => (
          <option key={s.id} value={`goto:${s.id}`}>
            {t('automation.branch_goto').replace('…', '')} {s.id}
            {s.name ? ` — ${s.name}` : ''}
          </option>
        ))}
    </select>
  )
}

function StepFields({
  step,
  update,
  siblings,
  trigger,
  before,
  nextId
}: {
  step: Step
  update: (s: Step) => void
  siblings: Step[]
  trigger: Trigger
  before: Step[]
  nextId: () => string
}) {
  const providers = useApp((s) => s.providers)
  const settings = useApp((s) => s.settings)
  const set = (patch: Partial<Step>) => update({ ...step, ...patch } as Step)
  const cap = capabilityOf(step.type)
  const picker =
    cap && 'providerId' in step ? (
      <ProviderModelPicker
        capability={cap}
        value={step.providerId ? { providerId: step.providerId, model: step.model } : undefined}
        onChange={(sel) => set({ providerId: sel.providerId, model: sel.model } as Partial<Step>)}
      />
    ) : null

  switch (step.type) {
    case 'llm':
      return (
        <div className="space-y-3">
          {picker}
          <Field label={t('automation.prompt')}>
            <TextArea value={step.prompt} onChange={(v) => set({ prompt: v })} rows={4} />
          </Field>
          <Field label={t('automation.systemPrompt')}>
            <TextArea
              value={step.systemPrompt ?? ''}
              onChange={(v) => set({ systemPrompt: v || undefined })}
              rows={2}
            />
          </Field>
        </div>
      )
    case 'image':
      return (
        <div className="space-y-3">
          {picker}
          <Field label={t('automation.prompt')}>
            <TextArea value={step.prompt} onChange={(v) => set({ prompt: v })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('automation.negativePrompt')}>
              <input
                className="input"
                value={step.negativePrompt ?? ''}
                onChange={(e) => set({ negativePrompt: e.target.value || undefined })}
              />
            </Field>
            <Field label={t('automation.size')}>
              <input
                className="input"
                value={step.size ?? ''}
                placeholder="1024x1024 / 16:9"
                onChange={(e) => set({ size: e.target.value || undefined })}
              />
            </Field>
            <Field label={t('automation.count')}>
              <input
                type="number"
                min={1}
                max={10}
                className="input"
                value={step.count ?? 1}
                onChange={(e) =>
                  set({ count: Math.min(10, Math.max(1, Number(e.target.value) || 1)) })
                }
              />
            </Field>
          </div>
        </div>
      )
    case 'video':
      return (
        <div className="space-y-3">
          {picker}
          <Field label={t('automation.prompt')}>
            <TextArea value={step.prompt} onChange={(v) => set({ prompt: v })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('automation.size')}>
              <input
                className="input"
                value={step.size ?? ''}
                onChange={(e) => set({ size: e.target.value || undefined })}
              />
            </Field>
            <Field label={t('automation.duration')}>
              <input
                type="number"
                min={1}
                max={120}
                className="input"
                value={step.durationSeconds ?? ''}
                onChange={(e) =>
                  set({ durationSeconds: e.target.value ? Number(e.target.value) : undefined })
                }
              />
            </Field>
          </div>
        </div>
      )
    case 'tts': {
      const p = providers.find((x) => x.id === step.providerId)
      const voices = voicesFor(p, settings)
      return (
        <div className="space-y-3">
          {picker}
          <Field label={t('automation.voice')}>
            <select
              className="input"
              value={step.voice}
              onChange={(e) => set({ voice: e.target.value })}
            >
              {!voices.some((v) => v.id === step.voice) && step.voice && (
                <option value={step.voice}>{step.voice}</option>
              )}
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('automation.text')}>
            <TextArea value={step.text} onChange={(v) => set({ text: v })} />
          </Field>
        </div>
      )
    }
    case 'stt':
      return (
        <div className="space-y-3">
          {picker}
          <Field label={t('automation.filePath')}>
            <PathInput
              value={step.filePath}
              onChange={(v) => set({ filePath: v })}
              kind="file"
              extensions={['mp3', 'wav', 'm4a', 'ogg', 'webm', 'flac']}
            />
          </Field>
          <Field label={t('automation.language')}>
            <input
              className="input w-32"
              value={step.language ?? ''}
              onChange={(e) => set({ language: e.target.value || undefined })}
            />
          </Field>
        </div>
      )
    case 'readFile':
      return (
        <Field label={t('automation.path')} hint={t('automation.pathHint')}>
          <PathInput value={step.path} onChange={(v) => set({ path: v })} kind="file" />
        </Field>
      )
    case 'writeFile':
      return (
        <div className="space-y-3">
          <Field label={t('automation.path')} hint={t('automation.pathHint')}>
            <PathInput value={step.path} onChange={(v) => set({ path: v })} kind="save" />
          </Field>
          <Field label={t('automation.content')}>
            <TextArea value={step.content} onChange={(v) => set({ content: v })} rows={4} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(step.append)}
              onChange={(e) => set({ append: e.target.checked || undefined })}
            />
            {t('automation.append')}
          </label>
        </div>
      )
    case 'http':
      return (
        <div className="space-y-3">
          <div className="flex gap-2">
            <select
              className="input w-28"
              value={step.method}
              onChange={(e) => set({ method: e.target.value as typeof step.method })}
            >
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <input
              className="input font-mono text-xs"
              dir="ltr"
              placeholder="https://…"
              value={step.url}
              onChange={(e) => set({ url: e.target.value })}
            />
          </div>
          <p className="text-xs text-slate-500">{t('automation.urlHint')}</p>
          <Field label={t('automation.headers')}>
            <div className="space-y-2">
              {(step.headers ?? []).map((h, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    className="input w-48 font-mono text-xs"
                    dir="ltr"
                    placeholder={t('automation.headerName')}
                    value={h.name}
                    onChange={(e) =>
                      set({
                        headers: step.headers!.map((x, j) =>
                          j === i ? { ...x, name: e.target.value } : x
                        )
                      })
                    }
                  />
                  <input
                    className="input font-mono text-xs"
                    dir="ltr"
                    placeholder={t('automation.headerValue')}
                    value={h.value}
                    onChange={(e) =>
                      set({
                        headers: step.headers!.map((x, j) =>
                          j === i ? { ...x, value: e.target.value } : x
                        )
                      })
                    }
                  />
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => set({ headers: step.headers!.filter((_, j) => j !== i) })}
                    aria-label={t('common.delete')}
                  >
                    <Icon name="x" className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => set({ headers: [...(step.headers ?? []), { name: '', value: '' }] })}
              >
                <Icon name="plus" className="h-3.5 w-3.5" />
                {t('automation.addHeader')}
              </button>
            </div>
          </Field>
          {step.method !== 'GET' && step.method !== 'DELETE' && (
            <Field label={t('automation.body')}>
              <TextArea value={step.body ?? ''} onChange={(v) => set({ body: v })} mono />
            </Field>
          )}
        </div>
      )
    case 'condition': {
      const needsRight = !['isEmpty', 'notEmpty'].includes(step.operator)
      return (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('automation.left')}>
              <input
                className="input"
                value={step.left}
                placeholder="{{step1.output}}"
                onChange={(e) => set({ left: e.target.value })}
              />
            </Field>
            <Field label={t('automation.operator')}>
              <select
                className="input"
                value={step.operator}
                onChange={(e) => set({ operator: e.target.value as typeof step.operator })}
              >
                {CONDITION_OPERATORS.map((op) => (
                  <option key={op} value={op}>
                    {tDynamic(`automation.op_${op}`)}
                  </option>
                ))}
              </select>
            </Field>
            {needsRight && (
              <Field label={t('automation.right')}>
                <input
                  className="input"
                  value={step.right ?? ''}
                  onChange={(e) => set({ right: e.target.value })}
                />
              </Field>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('automation.ifTrue')}>
              <BranchSelect
                value={step.ifTrue}
                onChange={(b) => set({ ifTrue: b })}
                siblings={siblings}
                self={step.id}
              />
            </Field>
            <Field label={t('automation.ifFalse')}>
              <BranchSelect
                value={step.ifFalse}
                onChange={(b) => set({ ifFalse: b })}
                siblings={siblings}
                self={step.id}
              />
            </Field>
          </div>
        </div>
      )
    }
    case 'delay':
      return (
        <Field label={t('automation.seconds')}>
          <input
            type="number"
            min={0}
            max={86400}
            className="input w-32"
            value={step.seconds}
            onChange={(e) => set({ seconds: Math.max(0, Number(e.target.value) || 0) })}
          />
        </Field>
      )
    case 'loop':
      return (
        <div className="space-y-3">
          <Field label={t('automation.items')} hint={t('automation.itemsHint')}>
            <input
              className="input font-mono text-xs"
              value={step.items}
              onChange={(e) => set({ items: e.target.value })}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('automation.separator')}>
              <select
                className="input"
                value={step.separator ?? 'lines'}
                onChange={(e) => set({ separator: e.target.value as 'lines' })}
              >
                {(['lines', 'json', 'comma'] as const).map((s) => (
                  <option key={s} value={s}>
                    {t(`automation.sep_${s}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('automation.maxItems')}>
              <input
                type="number"
                min={1}
                max={1000}
                className="input"
                value={step.maxItems ?? 100}
                onChange={(e) =>
                  set({ maxItems: Math.min(1000, Math.max(1, Number(e.target.value) || 1)) })
                }
              />
            </Field>
          </div>
          <div className="rounded-lg border-s-4 border-brand-300 ps-3 dark:border-brand-700">
            <p className="mb-2 text-xs font-semibold uppercase text-slate-500">
              {t('automation.loopBody')}
            </p>
            <StepList
              steps={step.steps}
              onChange={(steps) => set({ steps })}
              trigger={trigger}
              before={[...before, step]}
              inLoop
              nextId={nextId}
            />
          </div>
        </div>
      )
  }
}

function VarChips({ vars }: { vars: string[] }) {
  const showToast = useApp((s) => s.showToast)
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      <span className="text-slate-500">{t('automation.variables')}</span>
      {vars.map((v) => (
        <button
          key={v}
          type="button"
          dir="ltr"
          className="rounded bg-slate-100 px-1.5 py-0.5 font-mono hover:bg-brand-100 dark:bg-slate-800 dark:hover:bg-brand-900/40"
          onClick={() => {
            void navigator.clipboard.writeText(`{{${v}}}`)
            showToast(t('automation.copiedVar', { name: `{{${v}}}` }))
          }}
        >
          {`{{${v}}}`}
        </button>
      ))}
    </div>
  )
}

export function StepList({ steps, onChange, trigger, before, inLoop, nextId }: ListProps) {
  const providers = useApp((s) => s.providers)
  const statuses = useApp((s) => s.statuses)
  const settings = useApp((s) => s.settings)
  const [adding, setAdding] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const replace = (i: number, s: Step) => onChange(steps.map((x, j) => (j === i ? s : x)))
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= steps.length) return
    const copy = [...steps]
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
    onChange(copy)
  }
  const add = (type: StepType) => {
    onChange([...steps, newStep(type, nextId(), { providers, statuses, settings })])
    setAdding(false)
  }

  return (
    <div className="space-y-3">
      {steps.length === 0 && <p className="text-sm text-slate-500">{t('automation.noSteps')}</p>}
      {steps.map((step, i) => (
        <div
          key={step.id}
          className={`card p-3 ${step.disabled ? 'opacity-60' : ''}`}
          data-step={step.id}
        >
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => setCollapsed({ ...collapsed, [step.id]: !collapsed[step.id] })}
              aria-label={step.id}
            >
              <Icon
                name={collapsed[step.id] ? 'chevronDown' : 'chevronUp'}
                className="h-3.5 w-3.5"
              />
            </button>
            <span
              className="badge bg-brand-100 font-mono text-brand-800 dark:bg-brand-900/40 dark:text-brand-200"
              dir="ltr"
            >
              {step.id}
            </span>
            <span className="text-sm font-semibold">
              {tDynamic(`automation.type_${step.type}`)}
            </span>
            {step.disabled && (
              <span className="text-xs text-slate-500">({t('automation.stepDisabled')})</span>
            )}
            <input
              className="input me-auto h-8 w-auto min-w-0 max-w-xs flex-1 py-1 text-sm"
              placeholder={t('automation.stepName')}
              value={step.name ?? ''}
              onChange={(e) => replace(i, { ...step, name: e.target.value || undefined })}
            />
            <button
              type="button"
              className="btn-ghost btn-sm"
              title={t('automation.moveUp')}
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              <Icon name="chevronUp" className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              title={t('automation.moveDown')}
              disabled={i === steps.length - 1}
              onClick={() => move(i, 1)}
            >
              <Icon name="chevronDown" className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              title={t('automation.duplicate')}
              onClick={() =>
                onChange([
                  ...steps.slice(0, i + 1),
                  { ...structuredClone(step), id: nextId() } as Step,
                  ...steps.slice(i + 1)
                ])
              }
            >
              <Icon name="copy" className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              title={step.disabled ? t('automation.enable') : t('automation.disable')}
              onClick={() => replace(i, { ...step, disabled: step.disabled ? undefined : true })}
            >
              <Icon name={step.disabled ? 'play' : 'pause'} className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm text-red-600"
              title={t('common.delete')}
              onClick={() => onChange(steps.filter((_, j) => j !== i))}
            >
              <Icon name="trash" className="h-3.5 w-3.5" />
            </button>
          </div>
          {!collapsed[step.id] && (
            <div className="mt-3 space-y-3">
              <StepFields
                step={step}
                update={(s) => replace(i, s)}
                siblings={steps}
                trigger={trigger}
                before={[...before, ...steps.slice(0, i)]}
                nextId={nextId}
              />
              {step.type !== 'delay' && (
                <VarChips
                  vars={availableVars(trigger, [...before, ...steps.slice(0, i)], Boolean(inLoop))}
                />
              )}
            </div>
          )}
        </div>
      ))}
      {adding ? (
        <div className="card grid grid-cols-2 gap-2 p-3 sm:grid-cols-3">
          {STEP_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              className="btn-secondary btn-sm justify-start"
              onClick={() => add(type)}
              data-add-step={type}
            >
              {tDynamic(`automation.type_${type}`)}
            </button>
          ))}
          <button type="button" className="btn-ghost btn-sm" onClick={() => setAdding(false)}>
            {t('common.cancel')}
          </button>
        </div>
      ) : (
        <button type="button" className="btn-secondary btn-sm" onClick={() => setAdding(true)}>
          <Icon name="plus" className="h-3.5 w-3.5" />
          {t('automation.addStep')}
        </button>
      )}
    </div>
  )
}
