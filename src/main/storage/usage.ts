import { monthKey } from '@shared/pricing'
import type { MonthlyUsage, ProviderUsage, TokenUsage, UsageStats } from '@shared/types'
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

/**
 * All-time totals per provider (usage.json) plus per-month, per-model token counts
 * (usage-monthly.json) used for cost estimates. Costs are computed from the price table at
 * display time, so editing a price updates past months too.
 */
export class UsageStore {
  private readonly store: JsonStore<UsageStats>
  private readonly monthlyStore: JsonStore<MonthlyUsage>

  constructor(filePath: string, monthlyFilePath = filePath.replace(/\.json$/, '-monthly.json')) {
    this.store = new JsonStore<UsageStats>(filePath, () => ({}))
    this.monthlyStore = new JsonStore<MonthlyUsage>(monthlyFilePath, () => ({}))
  }

  get(): UsageStats {
    return this.store.read()
  }

  monthly(): MonthlyUsage {
    return this.monthlyStore.read()
  }

  record(
    providerId: string,
    kind: UsageKind,
    opts: { usage?: TokenUsage; images?: number; error?: boolean; model?: string; now?: Date } = {}
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
    if (opts.model && !opts.error) {
      const month = monthKey(opts.now)
      this.monthlyStore.update((all) => {
        const months = { ...all }
        const providers = { ...(months[month] ?? {}) }
        const models = { ...(providers[providerId] ?? {}) }
        const m = models[opts.model!] ?? { requests: 0, inputTokens: 0, outputTokens: 0 }
        models[opts.model!] = {
          requests: m.requests + 1,
          inputTokens: m.inputTokens + (opts.usage?.inputTokens ?? 0),
          outputTokens: m.outputTokens + (opts.usage?.outputTokens ?? 0),
          ...(m.estimated || opts.usage?.estimated ? { estimated: true } : {})
        }
        providers[providerId] = models
        months[month] = providers
        return months
      })
    }
  }

  reset(): void {
    this.store.write({})
    this.monthlyStore.write({})
  }

  replace(stats: UsageStats, monthly?: MonthlyUsage): void {
    this.store.write(stats)
    if (monthly) this.monthlyStore.write(monthly)
  }
}
