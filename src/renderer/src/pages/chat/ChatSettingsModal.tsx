import { useState } from 'react'
import { Modal } from '../../components/Modal'
import { t } from '../../i18n'

export interface ChatParams {
  systemPrompt: string
  temperature: number
  maxTokens: number
}

export function ChatSettingsModal({
  value,
  onSave,
  onClose
}: {
  value: ChatParams
  onSave: (v: ChatParams) => void
  onClose: () => void
}) {
  const [v, setV] = useState(value)
  return (
    <Modal
      title={t('chat.settings')}
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="btn-primary"
            onClick={() => {
              onSave(v)
              onClose()
            }}
          >
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="label">{t('chat.systemPrompt')}</label>
          <textarea
            className="input min-h-[10rem] font-mono text-xs"
            placeholder={t('chat.systemPromptPlaceholder')}
            value={v.systemPrompt}
            onChange={(e) => setV({ ...v, systemPrompt: e.target.value })}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">
              {t('chat.temperature')}: {v.temperature.toFixed(1)}
            </label>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              className="w-full"
              value={v.temperature}
              onChange={(e) => setV({ ...v, temperature: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="label">{t('chat.maxTokens')}</label>
            <input
              type="number"
              min={1}
              className="input"
              value={v.maxTokens}
              onChange={(e) => setV({ ...v, maxTokens: Math.max(1, Number(e.target.value) || 1) })}
            />
          </div>
        </div>
      </div>
    </Modal>
  )
}
