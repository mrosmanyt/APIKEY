import { useEffect, useState, type ReactNode } from 'react'
import { Sidebar } from './components/Sidebar'
import { Toast } from './components/Toast'
import { t } from './i18n'
import { errorInfo } from './lib/api'
import { useApp, type Page } from './lib/store'
import { AudioPage } from './pages/AudioPage'
import { ChatPage } from './pages/ChatPage'
import { HistoryPage } from './pages/HistoryPage'
import { ImagesPage } from './pages/ImagesPage'
import { LicenseScreen } from './pages/LicenseScreen'
import { PromptsPage } from './pages/PromptsPage'
import { SettingsPage } from './pages/SettingsPage'
import { VideoPage } from './pages/VideoPage'

function useTheme() {
  const theme = useApp((s) => s.settings?.theme ?? 'system')
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches)
      document.documentElement.classList.toggle('dark', dark)
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
}

const PAGES: Record<Page, () => ReactNode> = {
  chat: () => <ChatPage mode="chat" />,
  code: () => <ChatPage mode="code" />,
  images: () => <ImagesPage />,
  video: () => <VideoPage />,
  audio: () => <AudioPage />,
  history: () => <HistoryPage />,
  prompts: () => <PromptsPage />,
  settings: () => <SettingsPage />
}

export function App() {
  const ready = useApp((s) => s.ready)
  const init = useApp((s) => s.init)
  const license = useApp((s) => s.license)
  const page = useApp((s) => s.page)
  const settings = useApp((s) => s.settings)
  const [error, setError] = useState<string>()
  // Pages stay mounted after first visit so streams and form state survive navigation.
  const [visited, setVisited] = useState<Set<Page>>(new Set())
  useTheme()

  useEffect(() => {
    init().catch((err) => setError(errorInfo(err).message))
  }, [init])

  useEffect(() => {
    setVisited((v) => (v.has(page) ? v : new Set(v).add(page)))
  }, [page])

  if (error) return <div className="p-8 text-red-600">{error}</div>
  if (!ready || !license)
    return (
      <div className="flex h-full items-center justify-center text-slate-500">
        {t('common.loading')}
      </div>
    )
  if (!license.activated && !license.devSkipped) return <LicenseScreen />
  if (!settings)
    return (
      <div className="flex h-full items-center justify-center text-slate-500">
        {t('common.loading')}
      </div>
    )

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar />
      <main className="relative min-w-0 flex-1">
        {[...visited].map((p) => (
          <div key={p} className={`absolute inset-0 flex-col ${p === page ? 'flex' : 'hidden'}`}>
            {PAGES[p]()}
          </div>
        ))}
      </main>
      <Toast />
    </div>
  )
}
