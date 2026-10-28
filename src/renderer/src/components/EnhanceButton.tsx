import { useEffect, useState } from 'react'
import type { EnhanceRequest } from '@shared/types'
import { t } from '../i18n'
import { api, call, errorInfo } from '../lib/api'
import { useEnhancerModel } from '../lib/enhancer'
import type { Selection } from '../lib/selection'
import { useApp } from '../lib/store'
import { Icon } from './Icon'

export function EnhanceButton({
  target,
  value,
  onChange,
  selection,
  compact
}: {
  target: EnhanceRequest['target']
  value: string
  onChange: (text: string) => void
  /** Chat screen: use the chat model the user picked. */
  selection?: Selection
  compact?: boolean
}) {
  const sel = useEnhancerModel(selection)
  const showToast = useApp((s) => s.showToast)
  const [busy, setBusy] = useState(false)
  const [previous, setPrevious] = useState<string>()

  // Once the text is sent (cleared), there is nothing to undo.
  useEffect(() => {
    if (!value) setPrevious(undefined)
  }, [value])

  const run = async () => {
    if (!sel || !value.trim() || busy) return
    setBusy(true)
    try {
      const text = await call(api().prompt.enhance({ ...sel, prompt: value, target }))
      setPrevious(value)
      onChange(text)
    } catch (err) {
      showToast(errorInfo(err).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const title = sel ? t('enhance.tooltip', { model: sel.model }) : t('enhance.noModel')
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        className={compact ? 'btn-ghost' : 'btn-ghost btn-sm'}
        onClick={run}
        disabled={!sel || !value.trim() || busy}
        title={title}
        aria-label={t('enhance.button')}
        data-action="enhance"
      >
        <Icon name="wand" className={`h-4 w-4 ${busy ? 'animate-pulse' : ''}`} />
        {!compact && (busy ? t('enhance.working') : t('enhance.button'))}
      </button>
      {previous !== undefined && !busy && (
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => {
            onChange(previous)
            setPrevious(undefined)
          }}
          title={t('enhance.undo')}
        >
          {t('enhance.undo')}
        </button>
      )}
    </span>
  )
}
