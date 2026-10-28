import { ComingSoon } from '../components/ComingSoon'
import { t } from '../i18n'

export function ChatPage({ mode }: { mode: 'chat' | 'code' }) {
  return <ComingSoon title={mode === 'code' ? t('chat.codeTitle') : t('chat.title')} />
}
