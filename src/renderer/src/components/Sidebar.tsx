import { t } from '../i18n'
import { useApp, type Page } from '../lib/store'
import { useIsDark } from '../lib/theme'
import { Icon, type IconName } from './Icon'

const ITEMS: Array<{ page: Page; icon: IconName }> = [
  { page: 'chat', icon: 'chat' },
  { page: 'images', icon: 'image' },
  { page: 'video', icon: 'video' },
  { page: 'audio', icon: 'audio' },
  { page: 'code', icon: 'code' },
  { page: 'history', icon: 'history' },
  { page: 'prompts', icon: 'prompts' }
]

export function Sidebar() {
  const page = useApp((s) => s.page)
  const navigate = useApp((s) => s.navigate)
  const updateSettings = useApp((s) => s.updateSettings)
  const setShortcutsOpen = useApp((s) => s.setShortcutsOpen)
  const automationOn = useApp((s) => Boolean(s.settings?.automation.enabled))
  const dark = useIsDark()

  const item = (p: Page, icon: IconName) => (
    <button
      key={p}
      onClick={() => navigate(p)}
      className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        page === p
          ? 'bg-brand-600 text-white'
          : 'text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800'
      }`}
      title={t(`nav.${p}`)}
      aria-current={page === p ? 'page' : undefined}
    >
      <Icon name={icon} className="h-5 w-5 shrink-0" />
      <span className="hidden lg:inline">{t(`nav.${p}`)}</span>
    </button>
  )

  return (
    <nav className="flex w-16 shrink-0 flex-col gap-1 border-e border-slate-200 bg-slate-100 p-2 dark:border-slate-800 dark:bg-slate-900 lg:w-52">
      <div className="mb-3 flex items-center gap-2 px-2 py-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-600 text-sm font-bold text-white">
          AI
        </div>
        <span className="hidden text-base font-bold lg:inline">{t('app.name')}</span>
      </div>
      {ITEMS.map((i) => item(i.page, i.icon))}
      {/* Optional module: only listed when enabled in Settings › Automation. */}
      {automationOn && item('automation', 'automation')}
      <div className="mt-auto flex flex-col gap-1">
        <button
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800"
          onClick={() => void updateSettings({ theme: dark ? 'light' : 'dark' })}
          title={dark ? t('settings.theme_light') : t('settings.theme_dark')}
        >
          <Icon name={dark ? 'sun' : 'moon'} className="h-5 w-5 shrink-0" />
          <span className="hidden lg:inline">
            {dark ? t('settings.theme_light') : t('settings.theme_dark')}
          </span>
        </button>
        <button
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800"
          onClick={() => setShortcutsOpen(true)}
          title={t('shortcuts.button')}
        >
          <Icon name="keyboard" className="h-5 w-5 shrink-0" />
          <span className="hidden lg:inline">{t('shortcuts.button')}</span>
        </button>
        {item('settings', 'settings')}
      </div>
    </nav>
  )
}
