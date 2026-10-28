import { useEffect, useState } from 'react'
import type { AutomationSettings, WebhookInfo } from '@shared/automation'
import { CopyButton } from '../../components/CopyButton'
import { t } from '../../i18n'
import { api, call, errorInfo } from '../../lib/api'
import { useApp } from '../../lib/store'

function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
  disabled?: boolean
}) {
  return (
    <label className={`flex items-start gap-3 text-sm ${disabled ? 'opacity-50' : ''}`}>
      <input
        type="checkbox"
        className="mt-1"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
    </label>
  )
}

export function AutomationTab() {
  const settings = useApp((s) => s.settings)!
  const updateSettings = useApp((s) => s.updateSettings)
  const showToast = useApp((s) => s.showToast)
  const a = settings.automation
  const [webhook, setWebhook] = useState<WebhookInfo>()
  const [port, setPort] = useState(a.webhookPort)

  const set = async (patch: Partial<AutomationSettings>) => {
    try {
      await updateSettings({ automation: { ...a, ...patch } })
    } catch (err) {
      showToast(errorInfo(err).message, 'error')
    }
  }

  useEffect(() => {
    if (!a.enabled) return
    // The webhook server starts asynchronously; refresh shortly after changes.
    const load = () =>
      void call(api().automation.webhookInfo())
        .then(setWebhook)
        .catch(() => undefined)
    load()
    const h = setTimeout(load, 600)
    return () => clearTimeout(h)
  }, [a.enabled, a.webhookEnabled, a.webhookPort])

  const cost = (key: keyof AutomationSettings['unitCosts'], label: string) => (
    <div>
      <label className="label">{label}</label>
      <input
        type="number"
        min={0}
        step="0.001"
        className="input"
        defaultValue={a.unitCosts[key]}
        onBlur={(e) =>
          void set({
            unitCosts: { ...a.unitCosts, [key]: Math.max(0, Number(e.target.value) || 0) }
          })
        }
      />
    </div>
  )

  return (
    <div className="space-y-6">
      <section className="card space-y-4 p-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('settings.automationIntro')}
        </p>
        <Toggle
          checked={a.enabled}
          onChange={(v) => void set({ enabled: v })}
          label={t('settings.automationEnable')}
          hint={a.enabled ? t('settings.automationEnabledNote') : undefined}
        />
      </section>

      {a.enabled && (
        <>
          <section className="card space-y-3 p-4">
            <Toggle
              checked={a.runInTray}
              onChange={(v) =>
                void set({ runInTray: v, ...(v ? {} : { startWithWindows: false }) })
              }
              label={t('settings.runInTray')}
            />
            <Toggle
              checked={a.startWithWindows}
              disabled={!a.runInTray}
              onChange={(v) => void set({ startWithWindows: v })}
              label={t('settings.startWithWindows')}
              hint={t('settings.startWithWindowsHint')}
            />
            <Toggle
              checked={a.notifyOnSuccess}
              onChange={(v) => void set({ notifyOnSuccess: v })}
              label={t('settings.notifyOnSuccess')}
            />
            <Toggle
              checked={a.notifyOnFailure}
              onChange={(v) => void set({ notifyOnFailure: v })}
              label={t('settings.notifyOnFailure')}
            />
          </section>

          <section className="card space-y-3 p-4">
            <h3 className="font-semibold">{t('settings.webhook')}</h3>
            <Toggle
              checked={a.webhookEnabled}
              onChange={(v) => void set({ webhookEnabled: v })}
              label={t('settings.webhookEnable')}
              hint={t('settings.webhookHint')}
            />
            {a.webhookEnabled && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-32">
                    <label className="label">{t('settings.webhookPort')}</label>
                    <input
                      type="number"
                      min={1024}
                      max={65535}
                      className="input"
                      value={port}
                      onChange={(e) => setPort(Number(e.target.value))}
                      onBlur={() =>
                        port !== a.webhookPort &&
                        port >= 1024 &&
                        port <= 65535 &&
                        void set({ webhookPort: port })
                      }
                    />
                  </div>
                  <span
                    className={`badge ${webhook?.running ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200' : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}
                  >
                    {webhook?.running ? t('settings.webhookRunning') : t('settings.webhookStopped')}
                  </span>
                </div>
                {webhook?.error && <p className="text-sm text-red-600">{webhook.error}</p>}
                {webhook && (
                  <div className="space-y-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="w-16 text-slate-500">{t('settings.webhookUrl')}</span>
                      <code className="rounded bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800">
                        {webhook.baseUrl}/run/&lt;workflow-id&gt;
                      </code>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="w-16 text-slate-500">{t('settings.webhookToken')}</span>
                      <code className="max-w-full truncate rounded bg-slate-100 px-2 py-1 font-mono text-xs dark:bg-slate-800">
                        {webhook.token}
                      </code>
                      <CopyButton text={webhook.token} />
                      <button
                        className="btn-ghost btn-sm"
                        onClick={async () => {
                          if (window.confirm(t('settings.regenerateConfirm')))
                            setWebhook(await call(api().automation.regenerateToken()))
                        }}
                      >
                        {t('settings.regenerateToken')}
                      </button>
                    </div>
                    <div>
                      <span className="text-slate-500">{t('settings.webhookExample')}</span>
                      <pre className="mt-1 overflow-x-auto rounded bg-slate-900 p-2 text-xs text-slate-100">{`curl -X POST ${webhook.baseUrl}/run/<workflow-id> -H "Authorization: Bearer ${webhook.token}" -d "your text"`}</pre>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="card space-y-3 p-4">
            <h3 className="font-semibold">{t('settings.unitCosts')}</h3>
            <p className="text-xs text-slate-500">{t('settings.unitCostsHint')}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {cost('image', t('settings.unitImage'))}
              {cost('video', t('settings.unitVideo'))}
              {cost('tts', t('settings.unitTts'))}
              {cost('stt', t('settings.unitStt'))}
              {cost('chatInputPer1M', t('settings.unitChatIn'))}
              {cost('chatOutputPer1M', t('settings.unitChatOut'))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
