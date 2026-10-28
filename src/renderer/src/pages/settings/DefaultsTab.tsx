import type { AppMode, Capability } from '@shared/types'
import { ProviderModelPicker } from '../../components/ProviderModelPicker'
import { t, tDynamic } from '../../i18n'
import { useApp } from '../../lib/store'

const MODES: Array<{ mode: AppMode; capability: Capability }> = [
  { mode: 'chat', capability: 'chat' },
  { mode: 'code', capability: 'chat' },
  { mode: 'image', capability: 'image' },
  { mode: 'video', capability: 'video' },
  { mode: 'tts', capability: 'tts' },
  { mode: 'stt', capability: 'stt' }
]

export function DefaultsTab() {
  const settings = useApp((s) => s.settings)!
  const updateSettings = useApp((s) => s.updateSettings)
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">{t('settings.defaultsIntro')}</p>
      {MODES.map(({ mode, capability }) => (
        <div key={mode} className="card p-4">
          <h3 className="mb-2 font-semibold">{tDynamic(`settings.mode_${mode}`)}</h3>
          <ProviderModelPicker
            capability={capability}
            value={settings.defaults[mode]}
            onChange={(sel) =>
              void updateSettings({ defaults: { ...settings.defaults, [mode]: sel } })
            }
          />
        </div>
      ))}
    </div>
  )
}
