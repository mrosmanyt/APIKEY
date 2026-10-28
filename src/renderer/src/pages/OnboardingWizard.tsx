import { useState } from 'react'
import { Icon } from '../components/Icon'
import { t } from '../i18n'
import { api, call } from '../lib/api'
import { useApp } from '../lib/store'
import { ProviderCard, StatusBadge } from './settings/KeysTab'

/** Providers shown first: the most common, plus free options. */
const RECOMMENDED = ['openai', 'anthropic', 'gemini', 'groq', 'openrouter', 'ollama']
const STEPS = 3

/** First-run setup shown after license activation (re-run from Settings › General). */
export function OnboardingWizard() {
  const providers = useApp((s) => s.providers)
  const statuses = useApp((s) => s.statuses)
  const setStatuses = useApp((s) => s.setStatuses)
  const updateSettings = useApp((s) => s.updateSettings)
  const navigate = useApp((s) => s.navigate)
  const [step, setStep] = useState(1)
  const [showAll, setShowAll] = useState(false)
  const [testing, setTesting] = useState<string[]>([])

  const shown = showAll ? providers : providers.filter((p) => RECOMMENDED.includes(p.id))
  const withKeys = providers.filter((p) => statuses[p.id]?.hasKey)
  const ready = providers.filter((p) => statuses[p.id]?.status === 'valid')

  const test = async (ids: string[]) => {
    setTesting((cur) => [...cur, ...ids])
    await Promise.all(ids.map((id) => api().providers.testKey(id)))
    setStatuses(await call(api().providers.statuses()))
    setTesting((cur) => cur.filter((x) => !ids.includes(x)))
  }

  const finish = async () => {
    await updateSettings({ onboardingCompleted: true })
    navigate(ready.length ? 'chat' : 'settings', ready.length ? undefined : { settingsTab: 'keys' })
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/60 p-4"
      role="dialog"
      aria-label={t('onboarding.title')}
    >
      <div className="card flex max-h-[92vh] w-full max-w-3xl flex-col">
        <div className="flex items-center gap-3 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-600 text-sm font-bold text-white">
            AI
          </div>
          <div className="me-auto">
            <h2 className="font-semibold">{t('onboarding.title')}</h2>
            <p className="text-xs text-slate-500">
              {t('onboarding.stepOf', { n: step, total: STEPS })}
            </p>
          </div>
          <button className="btn-ghost btn-sm" onClick={finish}>
            {t('onboarding.skip')}
          </button>
        </div>
        <div className="flex gap-1 px-6 pt-3" aria-hidden="true">
          {Array.from({ length: STEPS }, (_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full ${i < step ? 'bg-brand-600' : 'bg-slate-200 dark:bg-slate-700'}`}
            />
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {step === 1 && (
            <div className="space-y-4">
              <h3 className="text-xl font-bold">{t('onboarding.welcomeTitle')}</h3>
              <p className="text-slate-600 dark:text-slate-300">{t('onboarding.welcomeBody')}</p>
              <ul className="space-y-2 text-sm">
                {(['privacy1', 'privacy2', 'privacy3'] as const).map((k) => (
                  <li key={k} className="flex items-start gap-2">
                    <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    {t(`onboarding.${k}`)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">{t('onboarding.keysTitle')}</h3>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {t('onboarding.keysBody')}
              </p>
              <p className="rounded-lg bg-brand-50 p-3 text-sm text-brand-800 dark:bg-brand-900/30 dark:text-brand-200">
                {t('onboarding.tipFree')}
              </p>
              {shown.map((p) => (
                <ProviderCard key={p.id} provider={p} status={statuses[p.id]} />
              ))}
              <button className="btn-ghost btn-sm" onClick={() => setShowAll(!showAll)}>
                {showAll ? t('onboarding.showFewer') : t('onboarding.showAll')}
              </button>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">{t('onboarding.testTitle')}</h3>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {t('onboarding.testBody')}
              </p>
              {withKeys.length === 0 ? (
                <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  {t('onboarding.noKeysYet')}
                </p>
              ) : (
                <>
                  <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                    {withKeys.map((p) => {
                      const s = statuses[p.id]
                      return (
                        <li key={p.id} className="flex flex-wrap items-center gap-3 p-3">
                          <span className="me-auto font-medium">{p.name}</span>
                          <StatusBadge status={s.status} />
                          <button
                            className="btn-secondary btn-sm"
                            onClick={() => test([p.id])}
                            disabled={testing.includes(p.id)}
                          >
                            {testing.includes(p.id) ? t('settings.testing') : t('settings.testKey')}
                          </button>
                          {s.status === 'invalid' && s.lastError && (
                            <p className="w-full text-xs text-red-600">{s.lastError.message}</p>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                  <div className="flex items-center gap-3">
                    <button
                      className="btn-secondary"
                      onClick={() => test(withKeys.map((p) => p.id))}
                      disabled={testing.length > 0}
                    >
                      {t('onboarding.testAll')}
                    </button>
                    <span className="text-sm text-slate-500">
                      {t('onboarding.readyCount', { count: ready.length, total: withKeys.length })}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
          {step > 1 && (
            <button className="btn-ghost" onClick={() => setStep(step - 1)}>
              {t('onboarding.back')}
            </button>
          )}
          <span className="me-auto" />
          {step < STEPS ? (
            <button className="btn-primary" onClick={() => setStep(step + 1)}>
              {t('onboarding.next')}
            </button>
          ) : (
            <button className="btn-primary" onClick={finish}>
              {t('onboarding.finish')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
