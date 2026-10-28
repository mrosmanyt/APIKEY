import { useState } from 'react'
import type { AppErrorInfo } from '@shared/types'
import { t, tDynamic } from '../i18n'
import { useApp } from '../lib/store'
import { Icon } from './Icon'

const HINTS = new Set([
  'invalid_key',
  'quota',
  'rate_limit',
  'network',
  'model_not_found',
  'content_policy',
  'server',
  'not_configured'
])

/** Friendly error display with a "Details" toggle showing the raw (already redacted) error. */
export function ErrorBox({
  error,
  onDismiss,
  compact
}: {
  error: AppErrorInfo
  onDismiss?: () => void
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const navigate = useApp((s) => s.navigate)
  const showSettings = error.kind === 'invalid_key' || error.kind === 'not_configured'
  return (
    <div
      className={`rounded-lg border border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200 ${compact ? 'p-2 text-xs' : 'p-3 text-sm'}`}
      role="alert"
    >
      <div className="flex items-start gap-2">
        <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{tDynamic(`errors.${error.kind}`)}</div>
          <div className="mt-0.5 break-words">{error.message}</div>
          {HINTS.has(error.kind) && (
            <div className="mt-1 opacity-80">{tDynamic(`errors.hint_${error.kind}`)}</div>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {showSettings && (
              <button
                className="btn-secondary btn-sm"
                onClick={() => navigate('settings', { settingsTab: 'keys' })}
              >
                {t('common.goToSettings')}
              </button>
            )}
            {error.details && (
              <button className="btn-ghost btn-sm" onClick={() => setOpen(!open)}>
                {open ? t('common.hideDetails') : t('common.showDetails')}
              </button>
            )}
            {onDismiss && (
              <button className="btn-ghost btn-sm" onClick={onDismiss}>
                {t('common.close')}
              </button>
            )}
          </div>
          {open && error.details && (
            <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-red-100 p-2 font-mono text-[11px] dark:bg-red-950">
              {error.details}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
