import type { Selection } from './selection'
import { modelsFor, usableProviders, useApp } from './store'

/**
 * Pick the chat model used to enhance prompts: the current chat selection (Chat screen), else
 * the "Prompt enhancer" default, else the Chat default, else the first usable chat model.
 */
export function useEnhancerModel(current?: Selection): Selection | undefined {
  const providers = useApp((s) => s.providers)
  const statuses = useApp((s) => s.statuses)
  const settings = useApp((s) => s.settings)
  const usable = usableProviders({ providers, statuses }, 'chat')
  const ok = (s?: Selection) => Boolean(s?.model && usable.some((p) => p.id === s.providerId))
  if (ok(current)) return current
  for (const d of [settings?.defaults.enhance, settings?.defaults.chat]) if (ok(d)) return d
  const first = usable[0]
  const model = first && modelsFor(first, 'chat', settings)[0]?.id
  return first && model ? { providerId: first.id, model } : undefined
}
