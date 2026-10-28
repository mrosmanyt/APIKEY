import { useState } from 'react'
import type { Capability } from '@shared/types'
import { t } from '../i18n'
import { api, call, errorInfo } from '../lib/api'
import { modelsFor, usableProviders, useApp } from '../lib/store'
import { Icon } from './Icon'
import type { Selection } from '../lib/selection'

const CUSTOM = '__custom__'

export function ProviderModelPicker({
  capability,
  value,
  onChange,
  compact
}: {
  capability: Capability
  value: Selection | undefined
  onChange: (s: Selection) => void
  compact?: boolean
}) {
  const providers = useApp((s) => s.providers)
  const statuses = useApp((s) => s.statuses)
  const settings = useApp((s) => s.settings)
  const setSettings = useApp((s) => s.setSettings)
  const navigate = useApp((s) => s.navigate)
  const showToast = useApp((s) => s.showToast)
  const [customMode, setCustomMode] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const candidates = providers.filter((p) => p.capabilities[capability])
  const usable = usableProviders({ providers, statuses }, capability)
  const provider = providers.find((p) => p.id === value?.providerId)
  const models = modelsFor(provider, capability, settings)
  const isKnownModel = models.some((m) => m.id === value?.model)

  if (usable.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        <Icon name="key" />
        <span>{t('providerPicker.noProviders')}</span>
        <button
          className="btn-secondary btn-sm"
          onClick={() => navigate('settings', { settingsTab: 'keys' })}
        >
          {t('providerPicker.addKey')}
        </button>
      </div>
    )
  }

  const refresh = async () => {
    if (!provider) return
    setRefreshing(true)
    try {
      const list = await call(api().providers.listModels(provider.id, capability))
      setSettings(await call(api().settings.get()))
      showToast(t('common.modelsRefreshed', { count: list.length }))
    } catch (err) {
      showToast(errorInfo(err).message, 'error')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className={`flex flex-wrap items-end gap-2 ${compact ? '' : 'w-full'}`}>
      <div className={compact ? 'w-44' : 'min-w-[10rem] flex-1'}>
        {!compact && <label className="label">{t('common.provider')}</label>}
        <select
          className="input"
          aria-label={t('common.provider')}
          value={value?.providerId ?? ''}
          onChange={(e) => {
            const p = providers.find((x) => x.id === e.target.value)
            setCustomMode(false)
            onChange({
              providerId: e.target.value,
              model: modelsFor(p, capability, settings)[0]?.id ?? ''
            })
          }}
        >
          {candidates.map((p) => {
            const ok = usable.some((u) => u.id === p.id)
            return (
              <option key={p.id} value={p.id} disabled={!ok}>
                {ok ? p.name : t('providerPicker.notUsable', { name: p.name })}
              </option>
            )
          })}
        </select>
      </div>
      <div className={compact ? 'w-56' : 'min-w-[12rem] flex-[2]'}>
        {!compact && <label className="label">{t('common.model')}</label>}
        <div className="flex gap-1">
          {customMode || (!isKnownModel && value?.model) ? (
            <input
              className="input"
              aria-label={t('common.model')}
              placeholder={t('common.enterModelId')}
              value={value?.model ?? ''}
              onChange={(e) => value && onChange({ ...value, model: e.target.value })}
              onBlur={() => !value?.model && setCustomMode(false)}
            />
          ) : (
            <select
              className="input"
              aria-label={t('common.model')}
              value={value?.model ?? ''}
              onChange={(e) => {
                if (e.target.value === CUSTOM) {
                  setCustomMode(true)
                  if (value) onChange({ ...value, model: '' })
                } else if (value) onChange({ ...value, model: e.target.value })
              }}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id}
                </option>
              ))}
              <option value={CUSTOM}>{t('common.customModel')}</option>
            </select>
          )}
          {customMode && (
            <button
              className="btn-ghost"
              onClick={() => {
                setCustomMode(false)
                if (value) onChange({ ...value, model: models[0]?.id ?? '' })
              }}
              title={t('common.cancel')}
            >
              <Icon name="x" />
            </button>
          )}
          {provider?.canListModels && (
            <button
              className="btn-ghost"
              onClick={refresh}
              disabled={refreshing}
              title={t('common.refreshModels')}
            >
              <Icon name="refresh" className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
