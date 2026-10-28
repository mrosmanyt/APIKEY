import { useEffect, useState } from 'react'
import type { UsageStats } from '@shared/types'
import { t } from '../../i18n'
import { api, call } from '../../lib/api'
import { formatTime } from '../../lib/files'
import { useApp } from '../../lib/store'

export function UsageTab() {
  const providers = useApp((s) => s.providers)
  const page = useApp((s) => s.page)
  const [usage, setUsage] = useState<UsageStats>({})

  useEffect(() => {
    if (page === 'settings') void call(api().usage.get()).then(setUsage)
  }, [page])

  const rows = Object.entries(usage).sort((a, b) => b[1].requests - a[1].requests)
  const name = (id: string) => providers.find((p) => p.id === id)?.name ?? id
  const n = (v: number) => v.toLocaleString()

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">{t('settings.usageIntro')}</p>
      {rows.length === 0 ? (
        <p className="card p-8 text-center text-slate-500">{t('settings.noUsage')}</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-xs uppercase text-slate-500 dark:border-slate-800">
              <tr>
                <th className="p-3">{t('common.provider')}</th>
                <th className="p-3 text-right">{t('settings.requests')}</th>
                <th className="p-3 text-right">{t('settings.errorsCount')}</th>
                <th className="p-3 text-right">{t('settings.inputTokens')}</th>
                <th className="p-3 text-right">{t('settings.outputTokens')}</th>
                <th className="p-3 text-right">{t('settings.imagesCount')}</th>
                <th className="p-3 text-right">{t('settings.audioCount')}</th>
                <th className="p-3 text-right">{t('settings.videoCount')}</th>
                <th className="p-3">{t('settings.lastUsed')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([id, u]) => (
                <tr
                  key={id}
                  className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                >
                  <td className="p-3 font-medium">{name(id)}</td>
                  <td className="p-3 text-right tabular-nums">{n(u.requests)}</td>
                  <td className="p-3 text-right tabular-nums">{n(u.errors)}</td>
                  <td className="p-3 text-right tabular-nums">{n(u.inputTokens)}</td>
                  <td className="p-3 text-right tabular-nums">{n(u.outputTokens)}</td>
                  <td className="p-3 text-right tabular-nums">{n(u.images)}</td>
                  <td className="p-3 text-right tabular-nums">{n(u.audioRequests)}</td>
                  <td className="p-3 text-right tabular-nums">{n(u.videoJobs)}</td>
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
              setUsage(await call(api().usage.reset()))
          }}
        >
          {t('settings.resetUsage')}
        </button>
      )}
    </div>
  )
}
