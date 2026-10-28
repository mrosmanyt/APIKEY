import { useState } from 'react'
import type { AppErrorInfo, Capability, ProviderInfo, ProviderStatus } from '@shared/types'
import { CAPABILITIES } from '@shared/types'
import { BetaBadge } from '../../components/BetaBadge'
import { ErrorBox } from '../../components/ErrorBox'
import { Icon } from '../../components/Icon'
import { t, tDynamic } from '../../i18n'
import { api, call, errorInfo } from '../../lib/api'
import { formatTime } from '../../lib/files'
import { useApp } from '../../lib/store'

export function StatusBadge({ status }: { status: ProviderStatus['status'] }) {
  const cls = {
    missing: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
    untested: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
    valid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200',
    invalid: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200'
  }[status]
  return (
    <span className={`badge ${cls}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {tDynamic(`settings.status_${status}`)}
    </span>
  )
}

export function ProviderCard({
  provider,
  status
}: {
  provider: ProviderInfo
  status?: ProviderStatus
}) {
  const setStatuses = useApp((s) => s.setStatuses)
  const refreshProviders = useApp((s) => s.refreshProviders)
  const showToast = useApp((s) => s.showToast)
  const setSettings = useApp((s) => s.setSettings)
  const [key, setKey] = useState('')
  const [editing, setEditing] = useState(!status?.hasKey)
  const [busy, setBusy] = useState<'save' | 'test' | 'config' | undefined>()
  const [error, setError] = useState<AppErrorInfo>()
  const [config, setConfig] = useState<Record<string, string>>(status?.config ?? {})

  const caps = CAPABILITIES.filter((c) => provider.capabilities[c as Capability])

  const test = async () => {
    setBusy('test')
    setError(undefined)
    try {
      const s = await call(api().providers.testKey(provider.id))
      setStatuses(await call(api().providers.statuses()))
      if (s.status !== 'valid' && s.lastError) setError(s.lastError)
    } catch (err) {
      setError(errorInfo(err))
    } finally {
      setBusy(undefined)
    }
  }

  const saveKey = async () => {
    setBusy('save')
    setError(undefined)
    try {
      if (provider.configFields.length) await call(api().providers.setConfig(provider.id, config))
      setStatuses(await call(api().providers.saveKey(provider.id, key)))
      setKey('')
      setEditing(false)
      await refreshProviders()
      setBusy(undefined)
      await test() // validate immediately so the provider becomes usable
    } catch (err) {
      setError(errorInfo(err))
      setBusy(undefined)
    }
  }

  const saveConfig = async () => {
    setBusy('config')
    try {
      setStatuses(await call(api().providers.setConfig(provider.id, config)))
      await refreshProviders()
      showToast(t('settings.configSaved'))
    } catch (err) {
      setError(errorInfo(err))
    } finally {
      setBusy(undefined)
    }
  }

  const connect = async () => {
    setBusy('test')
    setError(undefined)
    try {
      if (provider.configFields.length) await call(api().providers.setConfig(provider.id, config))
      const s = await call(api().providers.connect(provider.id))
      await refreshProviders()
      setStatuses(await call(api().providers.statuses()))
      setSettings(await call(api().settings.get()))
      if (s.status !== 'valid' && s.lastError) setError(s.lastError)
    } catch (err) {
      setError(errorInfo(err))
    } finally {
      setBusy(undefined)
    }
  }

  const disconnect = async () => {
    setStatuses(await call(api().providers.deleteKey(provider.id)))
    setError(undefined)
  }

  const remove = async () => {
    if (!window.confirm(t('settings.deleteKeyConfirm', { name: provider.name }))) return
    setStatuses(await call(api().providers.deleteKey(provider.id)))
    setEditing(true)
    setError(undefined)
  }

  const missingConfig = provider.configFields.some((f) => f.required && !config[f.key]?.trim())

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{provider.name}</h3>
            {provider.beta && <BetaBadge />}
            <StatusBadge status={status?.status ?? 'missing'} />
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{provider.description}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {caps.map((c) => (
              <span
                key={c}
                className="badge bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200"
              >
                {tDynamic(`settings.cap_${c}`)}
              </span>
            ))}
            {provider.capabilities.video?.experimental && (
              <BetaBadge label={t('settings.cap_video')} />
            )}
            {!provider.capabilities.video?.experimental &&
              provider.capabilities.video?.models.some((m) => m.imageInputBeta) && (
                <BetaBadge label={t('settings.cap_imageToVideo')} />
              )}
          </div>
        </div>
        <button
          className="btn-ghost btn-sm"
          onClick={() => void api().app.openExternal(provider.keyUrl)}
        >
          <Icon name="external" className="h-3.5 w-3.5" />
          {t('settings.getKey')}
        </button>
      </div>

      {provider.configFields.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {provider.configFields.map((f) => (
            <div key={f.key} className={f.key === 'baseUrl' ? 'sm:col-span-2' : ''}>
              <label className="label" htmlFor={`${provider.id}-${f.key}`}>
                {f.label}
                {f.required && ' *'}
              </label>
              <input
                id={`${provider.id}-${f.key}`}
                className="input"
                placeholder={f.placeholder}
                value={config[f.key] ?? ''}
                onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })}
                spellCheck={false}
              />
              {f.help && <p className="mt-1 text-xs text-slate-500">{f.help}</p>}
            </div>
          ))}
          {status?.hasKey && (
            <div className="sm:col-span-2">
              <button
                className="btn-secondary btn-sm"
                onClick={saveConfig}
                disabled={busy !== undefined || missingConfig}
              >
                {t('settings.saveConfig')}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="mt-4">
        {provider.keyOptional ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-600 dark:text-slate-300">
              {t('settings.noKeyNeeded')}
            </span>
            {status?.lastTestedAt && (
              <span className="text-xs text-slate-500">
                {t('settings.lastTested', { time: formatTime(status.lastTestedAt) })}
              </span>
            )}
            <div className="ms-auto flex gap-2">
              <button
                className="btn-primary btn-sm"
                onClick={connect}
                disabled={busy !== undefined}
              >
                {busy === 'test' ? t('settings.testing') : t('settings.testConnection')}
              </button>
              {status?.hasKey && (
                <button className="btn-ghost btn-sm text-red-600" onClick={disconnect}>
                  {t('settings.disconnect')}
                </button>
              )}
            </div>
          </div>
        ) : status?.hasKey && !editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-slate-600 dark:text-slate-300">
              {t('settings.keySaved', { hint: status.keyHint ?? '' })}
            </span>
            {status.lastTestedAt && (
              <span className="text-xs text-slate-500">
                {t('settings.lastTested', { time: formatTime(status.lastTestedAt) })}
              </span>
            )}
            <div className="ms-auto flex gap-2">
              <button className="btn-primary btn-sm" onClick={test} disabled={busy !== undefined}>
                {busy === 'test' ? t('settings.testing') : t('settings.testKey')}
              </button>
              <button className="btn-secondary btn-sm" onClick={() => setEditing(true)}>
                {t('settings.replaceKey')}
              </button>
              <button className="btn-ghost btn-sm text-red-600" onClick={remove}>
                <Icon name="trash" className="h-3.5 w-3.5" />
                {t('settings.deleteKey')}
              </button>
            </div>
          </div>
        ) : (
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (key.trim() && !missingConfig) void saveKey()
            }}
          >
            <input
              type="password"
              className="input min-w-[16rem] flex-1 font-mono"
              placeholder={provider.keyPlaceholder}
              aria-label={t('settings.apiKey')}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="submit"
              className="btn-primary"
              disabled={!key.trim() || busy !== undefined || missingConfig}
            >
              {busy === 'save' || busy === 'test' ? t('settings.testing') : t('settings.saveKey')}
            </button>
            {status?.hasKey && (
              <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>
                {t('common.cancel')}
              </button>
            )}
          </form>
        )}
      </div>

      {(error || (status?.status === 'invalid' && status.lastError)) && (
        <div className="mt-3">
          <ErrorBox
            error={(error ?? status?.lastError)!}
            onDismiss={error ? () => setError(undefined) : undefined}
          />
        </div>
      )}
    </div>
  )
}

export function KeysTab() {
  const providers = useApp((s) => s.providers)
  const statuses = useApp((s) => s.statuses)
  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
        <Icon name="key" />
        {t('settings.keysIntro')}
      </p>
      {providers.map((p) => (
        <ProviderCard key={p.id} provider={p} status={statuses[p.id]} />
      ))}
    </div>
  )
}
