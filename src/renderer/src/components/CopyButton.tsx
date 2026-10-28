import { useState } from 'react'
import { t } from '../i18n'
import { Icon } from './Icon'

export function CopyButton({
  text,
  className = 'btn-ghost btn-sm',
  label = true
}: {
  text: string
  className?: string
  label?: boolean
}) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className={className}
      title={t('common.copy')}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} className="h-3.5 w-3.5" />
      {label && (copied ? t('common.copied') : t('common.copy'))}
    </button>
  )
}
