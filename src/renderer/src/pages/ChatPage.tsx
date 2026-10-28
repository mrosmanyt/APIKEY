import { useCallback, useEffect, useRef, useState } from 'react'
import { CODE_SYSTEM_PROMPT } from '@shared/defaults'
import { newId } from '@shared/ids'
import type { Attachment, ChatMessage, Conversation, ConversationMode } from '@shared/types'
import { Composer } from '../components/Composer'
import { EnhanceButton } from '../components/EnhanceButton'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { ProviderModelPicker } from '../components/ProviderModelPicker'
import { PromptPickerButton } from '../components/PromptPicker'
import { t } from '../i18n'
import { api, call } from '../lib/api'
import { startChatStream, stopChatStream } from '../lib/chatStream'
import { useModelInfo, useSelection, type Selection } from '../lib/selection'
import { SHORTCUT_EVENT, type ShortcutAction } from '../lib/shortcuts'
import { useApp } from '../lib/store'
import { ChatSettingsModal } from './chat/ChatSettingsModal'
import { CodePanel } from './chat/CodePanel'
import { ComparePanel } from './chat/ComparePanel'
import { MessageView } from './chat/MessageView'

function newConversation(
  mode: ConversationMode,
  sel: Selection | undefined,
  temperature: number,
  maxTokens: number
): Conversation {
  const now = Date.now()
  return {
    id: newId('c_'),
    title: t('chat.untitled'),
    mode,
    providerId: sel?.providerId ?? '',
    model: sel?.model ?? '',
    systemPrompt: mode === 'code' ? CODE_SYSTEM_PROMPT : '',
    temperature: mode === 'code' ? Math.min(temperature, 0.3) : temperature,
    maxTokens,
    messages: [],
    createdAt: now,
    updatedAt: now
  }
}

function titleFrom(text: string): string {
  const line = text.trim().split('\n')[0] ?? ''
  return line.length > 60 ? `${line.slice(0, 57)}…` : line || t('chat.untitled')
}

