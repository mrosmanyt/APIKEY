/**
 * Preload bridge. Runs sandboxed with contextIsolation; exposes a narrow, typed API
 * (`window.aihub`). The renderer gets no access to ipcRenderer, Node or Electron.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AiHubApi, InvokeChannel } from './api-types'
import type { ChatStreamEvent, VideoJob } from '../shared/types'

const invoke = (channel: InvokeChannel, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

function subscribe<T>(
  channel: 'chat:event' | 'video:update',
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
    saveText: (name, content) => invoke('files:saveText', name, content)
  },
  images: {
    generate: (req) => invoke('images:generate', req),
    list: () => invoke('images:list'),
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
  prompts: {
    list: () => invoke('prompts:list'),
    save: (p) => invoke('prompts:save', p),
    delete: (id) => invoke('prompts:delete', id)
  },
  backup: {
    export: (includeKeys) => invoke('backup:export', includeKeys),
    import: () => invoke('backup:import')
  }
}

contextBridge.exposeInMainWorld('aihub', api)
