import { useEffect, useState } from 'react'
import type { AppInfo } from '@shared/types'
import { t } from '../../i18n'
import { api, call } from '../../lib/api'
import { useApp } from '../../lib/store'

export function AboutTab() {
  const license = useApp((s) => s.license)
  const setLicense = useApp((s) => s.setLicense)
  const [info, setInfo] = useState<AppInfo>()

  useEffect(() => {
    void call(api().app.info()).then(setInfo)
  }, [])

  return (
    <div className="card space-y-4 p-6">
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-violet-600 text-xl font-bold text-white">
          AI
        </div>
        <div>
          <h2 className="text-xl font-bold">{t('app.name')}</h2>
          <p className="text-sm text-slate-500">
            {t('settings.version', { version: info?.version ?? '' })}
          </p>
        </div>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-300">{t('settings.aboutText')}</p>
      <div className="space-y-1 text-sm">
        {license?.activated ? (
          <>
            <div className="font-medium">
              {t('settings.licensedTo', { name: license.licensee ?? '' })}
            </div>
            {license.email && <div className="text-slate-500">{license.email}</div>}
            <div className="text-slate-500">
              {t('settings.licenseId', { id: license.licenseId ?? '' })}
            </div>
          </>
        ) : (
          <div className="text-amber-600">{t('settings.unlicensedDev')}</div>
        )}
      </div>
      {info && (
        <div className="space-y-1 text-xs text-slate-500">
          <div>
            {t('settings.techInfo', {
              electron: info.electron,
              chrome: info.chrome,
              node: info.node,
              platform: info.platform
            })}
          </div>
          <div>
            {t('settings.dataFolder')}: <code>{info.userDataPath}</code>
          </div>
        </div>
      )}
      {license?.activated && (
        <button
          className="btn-secondary btn-sm"
          onClick={async () => {
            if (!window.confirm(t('settings.deactivateConfirm'))) return
            setLicense(await call(api().license.deactivate()))
          }}
        >
          {t('settings.deactivate')}
        </button>
      )}
    </div>
  )
}
