import fs from 'node:fs'
import path from 'node:path'
import type { Logger } from '../logger'
import type { Storage } from '../storage'
import type { ProviderRegistry } from '../../providers/registry'
import type { FetchLike } from '../../providers/types'

/** Dependencies shared by the main-process services. Constructed once in main/index.ts. */
export interface AppContext {
  storage: Storage
  registry: ProviderRegistry
  logger: Logger
  fetch: FetchLike
  /** Default output folder when the user has not chosen one. */
  defaultOutputDir: string
  /** Broadcast an event to all renderer windows. */
  emit: (channel: string, payload: unknown) => void
}

export type MediaKind = 'images' | 'audio' | 'videos' | 'code'

export function outputDir(ctx: AppContext): string {
  return ctx.storage.settings.get().outputDir || ctx.defaultOutputDir
}

export function mediaDir(ctx: AppContext, kind: MediaKind): string {
  const dir = path.join(outputDir(ctx), kind)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function extForMime(mime: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/webm': 'webm',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov'
  }
  return map[mime.toLowerCase()] ?? 'bin'
}
