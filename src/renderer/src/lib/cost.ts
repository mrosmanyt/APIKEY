import { useMemo } from 'react'
import { costOf, findPrice, type Price } from '@shared/pricing'
import type { ModelInfo, ProviderInfo, Settings, TokenUsage } from '@shared/types'
import { modelsFor, useApp } from './store'

/** Model metadata (incl. provider-reported pricing) from built-in + refreshed lists. */
export function modelInfoFor(
  providers: ProviderInfo[],
  settings: Settings | undefined,
  providerId: string,
  model: string
): ModelInfo | undefined {
  const p = providers.find((x) => x.id === providerId)
  return modelsFor(p, 'chat', settings).find((m) => m.id === model)
}

export function priceFor(
  providers: ProviderInfo[],
  settings: Settings | undefined,
  providerId: string,
  model: string
): Price | undefined {
  return findPrice(
    settings?.prices ?? [],
    providerId,
    model,
    modelInfoFor(providers, settings, providerId, model)
  )
}

/** Estimated USD cost of one message, or undefined when the price is unknown. */
export function useMessageCost(
  providerId?: string,
  model?: string,
  usage?: TokenUsage
): number | undefined {
  const providers = useApp((s) => s.providers)
  const settings = useApp((s) => s.settings)
  return useMemo(() => {
    if (!providerId || !model || !usage) return undefined
    const price = priceFor(providers, settings, providerId, model)
    return price ? costOf(usage, price) : undefined
  }, [providers, settings, providerId, model, usage])
}