export function ChatPage({ mode }: { mode: ConversationMode }) {
  const settings = useApp((s) => s.settings)!
  const openId = useApp((s) => s.openConversation[mode])
  const openConversationIn = useApp((s) => s.openConversationIn)
  const pendingPrompt = useApp((s) => s.pendingPrompt)
  const applyPrompt = useApp((s) => s.applyPrompt)
  const [sel, setSel] = useSelection('chat', mode)
  const modelInfo = useModelInfo('chat', sel)
  const [conv, setConv] = useState<Conversation>(() =>
    newConversation(mode, sel, settings.chat.temperature, settings.chat.maxTokens)
  )
  const [requestId, setRequestId] = useState<string>()
  const [showSettings, setShowSettings] = useState(false)
  const [view, setView] = useState<'single' | 'compare'>('single')
  const [draft, setDraft] = useState('')
  const convRef = useRef(conv)
  convRef.current = conv
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  const persist = useCallback(async (c: Conversation) => {
    if (c.messages.length === 0) return
    const saved = await call(api().conversations.save(c))
    setConv((cur) => (cur.id === saved.id ? { ...cur, updatedAt: saved.updatedAt } : cur))
  }, [])

  // Open a conversation requested from History.
  useEffect(() => {
    if (!openId || openId === convRef.current.id) return
    void call(api().conversations.get(openId)).then((c) => {
      if (!c) return
      setConv(c)
      if (c.providerId) setSel({ providerId: c.providerId, model: c.model })
    })
  }, [openId, setSel])

  // Prefill from the prompt library.
  useEffect(() => {
    if (pendingPrompt?.page === mode) {
      setDraft(pendingPrompt.text)
      applyPrompt(undefined)
      setView('single')
    }
  }, [pendingPrompt, mode, applyPrompt])

  useEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [conv.messages])

  const updateMessage = (id: string, fn: (m: ChatMessage) => ChatMessage) =>
    setConv((c) => {
      const next = { ...c, messages: c.messages.map((m) => (m.id === id ? fn(m) : m)) }
      convRef.current = next
      return next
    })

  /** Send `history` (ending with a user message) and stream a new assistant reply. */
  const run = (base: Conversation) => {
    if (!sel?.model) return
    const assistant: ChatMessage = {
      id: newId('m_'),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      providerId: sel.providerId,
      model: sel.model
    }
    const history = base.messages.filter((m) => !(m.role === 'assistant' && !m.content))
    const next: Conversation = {
      ...base,
      providerId: sel.providerId,
      model: sel.model,
      messages: [...base.messages, assistant]
    }
    setConv(next)
    convRef.current = next
    stickToBottom.current = true
    const rid = startChatStream(
      {
        providerId: sel.providerId,
        model: sel.model,
        systemPrompt: base.systemPrompt,
        temperature: base.temperature,
        maxTokens: base.maxTokens,
        messages: history.map((m) => ({
          role: m.role,
          content: m.content,
          attachments: m.attachments
        }))
      },
      {
        onDelta: (text) =>
          updateMessage(assistant.id, (m) => ({ ...m, content: m.content + text })),
        onDone: (usage) => {
          updateMessage(assistant.id, (m) => ({ ...m, usage }))
          setRequestId(undefined)
          void persist(convRef.current)
        },
        onError: (error) => {
          updateMessage(assistant.id, (m) => ({ ...m, error }))
          setRequestId(undefined)
          void persist(convRef.current)
        }
      }
    )
    setRequestId(rid)
  }

  const send = (text: string, attachments: Attachment[]) => {
    const user: ChatMessage = {
      id: newId('m_'),
      role: 'user',
      content: text,
      attachments: attachments.length ? attachments : undefined,
      createdAt: Date.now()
    }
    const base = convRef.current
    const title =
      base.messages.length === 0 ? titleFrom(text || attachments[0]?.name || '') : base.title
    setDraft('')
    run({ ...base, title, messages: [...base.messages, user] })
  }

  const lastUserIndex = conv.messages.map((m) => m.role).lastIndexOf('user')
  const lastIndex = conv.messages.length - 1

  const regenerate = () => {
    const c = convRef.current
    const idx = c.messages.map((m) => m.role).lastIndexOf('user')
    if (idx >= 0) run({ ...c, messages: c.messages.slice(0, idx + 1) })
  }

  const editLast = (text: string) => {
    const c = convRef.current
    const idx = c.messages.map((m) => m.role).lastIndexOf('user')
    if (idx < 0) return
    const edited = { ...c.messages[idx], content: text }
    run({ ...c, messages: [...c.messages.slice(0, idx), edited] })
  }

  const startNew = () => {
    if (requestId) stopChatStream(requestId)
    setConv(newConversation(mode, sel, settings.chat.temperature, settings.chat.maxTokens))
    openConversationIn(mode, undefined)
    setDraft('')
  }

  // Keyboard shortcuts (dispatched by App). Code handles them only while visible; Chat handles
  // "new chat" from any other screen too (it navigates to Chat).
  const page = useApp((s) => s.page)
  const shortcutRef = useRef({ startNew, requestId, view, page })
  shortcutRef.current = { startNew, requestId, view, page }
  useEffect(() => {
    const onShortcut = (e: Event) => {
      const action = (e as CustomEvent<ShortcutAction>).detail
      const cur = shortcutRef.current
      const visible = cur.page === mode
      if (action.type === 'newChat') {
        if (mode === 'code' ? !visible : cur.page === 'code') return
        cur.startNew()
        setView('single')
      } else if (action.type === 'stop' && visible && cur.requestId) {
        stopChatStream(cur.requestId)
      } else if (action.type === 'focusInput' && visible && cur.view === 'single') {
        document.querySelectorAll<HTMLTextAreaElement>('textarea[data-composer]').forEach((el) => {
          if (el.offsetParent !== null) el.focus()
        })
      }
    }
    window.addEventListener(SHORTCUT_EVENT, onShortcut)
    return () => window.removeEventListener(SHORTCUT_EVENT, onShortcut)
  }, [mode])

  const allowImages = modelInfo?.vision !== false
  const busy = Boolean(requestId)
  const isCode = mode === 'code'

  return (
    <>
      <PageHeader title={isCode ? t('chat.codeTitle') : t('chat.title')}>
        {!isCode && (
          <div className="flex rounded-lg border border-slate-300 p-0.5 dark:border-slate-700">
            {(['single', 'compare'] as const).map((v) => (
              <button
                key={v}
                className={`rounded-md px-3 py-1 text-sm ${view === v ? 'bg-slate-200 font-medium dark:bg-slate-700' : ''}`}
                onClick={() => setView(v)}
              >
                {v === 'single' ? t('chat.single') : t('chat.compare')}
              </button>
            ))}
          </div>
        )}
        {view === 'single' && (
          <>
            <ProviderModelPicker capability="chat" value={sel} onChange={setSel} compact />
            <button
              className="btn-ghost"
              onClick={() => setShowSettings(true)}
              title={t('chat.settings')}
            >
              <Icon name="sliders" />
            </button>
            <button className="btn-secondary" onClick={startNew}>
              <Icon name="plus" />
              {t('chat.newChat')}
            </button>
          </>
        )}
      </PageHeader>

      {view === 'compare' && !isCode ? (
        <ComparePanel />
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <div
              ref={scrollRef}
              className="min-h-0 flex-1 overflow-y-auto px-4 py-6"
              onScroll={(e) => {
                const el = e.currentTarget
                stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
              }}
            >
              <div className="mx-auto flex max-w-4xl flex-col gap-5">
                {conv.messages.length === 0 && (
                  <div className="mt-20 text-center text-slate-500">
                    <Icon
                      name={isCode ? 'code' : 'chat'}
                      className="mx-auto mb-3 h-10 w-10 opacity-40"
                    />
                    <div className="text-lg font-medium">{t('chat.empty')}</div>
                    <div className="mt-1 text-sm">
                      {isCode ? t('chat.codeEmptyHint') : t('chat.emptyHint')}
                    </div>
                  </div>
                )}
                {conv.messages.map((m, i) => (
                  <MessageView
                    key={m.id}
                    message={m}
                    streaming={busy && i === lastIndex}
                    canRegenerate={!busy && i === lastIndex && m.role === 'assistant'}
                    canEdit={!busy && i === lastUserIndex}
                    onRegenerate={regenerate}
                    onEdit={editLast}
                  />
                ))}
              </div>
            </div>
            <Composer
              placeholder={isCode ? t('chat.codePlaceholder') : t('chat.placeholder')}
              busy={busy}
              allowImages={allowImages}
              onSend={send}
              onStop={() => requestId && stopChatStream(requestId)}
              value={draft}
              onValueChange={setDraft}
              contextWindow={modelInfo?.contextWindow}
              extraButtons={
                <>
                  <PromptPickerButton
                    modes={[mode, 'any']}
                    onPick={(text) => setDraft((d) => (d ? `${d}\n${text}` : text))}
                  />
                  {!isCode && (
                    <EnhanceButton
                      target="chat"
                      value={draft}
                      onChange={setDraft}
                      selection={sel}
                      compact
                    />
                  )}
                </>
              }
            />
          </div>
          {isCode && <CodePanel messages={conv.messages} />}
        </div>
      )}

      {showSettings && (
        <ChatSettingsModal
          value={{
            systemPrompt: conv.systemPrompt,
            temperature: conv.temperature,
            maxTokens: conv.maxTokens
          }}
          onClose={() => setShowSettings(false)}
          onSave={(v) => {
            const next = { ...convRef.current, ...v }
            setConv(next)
            void persist(next)
          }}
        />
      )}
    </>
  )
}
