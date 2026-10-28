import { useState } from 'react'
import type { AppErrorInfo } from '@shared/types'
import { ErrorBox } from '../../components/ErrorBox'
import { Icon } from '../../components/Icon'
import { t } from '../../i18n'
import { api, call, errorInfo } from '../../lib/api'
import { useApp } from '../../lib/store'

export function BackupTab() {
  const [includeKeys, setIncludeKeys] = useState(false)
  const [message, setMessage] = useState<string>()
  const [error, setError] = useState<AppErrorInfo>()
  const refreshProviders = useApp((s) => s.refreshProviders)
  const setSettings = useApp((s) => s.setSettings)

  const run = async (fn: () => Promise<string | undefined>) => {
    setError(undefined)
    setMessage(undefined)
    try {
      setMessage(await fn())
    } catch (err) {
      setError(errorInfo(err))
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">{t('settings.backupIntro')}</p>
      <div className="card space-y-4 p-4">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={includeKeys}
            onChange={(e) => setIncludeKeys(e.target.checked)}
          />
          <span>
            <span className="font-medium">{t('settings.includeKeys')}</span>
            {includeKeys && (
              <span className="mt-1 block text-xs text-amber-600">
                {t('settings.includeKeysWarning')}
              </span>
            )}
          </span>
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-primary"
            onClick={() =>
              run(async () => {
                const res = await call(api().backup.export(includeKeys))
                return res ? t('settings.exported', { path: res.filePath }) : undefined
              })
            }
          >
            <Icon name="download" />
            {t('settings.exportBackup')}
          </button>
          <button
            className="btn-secondary"
            onClick={() =>
              run(async () => {
                if (!window.confirm(t('settings.importConfirm'))) return undefined
                const res = await call(api().backup.import())
                if (!res) return undefined
                await refreshProviders()
                setSettings(await call(api().settings.get()))
                return t('settings.imported', {
                  conversations: res.conversations,
                  prompts: res.prompts,
                  keys: res.keys
                })
              })
            }
          >
            <Icon name="upload" />
            {t('settings.importBackup')}
          </button>
        </div>
        {message && <p className="text-sm text-emerald-600">{message}</p>}
        {error && <ErrorBox error={error} onDismiss={() => setError(undefined)} />}
      </div>
    </div>
  )
}
