import type { ProviderUsage, TokenUsage, UsageStats } from '@shared/types'
import { JsonStore } from './jsonStore'

export type UsageKind = 'chat' | 'image' | 'audio' | 'video' | 'test'

const empty = (): ProviderUsage => ({
  requests: 0,
  errors: 0,
  inputTokens: 0,
  outputTokens: 0,
  images: 0,
  audioRequests: 0,
  videoJobs: 0
})

export class UsageStore {
  private readonly store: JsonStore<UsageStats>

  constructor(filePath: string) {
    this.store = new JsonStore<UsageStats>(filePath, () => ({}))
  }

  get(): UsageStats {
    return this.store.read()
  }

  record(
    providerId: string,
    kind: UsageKind,
    opts: { usage?: TokenUsage; images?: number; error?: boolean } = {}
  ): void {
    this.store.update((all) => {
      const u = { ...empty(), ...(all[providerId] ?? {}) }
      u.requests += 1
      if (opts.error) u.errors += 1
      u.inputTokens += opts.usage?.inputTokens ?? 0
      u.outputTokens += opts.usage?.outputTokens ?? 0
      if (kind === 'image') u.images += opts.images ?? 0
      if (kind === 'audio') u.audioRequests += 1
      if (kind === 'video') u.videoJobs += 1
      u.lastUsedAt = Date.now()
      return { ...all, [providerId]: u }
    })
  }

  reset(): void {
    this.store.write({})
  }

  replace(stats: UsageStats): void {
    this.store.write(stats)
  }
}
