import { useState } from 'react'
import type { AppErrorInfo } from '@shared/types'
import { ErrorBox } from '../components/ErrorBox'
import { t } from '../i18n'
import { api, call, errorInfo } from '../lib/api'
import { useApp } from '../lib/store'

export function LicenseScreen() {
  const license = useApp((s) => s.license)
  const setLicense = useApp((s) => s.setLicense)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AppErrorInfo>()

  const activate = async () => {
    setBusy(true)
    setError(undefined)
    try {
      setLicense(await call(api().license.activate(key)))
    } catch (err) {
      setError(errorInfo(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-br from-slate-100 to-brand-100 p-6 dark:from-slate-950 dark:to-slate-900">
      <div className="card w-full max-w-lg p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-600 text-lg font-bold text-white">
            AI
          </div>
          <div>
            <h1 className="text-xl font-bold">{t('license.title')}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('app.tagline')}</p>
          </div>
        </div>
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">{t('license.intro')}</p>
        <label className="label" htmlFor="license-key">
          {t('license.key')}
        </label>
        <textarea
          id="license-key"
          className="input h-28 resize-none font-mono text-xs"
          placeholder={t('license.placeholder')}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          spellCheck={false}
        />
        {error && (
          <div className="mt-3">
            <ErrorBox error={error} />
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button className="btn-primary" disabled={!key.trim() || busy} onClick={activate}>
            {busy ? t('license.activating') : t('license.activate')}
          </button>
          {license?.devMode && (
            <button
              className="btn-ghost"
              onClick={async () => setLicense(await call(api().license.skipDev()))}
            >
              {t('license.skipDev')}
            </button>
          )}
        </div>
        <p className="mt-6 text-xs text-slate-500">{t('license.help')}</p>
      </div>
    </div>
  )
}
