import type { ReactNode } from 'react'
import { PageHeader } from '../components/PageHeader'
import { t, type TranslationKey } from '../i18n'
import { useApp } from '../lib/store'
import { AboutTab } from './settings/AboutTab'
import { AutomationTab } from './settings/AutomationTab'
import { BackupTab } from './settings/BackupTab'
import { DefaultsTab } from './settings/DefaultsTab'
import { GeneralTab } from './settings/GeneralTab'
import { KeysTab } from './settings/KeysTab'
import { PricesTab } from './settings/PricesTab'
import { UsageTab } from './settings/UsageTab'

const TABS: Array<{ id: string; label: TranslationKey; render: () => ReactNode }> = [
  { id: 'keys', label: 'settings.tabKeys', render: () => <KeysTab /> },
  { id: 'defaults', label: 'settings.tabDefaults', render: () => <DefaultsTab /> },
  { id: 'general', label: 'settings.tabGeneral', render: () => <GeneralTab /> },
  { id: 'usage', label: 'settings.tabUsage', render: () => <UsageTab /> },
  { id: 'prices', label: 'settings.tabPrices', render: () => <PricesTab /> },
  { id: 'backup', label: 'settings.tabBackup', render: () => <BackupTab /> },
  { id: 'automation', label: 'settings.tabAutomation', render: () => <AutomationTab /> },
  { id: 'about', label: 'settings.tabAbout', render: () => <AboutTab /> }
]

export function SettingsPage() {
  const tab = useApp((s) => s.settingsTab)
  const navigate = useApp((s) => s.navigate)
  const current = TABS.find((x) => x.id === tab) ?? TABS[0]
  return (
    <>
      <PageHeader title={t('settings.title')} />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200 p-2 dark:border-slate-800 md:w-48 md:flex-col md:border-b-0 md:border-e">
          {TABS.map((x) => (
            <button
              key={x.id}
              onClick={() => navigate('settings', { settingsTab: x.id })}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-start text-sm ${
                x.id === current.id
                  ? 'bg-slate-200 font-semibold dark:bg-slate-800'
                  : 'hover:bg-slate-100 dark:hover:bg-slate-800/60'
              }`}
            >
              {t(x.label)}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
          <div className="mx-auto max-w-4xl">{current.render()}</div>
        </div>
      </div>
    </>
  )
}
