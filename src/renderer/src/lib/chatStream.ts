import { newId } from '@shared/ids'
import type { AppErrorInfo, ChatRequest, ChatStreamEvent, TokenUsage } from '@shared/types'
import { api } from './api'

export interface StreamHandlers {
  onDelta: (text: string) => void
  onDone: (usage?: TokenUsage, finishReason?: string) => void
  onError: (error: AppErrorInfo) => void
}

const handlers = new Map<string, StreamHandlers>()
let subscribed = false

function ensureSubscribed() {
  if (subscribed) return
  subscribed = true
  api().chat.onEvent((ev: ChatStreamEvent) => {
    const h = handlers.get(ev.requestId)
    if (!h) return
    if (ev.type === 'delta') h.onDelta(ev.text)
    else if (ev.type === 'done') {
      handlers.delete(ev.requestId)
      h.onDone(ev.usage, ev.finishReason)
    } else {
      handlers.delete(ev.requestId)
      h.onError(ev.error)
    }
  })
}

/** Start a streaming chat request in the main process. Returns the request id (for stop). */
export function startChatStream(req: ChatRequest, h: StreamHandlers): string {
  ensureSubscribed()
  const requestId = newId('req_')
  handlers.set(requestId, h)
  void api()
    .chat.start(requestId, req)
    .then((res) => {
      if (!res.ok) {
        handlers.delete(requestId)
        h.onError(res.error)
      }
    })
  return requestId
}

export function stopChatStream(requestId: string): void {
  void api().chat.stop(requestId)
}
