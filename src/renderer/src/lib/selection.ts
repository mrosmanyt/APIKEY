import { useEffect, useMemo, useState } from 'react'
import type { AppMode, Capability, ModelInfo, ModeDefault } from '@shared/types'
import { modelsFor, usableProviders, useApp } from './store'

export type Selection = ModeDefault

/**
 * Keeps a provider/model selection for a capability. Starts from the user's default for the
 * mode, falls back to the first usable provider, and re-validates when keys change.
 */
export function useSelection(
  capability: Capability,
  mode: AppMode
): [Selection | undefined, (s: Selection) => void] {
  const providers = useApp((s) => s.providers)
  const statuses = useApp((s) => s.statuses)
  const settings = useApp((s) => s.settings)
  const [sel, setSel] = useState<Selection | undefined>()

  useEffect(() => {
    const usable = usableProviders({ providers, statuses }, capability)
    if (sel && usable.some((p) => p.id === sel.providerId)) return
    const def = settings?.defaults[mode]
    const defProvider = def && usable.find((p) => p.id === def.providerId)
    if (defProvider && def) {
      setSel(def)
      return
    }
    const first = usable[0]
    if (!first) {
      if (sel) setSel(undefined)
      return
    }
    const model = modelsFor(first, capability, settings)[0]?.id ?? ''
    setSel({ providerId: first.id, model })
  }, [providers, statuses, settings, capability, mode, sel])

  return [sel, setSel]
}

export function useModelInfo(
  capability: Capability,
  sel: Selection | undefined
): ModelInfo | undefined {
  const providers = useApp((s) => s.providers)
  const settings = useApp((s) => s.settings)
  return useMemo(() => {
    const p = providers.find((x) => x.id === sel?.providerId)
    return modelsFor(p, capability, settings).find((m) => m.id === sel?.model)
  }, [providers, settings, capability, sel])
}
