import { useEffect, useState, type ReactNode } from 'react'
import { ErrorBoundary } from './components/ErrorBoundary'
import { OfflineBanner } from './components/OfflineBanner'
import { ShortcutsHelp } from './components/ShortcutsHelp'
import { Sidebar } from './components/Sidebar'
import { Toast } from './components/Toast'
import { t } from './i18n'
import { errorInfo } from './lib/api'
import { useApp, type Page } from './lib/store'
import { emitShortcut, matchShortcut } from './lib/shortcuts'
import { useIsDark } from './lib/theme'
import { AudioPage } from './pages/AudioPage'
import { ChatPage } from './pages/ChatPage'
import { HistoryPage } from './pages/HistoryPage'
import { ImagesPage } from './pages/ImagesPage'
import { LicenseScreen } from './pages/LicenseScreen'
import { OnboardingWizard } from './pages/OnboardingWizard'
import { PromptsPage } from './pages/PromptsPage'
import { SettingsPage } from './pages/SettingsPage'
import { VideoPage } from './pages/VideoPage'

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
  useIsDark(true)
  const navigate = useApp((s) => s.navigate)
  const shortcutsOpen = useApp((s) => s.shortcutsOpen)
  const setShortcutsOpen = useApp((s) => s.setShortcutsOpen)
  const licensed = Boolean(license && (license.activated || license.devSkipped))

  useEffect(() => {
    if (!licensed || !settings?.onboardingCompleted) return
    const onKey = (e: KeyboardEvent) => {
      const action = matchShortcut(e)
      if (!action) return
      const dialogOpen = Boolean(document.querySelector('[role="dialog"]'))
      if (action.type === 'stop') {
        if (!dialogOpen) emitShortcut(action) // Esc closes dialogs first
        return
      }
      if (dialogOpen && action.type !== 'help') return
      e.preventDefault()
      if (action.type === 'goto') navigate(action.page)
      else if (action.type === 'help') setShortcutsOpen(true)
      else emitShortcut(action)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [licensed, settings?.onboardingCompleted, navigate, setShortcutsOpen])

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
    <div className="flex h-full flex-col overflow-hidden">
      <OfflineBanner />
      {/* Remount on language change so every screen re-renders in the new language. */}
      <div className="flex min-h-0 flex-1" key={settings.language}>
        <Sidebar />
        <main className="relative min-w-0 flex-1">
          {[...visited].map((p) => (
            <div key={p} className={`absolute inset-0 flex-col ${p === page ? 'flex' : 'hidden'}`}>
              <ErrorBoundary>{PAGES[p]()}</ErrorBoundary>
            </div>
          ))}
        </main>
      </div>
      {!settings.onboardingCompleted && <OnboardingWizard />}
      {shortcutsOpen && <ShortcutsHelp onClose={() => setShortcutsOpen(false)} />}
      <Toast />
    </div>
  )
}
