import { useMemo, useState } from 'react'
import { newId } from '@shared/ids'
import { DEFAULT_PRICES } from '@shared/pricing'
import type { PriceRow } from '@shared/types'
import { Icon } from '../../components/Icon'
import { t } from '../../i18n'
import { useApp } from '../../lib/store'

export function PricesTab() {
  const settings = useApp((s) => s.settings)!
  const providers = useApp((s) => s.providers)
  const updateSettings = useApp((s) => s.updateSettings)
  const showToast = useApp((s) => s.showToast)
  const [rows, setRows] = useState<PriceRow[]>(settings.prices)
  const [filter, setFilter] = useState('')
  const dirty = JSON.stringify(rows) !== JSON.stringify(settings.prices)
  const chatProviders = providers.filter((p) => p.capabilities.chat)

  const visible = useMemo(
    () =>
      rows.filter(
        (r) => !filter || `${r.providerId} ${r.model}`.toLowerCase().includes(filter.toLowerCase())
      ),
    [rows, filter]
  )
  const patch = (id: string, changes: Partial<PriceRow>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...changes } : r)))
  const valid = rows.every((r) => r.model.trim() && r.input >= 0 && r.output >= 0)

  const save = async () => {
    await updateSettings({ prices: rows.map((r) => ({ ...r, model: r.model.trim() })) })
    showToast(t('settings.pricesSaved'))
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">{t('settings.pricesIntro')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input w-64"
          placeholder={t('common.search')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button
          className="btn-secondary btn-sm"
          onClick={() =>
            setRows((rs) => [
              {
                id: newId('price_'),
                providerId: chatProviders[0]?.id ?? 'openai',
                model: '',
                input: 0,
                output: 0
              },
              ...rs
            ])
          }
        >
          <Icon name="plus" className="h-3.5 w-3.5" />
          {t('settings.addPrice')}
        </button>
        <button
          className="btn-ghost btn-sm"
          onClick={() => {
            if (window.confirm(t('settings.resetPricesConfirm'))) setRows(DEFAULT_PRICES)
          }}
        >
          {t('settings.resetPrices')}
        </button>
        <span className="ms-auto" />
        <button className="btn-primary btn-sm" onClick={save} disabled={!dirty || !valid}>
          {t('common.save')}
        </button>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800">
            <tr>
              <th className="p-2 text-start">{t('common.provider')}</th>
              <th className="p-2 text-start">{t('settings.modelPattern')}</th>
              <th className="p-2 text-end">{t('settings.inputPrice')}</th>
              <th className="p-2 text-end">{t('settings.outputPrice')}</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr
                key={r.id}
                className="border-b border-slate-100 last:border-0 dark:border-slate-800"
              >
                <td className="p-2">
                  <select
                    className="input py-1"
                    value={r.providerId}
                    onChange={(e) => patch(r.id, { providerId: e.target.value })}
                    aria-label={t('common.provider')}
                  >
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="p-2">
                  <input
                    className="input py-1 font-mono"
                    dir="ltr"
                    value={r.model}
                    placeholder="gpt-4o or gpt-4o*"
                    onChange={(e) => patch(r.id, { model: e.target.value })}
                    aria-label={t('settings.modelPattern')}
                  />
                </td>
                <td className="p-2">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="input w-28 py-1 text-end"
                    value={r.input}
                    onChange={(e) =>
                      patch(r.id, { input: Math.max(0, Number(e.target.value) || 0) })
                    }
                    aria-label={t('settings.inputPrice')}
                  />
                </td>
                <td className="p-2">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="input w-28 py-1 text-end"
                    value={r.output}
                    onChange={(e) =>
                      patch(r.id, { output: Math.max(0, Number(e.target.value) || 0) })
                    }
                    aria-label={t('settings.outputPrice')}
                  />
                </td>
                <td className="p-2 text-end">
                  <button
                    className="btn-ghost btn-sm text-red-600"
                    title={t('common.delete')}
                    onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
                  >
                    <Icon name="trash" className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">{t('settings.pricesHint')}</p>
    </div>
  )
}
