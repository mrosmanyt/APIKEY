import fs from 'node:fs'
import path from 'node:path'
import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  ipcMain,
  nativeImage,
  shell,
  type IpcMainInvokeEvent
} from 'electron'
import { z } from 'zod'
import { redact, registerSecret, unregisterSecret } from '@shared/redact'
import type {
  AppErrorInfo,
  AppInfo,
  BackupImportPreview,
  Capability,
  IpcResult,
  LicenseStatus,
  Settings
} from '@shared/types'
import type { InvokeChannel } from '../preload/api-types'
import { ProviderError } from '../providers/errors'
import type { LicenseManager } from './license'
import { conversationToJson, conversationToMarkdown } from './storage/conversations'
import {
  assertPassphrase,
  createBackup,
  parseBackup,
  restoreBackup,
  summarizeBackup,
  type BackupFile
} from './services/backup'
import { outputDir, type AppContext } from './services/context'
import type { AiService } from './services/ai'
import type { VideoService } from './services/video'
import {
  zCapability,
  zChatRequest,
  zConfig,
  zConversation,
  zId,
  zImageRequest,
  zPrompt,
  zProviderId,
  zSettingsPatch,
  zSttRequest,
  zTtsRequest,
  zVideoRequest
} from './validation'

export interface IpcDeps {
  ctx: AppContext
  ai: AiService
  video: VideoService
  license: LicenseManager
  logsDir: string
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean
}

function errorInfo(err: unknown): AppErrorInfo {
  if (err instanceof ProviderError) return err.toInfo()
  if (err instanceof z.ZodError) {
    return {
      kind: 'bad_request',
      message: 'Invalid input',
      details: redact(err.message).slice(0, 2000)
    }
  }
  const message = err instanceof Error ? err.message : String(err)
  return { kind: 'unknown', message: redact(message) }
}

/** License gate: everything except app/license channels requires an activated license. */
const UNGATED = /^(app|license):/

