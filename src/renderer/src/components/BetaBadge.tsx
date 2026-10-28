import { t } from '../i18n'

/** Small amber "Beta" pill for features whose provider API is not fully verified. */
export function BetaBadge({ label }: { label?: string }) {
  return (
    <span
      className="badge bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
      data-testid="beta-badge"
    >
      {label ? `${label}: ` : ''}
      {t('common.beta')}
    </span>
  )
}
