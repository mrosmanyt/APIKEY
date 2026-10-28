import path from 'node:path'
import type { AudioRecord, GeneratedImage, SavedPrompt, VideoJob } from '@shared/types'
import { ConversationStore } from './conversations'
import { CollectionStore } from './jsonStore'
import { KeyStore, type Encryptor } from './keyStore'
import { SettingsStore } from './settings'
import { UsageStore } from './usage'

/** All persistent state, rooted at a data directory (Electron userData in production). */
export class Storage {
  readonly keys: KeyStore
  readonly settings: SettingsStore
  readonly conversations: ConversationStore
  readonly images: CollectionStore<GeneratedImage>
  readonly audio: CollectionStore<AudioRecord>
  readonly videos: CollectionStore<VideoJob>
  readonly prompts: CollectionStore<SavedPrompt>
  readonly usage: UsageStore

  constructor(
    readonly dataDir: string,
    encryptor: Encryptor
  ) {
    const p = (...parts: string[]) => path.join(dataDir, ...parts)
    this.keys = new KeyStore(p('keys.json'), encryptor)
    this.settings = new SettingsStore(p('settings.json'))
    this.conversations = new ConversationStore(p('conversations'))
    this.images = new CollectionStore<GeneratedImage>(p('images.json'))
    this.audio = new CollectionStore<AudioRecord>(p('audio.json'))
    this.videos = new CollectionStore<VideoJob>(p('videos.json'))
    this.prompts = new CollectionStore<SavedPrompt>(p('prompts.json'))
    this.usage = new UsageStore(p('usage.json'))
  }
}

export { KeyStore, type Encryptor } from './keyStore'
