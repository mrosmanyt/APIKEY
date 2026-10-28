import path from 'node:path'
import {
  app,
  BrowserWindow,
  net,
  safeStorage,
  session,
  shell,
  type IpcMainInvokeEvent
} from 'electron'
import { APP_NAME, DEFAULT_SETTINGS } from '@shared/defaults'
import { mockAdapter } from '../providers/mock'
import { ADAPTERS, ProviderRegistry, registry } from '../providers/registry'
import { BackgroundManager } from './automation/background'
import { AutomationService } from './automation/service'
import { registerIpc } from './ipc'
import { LicenseManager } from './license'
import { initLogger } from './logger'
import { handleMediaProtocol, registerMediaSchemePrivileges } from './protocol'
import { AiService } from './services/ai'
import type { AppContext } from './services/context'
import { VideoService } from './services/video'
import { Storage, type Encryptor } from './storage'

app.setName(APP_NAME)
if (process.platform === 'win32') app.setAppUserModelId('com.aihub.desktop')

registerMediaSchemePrivileges()

// Lets automated tests / multiple dev profiles use an isolated data folder.
if (process.env.AIHUB_USER_DATA_DIR) app.setPath('userData', process.env.AIHUB_USER_DATA_DIR)

const isDev = !app.isPackaged
const devServerUrl = process.env['ELECTRON_RENDERER_URL']

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null
let background: BackgroundManager | undefined
/** Automation settings snapshot used by the window close handler. */
let automationSettings = DEFAULT_SETTINGS.automation

const encryptor: Encryptor = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plain) => safeStorage.encryptString(plain),
  decrypt: (cipher) => safeStorage.decryptString(cipher)
}

function isTrustedUrl(url: string): boolean {
  if (devServerUrl && url.startsWith(devServerUrl)) return true
  return url.startsWith('file://')
}

function showWindow(): void {
  if (!mainWindow) createWindow()
  else {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
}

function createWindow(startHidden = false): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: APP_NAME,
    backgroundColor: '#0b0f19',
    autoHideMenuBar: true,
    // Packaged builds use the icon embedded in the .exe.
    ...(isDev ? { icon: path.join(__dirname, '../../build/icon.png') } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: true
    }
  })

  mainWindow.once('ready-to-show', () => {
    if (!startHidden) mainWindow?.show()
  })

  // Automation "run in tray": closing the window hides it; automations keep running.
  mainWindow.on('close', (event) => {
    if (background?.keepRunningOnClose(automationSettings)) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  // Never open new windows inside the app; send https links to the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) {
      event.preventDefault()
      if (/^https:\/\//i.test(url)) void shell.openExternal(url)
    }
  })

  if (isDev && devServerUrl) void mainWindow.loadURL(devServerUrl)
  else void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

app.whenReady().then(() => {
  const userData = app.getPath('userData')
  const logsDir = path.join(userData, 'logs')
  const logger = initLogger(logsDir, isDev)
  logger.info(`${APP_NAME} ${app.getVersion()} starting (electron ${process.versions.electron})`)

  // Linux dev/CI machines without a keyring: allow Chromium's fallback key only when
  // explicitly requested. Windows always uses DPAPI.
  if (process.platform === 'linux' && isDev && process.env.AIHUB_ALLOW_PLAINTEXT_KEYS === '1') {
    safeStorage.setUsePlainTextEncryption(true)
  }

  const storage = new Storage(path.join(userData, 'data'), encryptor)
  storage.keys.registerAllForRedaction()

  const ctx: AppContext = {
    storage,
    // The mock provider exists only in unpackaged development builds.
    registry:
      isDev && process.env.AIHUB_MOCK_PROVIDER === '1'
        ? new ProviderRegistry([...ADAPTERS, mockAdapter])
        : registry,
    logger,
    // Electron's net.fetch uses Chromium's network stack (system proxy, certificates).
    fetch: (input, init) => net.fetch(input, init as RequestInit),
    defaultOutputDir: path.join(app.getPath('documents'), APP_NAME),
    emit: (channel, payload) => {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
    }
  }
  const ai = new AiService(ctx)
  const video = new VideoService(ctx, ai)
  const license = new LicenseManager(path.join(userData, 'license.json'), isDev)

  // Optional Automation module: constructed always, but it only starts anything when enabled.
  background = new BackgroundManager(() => mainWindow, showWindow)
  const automation = new AutomationService(
    ctx,
    ai,
    video,
    {
      emit: ctx.emit,
      notify: (title, body) => background?.notify(title, body),
      windowFocused: () => background?.windowFocused() ?? false
    },
    { dataDir: path.join(userData, 'data'), protectedDir: userData }
  )
  const applyAutomation = () => {
    automationSettings = storage.settings.get().automation
    background?.apply(automationSettings)
    void automation.apply().catch((err) => logger.error('Automation failed to start', err))
  }

  // Only grant microphone access (for speech-to-text recording); deny everything else.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const mediaTypes = (details as { mediaTypes?: string[] }).mediaTypes ?? []
    const trusted = isTrustedUrl(wc.getURL())
    const ok =
      trusted &&
      ((permission === 'media' && mediaTypes.every((t) => t === 'audio')) ||
        permission === 'clipboard-sanitized-write')
    callback(ok)
  })
  session.defaultSession.setPermissionCheckHandler(
    (_wc, permission) => permission === 'media' || permission === 'clipboard-sanitized-write'
  )

  handleMediaProtocol(storage)
  registerIpc({
    ctx,
    ai,
    video,
    license,
    logsDir,
    automation,
    onSettingsChanged: applyAutomation,
    isTrustedSender: (event: IpcMainInvokeEvent) => isTrustedUrl(event.senderFrame?.url ?? '')
  })

  video.resumePending()
  applyAutomation()
  // Started with Windows by the login item → stay in the tray when automations run there.
  createWindow(
    BackgroundManager.startedHidden() && automationSettings.enabled && automationSettings.runInTray
  )

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  process.on('uncaughtException', (err) => logger.error('Uncaught exception', err))
  process.on('unhandledRejection', (err) => logger.error('Unhandled rejection', err))
  app.on('before-quit', () => {
    video.stopAll()
    void automation.shutdown()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
