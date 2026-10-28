import { useEffect, useRef, useState } from 'react'
import type { AppErrorInfo, AudioRecord } from '@shared/types'
import { CopyButton } from '../components/CopyButton'
import { ErrorBox } from '../components/ErrorBox'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { PromptPickerButton } from '../components/PromptPicker'
import { ProviderModelPicker } from '../components/ProviderModelPicker'
import { t } from '../i18n'
import { api, call, errorInfo } from '../lib/api'
import { formatTime, mediaUrl, readAsBase64 } from '../lib/files'
import { useSelection } from '../lib/selection'
import { useApp, voicesFor } from '../lib/store'

function TtsPanel() {
  const [sel, setSel] = useSelection('tts', 'tts')
  const providers = useApp((s) => s.providers)
  const settings = useApp((s) => s.settings)
  const setSettings = useApp((s) => s.setSettings)
  const showToast = useApp((s) => s.showToast)
  const pendingPrompt = useApp((s) => s.pendingPrompt)
  const applyPrompt = useApp((s) => s.applyPrompt)
  const provider = providers.find((p) => p.id === sel?.providerId)
  const voices = voicesFor(provider, settings)
  const [voice, setVoice] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AppErrorInfo>()
  const [items, setItems] = useState<AudioRecord[]>([])
  const [loadingVoices, setLoadingVoices] = useState(false)
  const [autoplayId, setAutoplayId] = useState<string>()

  useEffect(() => {
    void call(api().audio.list()).then(setItems)
  }, [])
  useEffect(() => {
    if (!voices.some((v) => v.id === voice)) setVoice(voices[0]?.id ?? '')
  }, [voices, voice])
  useEffect(() => {
    if (pendingPrompt?.page === 'audio') {
      setText(pendingPrompt.text)
      applyPrompt(undefined)
    }
  }, [pendingPrompt, applyPrompt])

  const speak = async () => {
    if (!sel?.model || !voice || !text.trim()) return
    setBusy(true)
    setError(undefined)
    try {
      const rec = await call(
        api().audio.tts({ providerId: sel.providerId, model: sel.model, voice, text })
      )
      setItems((cur) => [rec, ...cur])
      setAutoplayId(rec.id)
    } catch (err) {
      setError(errorInfo(err))
    } finally {
      setBusy(false)
    }
  }

  const loadVoices = async () => {
    if (!provider) return
    setLoadingVoices(true)
    try {
      const list = await call(api().providers.listVoices(provider.id))
      setSettings(await call(api().settings.get()))
      showToast(t('common.modelsRefreshed', { count: list.length }))
    } catch (err) {
      showToast(errorInfo(err).message, 'error')
    } finally {
      setLoadingVoices(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <section className="space-y-4 overflow-y-auto border-b border-slate-200 p-4 dark:border-slate-800 lg:w-[28rem] lg:shrink-0 lg:border-b-0 lg:border-r">
        <ProviderModelPicker capability="tts" value={sel} onChange={setSel} />
        <div>
          <label className="label">{t('audio.voice')}</label>
          <div className="flex gap-1">
            <select className="input" value={voice} onChange={(e) => setVoice(e.target.value)}>
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            {provider?.capabilities.tts?.canListVoices && (
              <button
                className="btn-ghost"
                onClick={loadVoices}
                disabled={loadingVoices}
                title={t('audio.refreshVoices')}
              >
                <Icon name="refresh" className={`h-4 w-4 ${loadingVoices ? 'animate-spin' : ''}`} />
              </button>
            )}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="label">{t('audio.text')}</label>
            <PromptPickerButton modes={['tts']} onPick={setText} />
          </div>
          <textarea
            className="input min-h-[12rem]"
            placeholder={t('audio.textPlaceholder')}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-1 text-right text-xs text-slate-500">
            {t('audio.chars', { count: text.length })}
          </div>
        </div>
        <button
          className="btn-primary w-full"
          onClick={speak}
          disabled={busy || !sel?.model || !voice || !text.trim()}
        >
          <Icon name="play" />
          {busy ? t('audio.generating') : t('audio.speak')}
        </button>
        {error && <ErrorBox error={error} onDismiss={() => setError(undefined)} />}
      </section>
      <section className="min-h-0 flex-1 overflow-y-auto p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-500">{t('audio.history')}</h2>
        {items.length === 0 && (
          <p className="py-16 text-center text-slate-500">{t('audio.emptyTts')}</p>
        )}
        <div className="space-y-3">
          {items.map((a) => (
            <div key={a.id} className="card space-y-2 p-3">
              <p className="line-clamp-2 text-sm">{a.text}</p>
              <p className="text-xs text-slate-500">
                {a.providerId} · {a.model} · {a.voice} · {formatTime(a.createdAt)}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <audio
                  controls
                  src={mediaUrl('audio', a.id)}
                  className="h-9 min-w-0 flex-1"
                  autoPlay={a.id === autoplayId}
                />
                <button
                  className="btn-secondary btn-sm"
                  onClick={async () => {
                    const p = await call(api().audio.saveAs(a.id))
                    if (p) showToast(t('common.savedTo', { path: p }))
                  }}
                >
                  <Icon name="download" className="h-3.5 w-3.5" />
                  {t('audio.saveMp3')}
                </button>
                <button
                  className="btn-ghost btn-sm text-red-600"
                  title={t('common.delete')}
                  onClick={async () => {
                    if (!window.confirm(t('common.confirmDelete'))) return
                    await call(api().audio.delete(a.id))
                    setItems((cur) => cur.filter((x) => x.id !== a.id))
                  }}
                >
                  <Icon name="trash" className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function SttPanel() {
  const [sel, setSel] = useSelection('stt', 'stt')
  const [file, setFile] = useState<{ name: string; blob: Blob }>()
  const [language, setLanguage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AppErrorInfo>()
  const [transcript, setTranscript] = useState('')
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const recorder = useRef<MediaRecorder>()
  const timer = useRef<number>()
  const fileRef = useRef<HTMLInputElement>(null)
  const previewUrl = useRef<string>()
  const [url, setUrl] = useState<string>()

  useEffect(() => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
    previewUrl.current = file ? URL.createObjectURL(file.blob) : undefined
    setUrl(previewUrl.current)
  }, [file])

  useEffect(
    () => () => {
      recorder.current?.stream.getTracks().forEach((tr) => tr.stop())
      window.clearInterval(timer.current)
    },
    []
  )

  const startRecording = async () => {
    setError(undefined)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      const rec = new MediaRecorder(stream, { mimeType: mime })
      const chunks: Blob[] = []
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      rec.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop())
        setFile({
          name: `recording-${Date.now()}.webm`,
          blob: new Blob(chunks, { type: 'audio/webm' })
        })
      }
      rec.start(250)
      recorder.current = rec
      setRecording(true)
      setSeconds(0)
      timer.current = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    } catch {
      setError({ kind: 'unsupported', message: t('audio.micDenied') })
    }
  }

  const stopRecording = () => {
    recorder.current?.stop()
    window.clearInterval(timer.current)
    setRecording(false)
  }

  const transcribe = async () => {
    if (!sel?.model || !file) {
      setError({ kind: 'bad_request', message: t('audio.noAudio') })
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const res = await call(
        api().audio.stt({
          providerId: sel.providerId,
          model: sel.model,
          audioBase64: await readAsBase64(file.blob),
          mime: file.blob.type.split(';')[0] || 'audio/mpeg',
          fileName: file.name,
          language: language.trim() || undefined
        })
      )
      setTranscript(res.text)
    } catch (err) {
      setError(errorInfo(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 overflow-y-auto p-4">
      <ProviderModelPicker capability="stt" value={sel} onChange={setSel} />
      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,video/mp4,video/webm"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) setFile({ name: f.name, blob: f })
              e.target.value = ''
            }}
          />
          <button
            className="btn-secondary"
            onClick={() => fileRef.current?.click()}
            disabled={recording}
          >
            <Icon name="upload" />
            {t('audio.upload')}
          </button>
          {recording ? (
            <button className="btn-danger" onClick={stopRecording}>
              <Icon name="stop" />
              {t('audio.stopRecording')}
            </button>
          ) : (
            <button className="btn-secondary" onClick={startRecording}>
              <Icon name="mic" />
              {t('audio.record')}
            </button>
          )}
          {recording && (
            <span className="flex items-center gap-2 text-sm text-red-600">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" />
              {t('audio.recording', { seconds })}
            </span>
          )}
        </div>
        {file && !recording && (
          <div className="space-y-2">
            <div className="text-sm text-slate-500">{t('audio.selected', { name: file.name })}</div>
            {url && <audio controls src={url} className="h-9 w-full" />}
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-56">
            <label className="label">{t('audio.language')}</label>
            <input
              className="input"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              maxLength={10}
            />
          </div>
          <button
            className="btn-primary"
            onClick={transcribe}
            disabled={busy || recording || !file || !sel?.model}
          >
            {busy ? t('audio.transcribing') : t('audio.transcribe')}
          </button>
        </div>
      </div>
      {error && <ErrorBox error={error} onDismiss={() => setError(undefined)} />}
      {transcript && (
        <div className="card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold">{t('audio.transcript')}</h3>
            <CopyButton text={transcript} />
          </div>
          <textarea
            className="input min-h-[12rem]"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
          />
        </div>
      )}
    </div>
  )
}

export function AudioPage() {
  const [tab, setTab] = useState<'tts' | 'stt'>('tts')
  return (
    <>
      <PageHeader title={t('audio.title')}>
        <div className="flex rounded-lg border border-slate-300 p-0.5 dark:border-slate-700">
          {(['tts', 'stt'] as const).map((v) => (
            <button
              key={v}
              className={`rounded-md px-3 py-1 text-sm ${tab === v ? 'bg-slate-200 font-medium dark:bg-slate-700' : ''}`}
              onClick={() => setTab(v)}
            >
              {v === 'tts' ? t('audio.tts') : t('audio.stt')}
            </button>
          ))}
        </div>
      </PageHeader>
      <div className={`min-h-0 flex-1 flex-col ${tab === 'tts' ? 'flex' : 'hidden'}`}>
        <TtsPanel />
      </div>
      <div className={`min-h-0 flex-1 flex-col ${tab === 'stt' ? 'flex' : 'hidden'}`}>
        <SttPanel />
      </div>
    </>
  )
}
