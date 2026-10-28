import { Fragment, useEffect, useMemo, useState } from 'react'
import { formatUsd, monthKey, monthlyCosts } from '@shared/pricing'
import type { UsageReport } from '@shared/types'
import { t } from '../../i18n'
import { api, call } from '../../lib/api'
import { modelInfoFor } from '../../lib/cost'
import { formatTime } from '../../lib/files'
import { useApp } from '../../lib/store'

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })
}

export function UsageTab() {
  const providers = useApp((s) => s.providers)
  const settings = useApp((s) => s.settings)
  const page = useApp((s) => s.page)
  const navigate = useApp((s) => s.navigate)
  const [report, setReport] = useState<UsageReport>({ totals: {}, monthly: {} })
  const [month, setMonth] = useState(monthKey())
  const [open, setOpen] = useState<string>()

  useEffect(() => {
    if (page === 'settings') void call(api().usage.get()).then(setReport)
  }, [page])

  const months = useMemo(() => {
    const keys = new Set([monthKey(), ...Object.keys(report.monthly)])
    return [...keys].sort().reverse()
  }, [report.monthly])

  const costs = useMemo(
    () =>
      monthlyCosts(report.monthly, month, settings?.prices ?? [], (p, m) =>
        modelInfoFor(providers, settings, p, m)
      ),
    [report.monthly, month, settings, providers]
  )
  const monthTotal = costs.reduce((n, c) => n + c.cost, 0)
  const anyUnpriced = costs.some((c) => c.unpricedModels.length > 0)
  const anyEstimated = costs.some((c) => c.estimated)

  const rows = Object.entries(report.totals).sort((a, b) => b[1].requests - a[1].requests)
  const name = (id: string) => providers.find((p) => p.id === id)?.name ?? id
  const n = (v: number) => v.toLocaleString()

  return (
    <div className="space-y-6">
      <section className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="me-auto font-semibold">{t('settings.monthlyCost')}</h3>
          <select
            className="input w-auto"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            aria-label={t('settings.month')}
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-slate-500">{t('settings.costDisclaimer')}</p>
        {costs.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">{t('settings.noUsageMonth')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-start text-xs uppercase text-slate-500 dark:border-slate-800">
                <tr>
                  <th className="p-2 text-start">{t('common.provider')}</th>
                  <th className="p-2 text-end">{t('settings.requests')}</th>
                  <th className="p-2 text-end">{t('settings.inputTokens')}</th>
                  <th className="p-2 text-end">{t('settings.outputTokens')}</th>
                  <th className="p-2 text-end">{t('settings.estCost')}</th>
                </tr>
              </thead>
              <tbody>
                {costs.map((c) => (
                  <Fragment key={c.providerId}>
                    <tr
                      className="cursor-pointer border-b border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40"
                      onClick={() => setOpen(open === c.providerId ? undefined : c.providerId)}
                    >
                      <td className="p-2 font-medium">
                        {open === c.providerId ? '▾' : '▸'} {name(c.providerId)}
                      </td>
                      <td className="p-2 text-end tabular-nums">{n(c.requests)}</td>
                      <td className="p-2 text-end tabular-nums">{n(c.inputTokens)}</td>
                      <td className="p-2 text-end tabular-nums">{n(c.outputTokens)}</td>
                      <td className="p-2 text-end font-semibold tabular-nums">
                        {formatUsd(c.cost)}
                        {c.unpricedModels.length > 0 && <span className="text-amber-600"> *</span>}
                      </td>
                    </tr>
                    {open === c.providerId &&
                      c.models.map((m) => (
                        <tr
                          key={m.model}
                          className="border-b border-slate-100 text-xs text-slate-500 dark:border-slate-800"
                        >
                          <td className="p-2 ps-8 font-mono">
                            {m.model}
                            {m.estimated ? ' ≈' : ''}
                          </td>
                          <td className="p-2 text-end tabular-nums">{n(m.requests)}</td>
                          <td className="p-2 text-end tabular-nums">{n(m.inputTokens)}</td>
                          <td className="p-2 text-end tabular-nums">{n(m.outputTokens)}</td>
                          <td className="p-2 text-end tabular-nums">
                            {m.cost === undefined ? t('settings.noPrice') : formatUsd(m.cost)}
                          </td>
                        </tr>
                      ))}
                  </Fragment>
                ))}
                <tr>
                  <td className="p-2 font-semibold" colSpan={4}>
                    {t('settings.total')}
                  </td>
                  <td className="p-2 text-end text-base font-bold tabular-nums">
                    {formatUsd(monthTotal)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        {(anyUnpriced || anyEstimated) && (
          <div className="space-y-1 text-xs text-slate-500">
            {anyUnpriced && (
              <p>
                <span className="text-amber-600">*</span> {t('settings.unpricedNote')}{' '}
                <button
                  className="text-brand-600 underline"
                  onClick={() => navigate('settings', { settingsTab: 'prices' })}
                >
                  {t('settings.editPrices')}
                </button>
              </p>
            )}
            {anyEstimated && <p>≈ {t('settings.estimatedNote')}</p>}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold">{t('settings.allTime')}</h3>
        <p className="text-sm text-slate-500">{t('settings.usageIntro')}</p>
        {rows.length === 0 ? (
          <p className="card p-8 text-center text-slate-500">{t('settings.noUsage')}</p>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800">
                <tr>
                  <th className="p-3 text-start">{t('common.provider')}</th>
                  <th className="p-3 text-end">{t('settings.requests')}</th>
                  <th className="p-3 text-end">{t('settings.errorsCount')}</th>
                  <th className="p-3 text-end">{t('settings.inputTokens')}</th>
                  <th className="p-3 text-end">{t('settings.outputTokens')}</th>
                  <th className="p-3 text-end">{t('settings.imagesCount')}</th>
                  <th className="p-3 text-end">{t('settings.audioCount')}</th>
                  <th className="p-3 text-end">{t('settings.videoCount')}</th>
                  <th className="p-3 text-start">{t('settings.lastUsed')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([id, u]) => (
                  <tr
                    key={id}
                    className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                  >
                    <td className="p-3 font-medium">{name(id)}</td>
                    <td className="p-3 text-end tabular-nums">{n(u.requests)}</td>
                    <td className="p-3 text-end tabular-nums">{n(u.errors)}</td>
                    <td className="p-3 text-end tabular-nums">{n(u.inputTokens)}</td>
                    <td className="p-3 text-end tabular-nums">{n(u.outputTokens)}</td>
                    <td className="p-3 text-end tabular-nums">{n(u.images)}</td>
                    <td className="p-3 text-end tabular-nums">{n(u.audioRequests)}</td>
                    <td className="p-3 text-end tabular-nums">{n(u.videoJobs)}</td>
                    <td className="p-3 text-xs text-slate-500">
                      {u.lastUsedAt ? formatTime(u.lastUsedAt) : '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 0 && (
          <button
            className="btn-secondary btn-sm"
            onClick={async () => {
              if (window.confirm(t('settings.resetUsageConfirm')))
                setReport(await call(api().usage.reset()))
            }}
          >
            {t('settings.resetUsage')}
          </button>
        )}
      </section>
    </div>
  )
}