export function registerIpc(deps: IpcDeps): void {
  const { ctx, ai, video, license } = deps
  const storage = ctx.storage

  const licensed = (s: LicenseStatus) => s.activated || Boolean(s.devSkipped)

  function handle<A extends unknown[]>(
    channel: InvokeChannel,
    schema: z.ZodType<A>,
    fn: (...args: A) => unknown
  ): void {
    ipcMain.handle(channel, async (event, ...raw): Promise<IpcResult<unknown>> => {
      if (!deps.isTrustedSender(event)) {
        ctx.logger.warn(`Rejected IPC from untrusted sender on ${channel}`)
        return { ok: false, error: { kind: 'unknown', message: 'Untrusted sender' } }
      }
      if (!UNGATED.test(channel) && !licensed(license.status())) {
        return {
          ok: false,
          error: { kind: 'not_configured', message: 'Please activate your license first.' }
        }
      }
      try {
        const args = schema.parse(raw)
        const data = await fn(...args)
        return { ok: true, data: data === undefined ? null : data }
      } catch (err) {
        const error = errorInfo(err)
        if (!(err instanceof ProviderError)) ctx.logger.error(`IPC ${channel} failed`, error)
        return { ok: false, error }
      }
    })
  }

  const none = z.tuple([])
  const one = <T extends z.ZodTypeAny>(t: T) => z.tuple([t])
  const win = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]

  async function saveCopy(source: string | undefined, defaultName: string): Promise<string | null> {
    if (!source || !fs.existsSync(source)) throw new Error('File not found on disk.')
    const res = await dialog.showSaveDialog(win(), {
      defaultPath: path.join(app.getPath('downloads'), defaultName)
    })
    if (res.canceled || !res.filePath) return null
    await fs.promises.copyFile(source, res.filePath)
    return res.filePath
  }

  // ----------------------------------------------------------- app
  handle('app:info', none, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: `${process.platform} ${process.arch}`,
    isPackaged: app.isPackaged,
    userDataPath: app.getPath('userData'),
    logsPath: deps.logsDir,
    outputDir: outputDir(ctx)
  }))
  handle('app:openLogsFolder', none, async () => {
    fs.mkdirSync(deps.logsDir, { recursive: true })
    await shell.openPath(deps.logsDir)
  })
  handle('app:openOutputFolder', none, async () => {
    const dir = outputDir(ctx)
    fs.mkdirSync(dir, { recursive: true })
    await shell.openPath(dir)
  })
  handle('app:openExternal', one(z.string().url().max(2000)), async (url) => {
    if (!/^https:\/\//i.test(url)) throw new Error('Only https links can be opened.')
    await shell.openExternal(url)
  })

  // ----------------------------------------------------------- license
  handle('license:status', none, () => license.status())
  handle('license:activate', one(z.string().max(5000)), (key) => {
    const result = license.activate(key)
    if (!result.valid) {
      const messages = {
        format: 'This does not look like an AI Hub license key. Check that you copied all of it.',
        signature: 'This license key is not valid.',
        product: 'This license key is for a different product.',
        expired: 'This license key has expired.'
      }
      throw new ProviderError({ kind: 'invalid_license', message: messages[result.reason] })
    }
    ctx.logger.info('License activated', { id: result.payload.id })
    return license.status()
  })
  handle('license:deactivate', none, () => {
    license.deactivate()
    return license.status()
  })
  handle('license:skipDev', none, () => {
    if (!license.skipForDevelopment())
      throw new Error('Skipping activation is only allowed in development builds.')
    return license.status()
  })

  // ----------------------------------------------------------- providers
  handle('providers:list', none, () => ctx.registry.listInfo(storage.settings.get().providerConfig))
  handle('providers:statuses', none, () => ai.statuses())
  handle('providers:saveKey', z.tuple([zProviderId, z.string().min(1).max(5000)]), (id, key) => {
    ai.saveKey(id, key)
    return ai.statuses()
  })
  handle('providers:deleteKey', one(zProviderId), (id) => {
    ai.deleteKey(id)
    return ai.statuses()
  })
  handle('providers:testKey', one(zProviderId), (id) => ai.testKey(id))
  handle('providers:setConfig', z.tuple([zProviderId, zConfig]), (id, config) => {
    ai.setConfig(id, config)
    return ai.statuses()
  })
  handle('providers:listModels', z.tuple([zProviderId, zCapability]), (id, cap) =>
    ai.listModels(id, cap as Capability)
  )
  handle('providers:listVoices', one(zProviderId), (id) => ai.listVoices(id))

  // ----------------------------------------------------------- chat
  handle('chat:start', z.tuple([zId, zChatRequest]), (requestId, req) => {
    // Fire and forget: streaming results arrive on 'chat:event'.
    void ai.startChat(requestId, req)
  })
  handle('chat:stop', one(zId), (requestId) => ai.stopChat(requestId))

  // ----------------------------------------------------------- conversations
  handle('conversations:list', none, () => storage.conversations.list())
  handle('conversations:search', one(z.string().max(500)), (q) => storage.conversations.search(q))
  handle('conversations:get', one(zId), (id) => storage.conversations.get(id) ?? null)
  handle('conversations:save', one(zConversation), (conv) => storage.conversations.save(conv))
  handle(
    'conversations:rename',
    z.tuple([zId, z.string().max(500)]),
    (id, title) => storage.conversations.rename(id, title) ?? null
  )
  handle('conversations:delete', one(zId), (id) => storage.conversations.delete(id))
  handle(
    'conversations:export',
    z.tuple([zId, z.enum(['markdown', 'json'])]),
    async (id, format) => {
      const conv = storage.conversations.get(id)
      if (!conv) throw new Error('Conversation not found.')
      const safe =
        conv.title
          .replace(/[^\w\- ]+/g, '')
          .trim()
          .slice(0, 60) || 'conversation'
      const ext = format === 'markdown' ? 'md' : 'json'
      const res = await dialog.showSaveDialog(win(), {
        defaultPath: path.join(app.getPath('documents'), `${safe}.${ext}`),
        filters: [{ name: format === 'markdown' ? 'Markdown' : 'JSON', extensions: [ext] }]
      })
      if (res.canceled || !res.filePath) return null
      await fs.promises.writeFile(
        res.filePath,
        format === 'markdown' ? conversationToMarkdown(conv) : conversationToJson(conv),
        'utf8'
      )
      return res.filePath
    }
  )

  // ----------------------------------------------------------- files
  handle(
    'files:saveText',
    z.tuple([z.string().max(300), z.string().max(20_000_000)]),
    async (name, content) => {
      const safeName = path.basename(name).replace(/[<>:"|?*]/g, '_') || 'code.txt'
      const codeDir = path.join(outputDir(ctx), 'code')
      fs.mkdirSync(codeDir, { recursive: true })
      const res = await dialog.showSaveDialog(win(), { defaultPath: path.join(codeDir, safeName) })
      if (res.canceled || !res.filePath) return null
      await fs.promises.writeFile(res.filePath, content, 'utf8')
      return res.filePath
    }
  )

  // ----------------------------------------------------------- images
  handle('images:generate', one(zImageRequest), (req) => ai.generateImages(req))
  handle('images:list', none, () => storage.images.all())
  handle('images:delete', one(zId), (id) => {
    const rec = storage.images.remove(id)
    if (rec?.filePath) {
      for (const f of [rec.filePath, `${rec.filePath}.json`]) if (fs.existsSync(f)) fs.unlinkSync(f)
    }
  })
  handle('images:copy', one(zId), async (id) => {
    const rec = storage.images.get(id)
    if (!rec || !fs.existsSync(rec.filePath)) throw new Error('Image file not found.')
    const png = nativeImage.createFromPath(rec.filePath).toPNG()
    await clipboard.write([
      new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })
    ])
  })
  handle('images:reveal', one(zId), (id) => {
    const rec = storage.images.get(id)
    if (rec && fs.existsSync(rec.filePath)) shell.showItemInFolder(rec.filePath)
    else throw new Error('Image file not found.')
  })
  handle('images:saveAs', one(zId), (id) => {
    const rec = storage.images.get(id)
    return saveCopy(rec?.filePath, rec ? path.basename(rec.filePath) : 'image.png')
  })

  // ----------------------------------------------------------- audio
  handle('audio:tts', one(zTtsRequest), (req) => ai.textToSpeech(req))
  handle('audio:list', none, () => storage.audio.all())
  handle('audio:delete', one(zId), (id) => {
    const rec = storage.audio.remove(id)
    if (rec?.filePath && fs.existsSync(rec.filePath)) fs.unlinkSync(rec.filePath)
  })
  handle('audio:saveAs', one(zId), (id) => {
    const rec = storage.audio.get(id)
    return saveCopy(rec?.filePath, rec ? path.basename(rec.filePath) : 'speech.mp3')
  })
  handle('audio:stt', one(zSttRequest), (req) => ai.speechToText(req))

  // ----------------------------------------------------------- video
  handle('video:submit', one(zVideoRequest), (req) => video.submit(req))
  handle('video:list', none, () => video.list())
  handle('video:cancel', one(zId), (id) => video.cancel(id) ?? null)
  handle('video:retry', one(zId), (id) => video.retryPolling(id) ?? null)
  handle('video:delete', one(zId), (id) => video.delete(id))
  handle('video:saveAs', one(zId), (id) => {
    const rec = storage.videos.get(id)
    return saveCopy(rec?.filePath, rec?.filePath ? path.basename(rec.filePath) : 'video.mp4')
  })
  handle('video:reveal', one(zId), (id) => {
    const rec = storage.videos.get(id)
    if (rec?.filePath && fs.existsSync(rec.filePath)) shell.showItemInFolder(rec.filePath)
    else throw new Error('Video file not found.')
  })

  // ----------------------------------------------------------- settings
  handle('settings:get', none, () => storage.settings.get())
  handle('settings:update', one(zSettingsPatch), (patch) =>
    storage.settings.update(patch as Partial<Settings>)
  )
  handle('settings:chooseOutputDir', none, async () => {
    const res = await dialog.showOpenDialog(win(), {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: outputDir(ctx)
    })
    if (res.canceled || !res.filePaths[0]) return null
    return storage.settings.update({ outputDir: res.filePaths[0] })
  })

  // ----------------------------------------------------------- usage & prompts
  handle('usage:get', none, () => storage.usage.get())
  handle('usage:reset', none, () => {
    storage.usage.reset()
    return storage.usage.get()
  })
  handle('prompts:list', none, () => storage.prompts.all())
  handle('prompts:save', one(zPrompt), (p) =>
    storage.prompts.upsert({ ...p, updatedAt: Date.now() })
  )
  handle('prompts:delete', one(zId), (id) => {
    storage.prompts.remove(id)
  })

  // ----------------------------------------------------------- backup
  // The passphrase is registered with the redactor while in use so it can never reach a
  // log line or an error message, and it is never stored.
  async function withSecret<T>(secret: string | undefined, fn: () => Promise<T>): Promise<T> {
    registerSecret(secret)
    try {
      return await fn()
    } finally {
      unregisterSecret(secret)
    }
  }

  const zPassphrase = z.string().max(1024).optional()

  handle(
    'backup:export',
    one(z.object({ includeKeys: z.boolean(), passphrase: zPassphrase })),
    ({ includeKeys, passphrase }) =>
      withSecret(passphrase, async () => {
        // Validate before showing the save dialog so the user gets the error immediately.
        if (includeKeys) assertPassphrase(passphrase)
        const stamp = new Date().toISOString().slice(0, 10)
        const res = await dialog.showSaveDialog(win(), {
          defaultPath: path.join(
            app.getPath('documents'),
            `ai-hub-backup-${stamp}${includeKeys ? '-with-keys' : ''}.json`
          ),
          filters: [{ name: 'AI Hub backup', extensions: ['json'] }]
        })
        if (res.canceled || !res.filePath) return null
        const backup = createBackup(storage, app.getVersion(), { includeKeys, passphrase })
        await fs.promises.writeFile(res.filePath, JSON.stringify(backup, null, 2), 'utf8')
        ctx.logger.info(`Backup exported (encrypted keys included: ${includeKeys})`)
        return { filePath: res.filePath, includedKeys: includeKeys }
      })
  )

  /** Backup chosen in the import dialog, waiting for the passphrase step. */
  let pendingImport: { fileName: string; backup: BackupFile } | undefined

  handle('backup:pickImport', none, async (): Promise<BackupImportPreview | null> => {
    const res = await dialog.showOpenDialog(win(), {
      properties: ['openFile'],
      filters: [{ name: 'AI Hub backup', extensions: ['json'] }]
    })
    if (res.canceled || !res.filePaths[0]) return null
    const text = await fs.promises.readFile(res.filePaths[0], 'utf8')
    const backup = parseBackup(text)
    pendingImport = { fileName: path.basename(res.filePaths[0]), backup }
    return { fileName: pendingImport.fileName, ...summarizeBackup(backup) }
  })
  handle(
    'backup:import',
    one(z.object({ passphrase: zPassphrase, skipKeys: z.boolean().optional() })),
    (opts) =>
      withSecret(opts.passphrase, async () => {
        if (!pendingImport) throw new Error('Choose a backup file first.')
        // On a wrong passphrase this throws before anything is written; the pending file is
        // kept so the user can try again.
        const result = restoreBackup(storage, pendingImport.backup, opts)
        pendingImport = undefined
        ctx.logger.info('Backup restored', result)
        return result
      })
  )
  handle('backup:cancelImport', none, () => {
    pendingImport = undefined
  })
}
