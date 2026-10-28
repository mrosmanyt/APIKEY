import { useEffect, useState } from 'react'
import type { AppInfo, ThemeSetting } from '@shared/types'
import { Icon } from '../../components/Icon'
import { LANGUAGES, t, tDynamic } from '../../i18n'
import { api, call } from '../../lib/api'
import { useApp } from '../../lib/store'

export function GeneralTab() {
  const settings = useApp((s) => s.settings)!
  const updateSettings = useApp((s) => s.updateSettings)
  const setSettings = useApp((s) => s.setSettings)
  const [info, setInfo] = useState<AppInfo>()
  const [temp, setTemp] = useState(settings.chat.temperature)
  const [maxTokens, setMaxTokens] = useState(settings.chat.maxTokens)

  useEffect(() => {
    void call(api().app.info()).then(setInfo)
  }, [settings.outputDir])

  return (
    <div className="space-y-6">
      <section className="card space-y-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">{t('settings.theme')}</label>
            <select
              className="input"
              value={settings.theme}
              onChange={(e) => void updateSettings({ theme: e.target.value as ThemeSetting })}
            >
              {(['system', 'light', 'dark'] as const).map((th) => (
                <option key={th} value={th}>
                  {tDynamic(`settings.theme_${th}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{t('settings.language')}</label>
            <select
              className="input"
              value={settings.language}
              onChange={(e) => void updateSettings({ language: e.target.value })}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="card space-y-2 p-4">
        <label className="label">{t('settings.outputFolder')}</label>
        <p className="text-xs text-slate-500">{t('settings.outputFolderHint')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-slate-100 px-2 py-1.5 text-xs dark:bg-slate-800">
            {info?.outputDir}
          </code>
          <button
            className="btn-secondary btn-sm"
            onClick={async () => {
              const s = await call(api().settings.chooseOutputDir())
              if (s) setSettings(s)
            }}
          >
            {t('settings.changeFolder')}
          </button>
          {settings.outputDir && (
            <button
              className="btn-ghost btn-sm"
              onClick={() => void updateSettings({ outputDir: '' })}
            >
              {t('settings.resetFolder')}
            </button>
          )}
          <button className="btn-ghost btn-sm" onClick={() => void api().app.openOutputFolder()}>
            <Icon name="folder" className="h-3.5 w-3.5" />
            {t('common.openFolder')}
          </button>
        </div>
      </section>

      <section className="card space-y-3 p-4">
        <h3 className="font-semibold">{t('settings.chatDefaults')}</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">
              {t('chat.temperature')}: {temp.toFixed(1)}
            </label>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={temp}
              className="w-full"
              onChange={(e) => setTemp(Number(e.target.value))}
              onMouseUp={() => void updateSettings({ chat: { temperature: temp, maxTokens } })}
              onKeyUp={() => void updateSettings({ chat: { temperature: temp, maxTokens } })}
            />
          </div>
          <div>
            <label className="label">{t('chat.maxTokens')}</label>
            <input
              type="number"
              className="input"
              min={1}
              value={maxTokens}
              onChange={(e) => setMaxTokens(Math.max(1, Number(e.target.value) || 1))}
              onBlur={() => void updateSettings({ chat: { temperature: temp, maxTokens } })}
            />
          </div>
        </div>
      </section>

      <section className="card space-y-2 p-4">
        <h3 className="font-semibold">{t('settings.logs')}</h3>
        <p className="text-sm text-slate-500">{t('settings.logsHint')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-slate-100 px-2 py-1.5 text-xs dark:bg-slate-800">
            {info?.logsPath}
          </code>
          <button className="btn-secondary btn-sm" onClick={() => void api().app.openLogsFolder()}>
            <Icon name="folder" className="h-3.5 w-3.5" />
            {t('settings.openLogs')}
          </button>
        </div>
      </section>
      <section className="card space-y-2 p-4">
        <h3 className="font-semibold">{t('settings.wizard')}</h3>
        <button
          className="btn-secondary btn-sm"
          onClick={() => void updateSettings({ onboardingCompleted: false })}
        >
          {t('settings.runWizard')}
        </button>
      </section>
    </div>
  )
}
