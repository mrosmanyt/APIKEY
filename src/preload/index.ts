/**
 * Preload bridge. Runs sandboxed with contextIsolation; exposes a narrow, typed API
 * (`window.aihub`). The renderer gets no access to ipcRenderer, Node or Electron.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AiHubApi, EVENT_CHANNELS, InvokeChannel } from './api-types'
import type { BatchJob, WorkflowRun } from '../shared/automation'
import type { ChatStreamEvent, VideoJob } from '../shared/types'

const invoke = (channel: InvokeChannel, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

function subscribe<T>(
  channel: (typeof EVENT_CHANNELS)[number],
  cb: (payload: T) => void
): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: AiHubApi = {
  app: {
    info: () => invoke('app:info'),
    openLogsFolder: () => invoke('app:openLogsFolder'),
    openOutputFolder: () => invoke('app:openOutputFolder'),
    openExternal: (url) => invoke('app:openExternal', url)
  },
  license: {
    status: () => invoke('license:status'),
    activate: (key) => invoke('license:activate', key),
    deactivate: () => invoke('license:deactivate'),
    skipDev: () => invoke('license:skipDev')
  },
  providers: {
    list: () => invoke('providers:list'),
    statuses: () => invoke('providers:statuses'),
    saveKey: (id, key) => invoke('providers:saveKey', id, key),
    deleteKey: (id) => invoke('providers:deleteKey', id),
    testKey: (id) => invoke('providers:testKey', id),
    connect: (id) => invoke('providers:connect', id),
    setConfig: (id, config) => invoke('providers:setConfig', id, config),
    listModels: (id, capability) => invoke('providers:listModels', id, capability),
    listVoices: (id) => invoke('providers:listVoices', id)
  },
  chat: {
    start: (requestId, req) => invoke('chat:start', requestId, req),
    stop: (requestId) => invoke('chat:stop', requestId),
    onEvent: (cb) => subscribe<ChatStreamEvent>('chat:event', cb)
  },
  conversations: {
    list: () => invoke('conversations:list'),
    search: (q) => invoke('conversations:search', q),
    get: (id) => invoke('conversations:get', id),
    save: (conv) => invoke('conversations:save', conv),
    rename: (id, title) => invoke('conversations:rename', id, title),
    delete: (id) => invoke('conversations:delete', id),
    export: (id, format) => invoke('conversations:export', id, format)
  },
  files: {
    saveText: (name, content) => invoke('files:saveText', name, content),
    extract: (file) => invoke('files:extract', file)
  },
  images: {
    generate: (req) => invoke('images:generate', req),
    list: () => invoke('images:list'),
    upscale: (id, providerId) => invoke('images:upscale', id, providerId),
    vary: (id, providerId, count) => invoke('images:vary', id, providerId, count),
    delete: (id) => invoke('images:delete', id),
    copy: (id) => invoke('images:copy', id),
    reveal: (id) => invoke('images:reveal', id),
    saveAs: (id) => invoke('images:saveAs', id)
  },
  audio: {
    tts: (req) => invoke('audio:tts', req),
    list: () => invoke('audio:list'),
    delete: (id) => invoke('audio:delete', id),
    saveAs: (id) => invoke('audio:saveAs', id),
    stt: (req) => invoke('audio:stt', req)
  },
  video: {
    submit: (req) => invoke('video:submit', req),
    list: () => invoke('video:list'),
    cancel: (id) => invoke('video:cancel', id),
    retry: (id) => invoke('video:retry', id),
    delete: (id) => invoke('video:delete', id),
    saveAs: (id) => invoke('video:saveAs', id),
    reveal: (id) => invoke('video:reveal', id),
    onUpdate: (cb) => subscribe<VideoJob>('video:update', cb)
  },
  settings: {
    get: () => invoke('settings:get'),
    update: (patch) => invoke('settings:update', patch),
    chooseOutputDir: () => invoke('settings:chooseOutputDir')
  },
  usage: {
    get: () => invoke('usage:get'),
    reset: () => invoke('usage:reset')
  },
  prompt: {
    enhance: (req) => invoke('prompt:enhance', req)
  },
  prompts: {
    list: () => invoke('prompts:list'),
    save: (p) => invoke('prompts:save', p),
    delete: (id) => invoke('prompts:delete', id)
  },
  automation: {
    status: () => invoke('automation:status'),
    listWorkflows: () => invoke('automation:listWorkflows'),
    saveWorkflow: (w) => invoke('automation:saveWorkflow', w),
    deleteWorkflow: (id) => invoke('automation:deleteWorkflow', id),
    templates: () => invoke('automation:templates'),
    createFromTemplate: (id, defaults) => invoke('automation:createFromTemplate', id, defaults),
    preflight: (id) => invoke('automation:preflight', id),
    approve: (id, approvals) => invoke('automation:approve', id, approvals),
    revoke: (id, kind, target) => invoke('automation:revoke', id, kind, target),
    run: (id, input) => invoke('automation:run', id, input ?? null),
    cancelRun: (id) => invoke('automation:cancelRun', id),
    listRuns: (id) => invoke('automation:listRuns', id ?? null),
    clearRuns: () => invoke('automation:clearRuns'),
    retryRun: (id) => invoke('automation:retryRun', id),
    approveRun: (id) => invoke('automation:approveRun', id),
    listBatches: () => invoke('automation:listBatches'),
    startBatch: (opts) => invoke('automation:startBatch', opts),
    pauseBatch: (id) => invoke('automation:pauseBatch', id),
    resumeBatch: (id) => invoke('automation:resumeBatch', id),
    cancelBatch: (id) => invoke('automation:cancelBatch', id),
    deleteBatch: (id) => invoke('automation:deleteBatch', id),
    export: (ids) => invoke('automation:export', ids),
    import: () => invoke('automation:import'),
    webhookInfo: () => invoke('automation:webhookInfo'),
    regenerateToken: () => invoke('automation:regenerateToken'),
    pickPath: (kind, extensions) => invoke('automation:pickPath', kind, extensions ?? null),
    onRun: (cb) => subscribe<WorkflowRun>('automation:run', cb),
    onBatch: (cb) => subscribe<BatchJob>('automation:batch', cb),
    onChanged: (cb) => subscribe<null>('automation:changed', () => cb())
  },
  backup: {
    export: (includeKeys, passphrase) => invoke('backup:export', { includeKeys, passphrase }),
    pickImport: () => invoke('backup:pickImport'),
    import: (opts) => invoke('backup:import', opts),
    cancelImport: () => invoke('backup:cancelImport')
  }
}

contextBridge.exposeInMainWorld('aihub', api)
