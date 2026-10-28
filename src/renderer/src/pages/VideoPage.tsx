import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppErrorInfo, VideoJob, VideoModelInfo } from '@shared/types'
import { BetaBadge } from '../components/BetaBadge'
import { EnhanceButton } from '../components/EnhanceButton'
import { ErrorBox } from '../components/ErrorBox'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { PromptPickerButton } from '../components/PromptPicker'
import { ProviderModelPicker } from '../components/ProviderModelPicker'
import { t, tDynamic } from '../i18n'
import { api, call, errorInfo } from '../lib/api'
import { formatTime, mediaUrl, readAsBase64 } from '../lib/files'
import { useModelInfo, useSelection } from '../lib/selection'
import { useApp } from '../lib/store'

const STATUS_CLS: Record<VideoJob['status'], string> = {
  queued: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  running: 'bg-brand-100 text-brand-800 dark:bg-brand-900/50 dark:text-brand-200',
  completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200',
  cancelled: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
}

export function VideoPage() {
  const [sel, setSel] = useSelection('video', 'video')
  const model = useModelInfo('video', sel) as VideoModelInfo | undefined
  const providers = useApp((s) => s.providers)
  const showToast = useApp((s) => s.showToast)
  const pendingPrompt = useApp((s) => s.pendingPrompt)
  const applyPrompt = useApp((s) => s.applyPrompt)
  const provider = providers.find((p) => p.id === sel?.providerId)
  const fallback = provider?.capabilities.video?.models[0]
  const sizes = useMemo(() => model?.sizes ?? fallback?.sizes ?? [], [model, fallback])
  const durations = useMemo(() => model?.durations ?? [], [model])
  const supportsImage = model?.supportsImageInput ?? fallback?.supportsImageInput ?? false
  const experimental = provider?.capabilities.video?.experimental
  const imageBeta = model?.imageInputBeta ?? fallback?.imageInputBeta ?? false

  const [prompt, setPrompt] = useState('')
  const [size, setSize] = useState('')
  const [duration, setDuration] = useState<number | ''>('')
  const [image, setImage] = useState<{ name: string; mime: string; base64: string }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AppErrorInfo>()
  const [jobs, setJobs] = useState<VideoJob[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void call(api().video.list()).then(setJobs)
    return api().video.onUpdate((job) =>
      setJobs((cur) =>
        cur.some((j) => j.id === job.id)
          ? cur.map((j) => (j.id === job.id ? job : j))
          : [job, ...cur]
      )
    )
  }, [])

  useEffect(() => {
    if (sizes.length && !sizes.includes(size)) setSize(sizes[0])
    if (!sizes.length && size) setSize('')
  }, [sizes, size])
  useEffect(() => {
    if (duration !== '' && !durations.includes(duration)) setDuration('')
  }, [durations, duration])
  useEffect(() => {
    if (pendingPrompt?.page === 'video') {
      setPrompt(pendingPrompt.text)
      applyPrompt(undefined)
    }
  }, [pendingPrompt, applyPrompt])

  const submit = async () => {
    if (!sel?.model || !prompt.trim()) return
    setBusy(true)
    setError(undefined)
    try {
      const job = await call(
        api().video.submit({
          providerId: sel.providerId,
          model: sel.model,
          prompt,
          size: size || undefined,
          durationSeconds: duration === '' ? undefined : duration,
          imageBase64: supportsImage ? image?.base64 : undefined,
          imageMime: supportsImage ? image?.mime : undefined
        })
      )
      setJobs((cur) => [job, ...cur.filter((j) => j.id !== job.id)])
    } catch (err) {
      setError(errorInfo(err))
    } finally {
      setBusy(false)
    }
  }

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch (err) {
      showToast(errorInfo(err).message, 'error')
    }
  }

  return (
    <>
      <PageHeader title={t('video.title')}>
        <button className="btn-secondary" onClick={() => void api().app.openOutputFolder()}>
          <Icon name="folder" />
          {t('common.openFolder')}
        </button>
      </PageHeader>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section className="space-y-4 overflow-y-auto border-b border-slate-200 p-4 dark:border-slate-800 lg:w-96 lg:shrink-0 lg:border-b-0 lg:border-e">
          <ProviderModelPicker capability="video" value={sel} onChange={setSel} />
          {experimental && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <BetaBadge /> {t('video.betaNote')}
            </div>
          )}
          <div>
            <div className="flex items-center justify-between">
              <label className="label">{t('video.prompt')}</label>
              <div className="flex items-center gap-1">
                <EnhanceButton target="video" value={prompt} onChange={setPrompt} />
                <PromptPickerButton modes={['video']} onPick={setPrompt} />
              </div>
            </div>
            <textarea
              className="input min-h-[8rem]"
              placeholder={t('video.promptPlaceholder')}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>
          {supportsImage && (
            <div>
              <div className="mb-1 flex items-center gap-2">
                <label className="label mb-0">{t('video.image')}</label>
                {(imageBeta || experimental) && <BetaBadge />}
              </div>
              {imageBeta && !experimental && (
                <p className="mb-2 text-xs text-amber-700 dark:text-amber-300">
                  {t('video.imageBetaNote')}
                </p>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  if (f) setImage({ name: f.name, mime: f.type, base64: await readAsBase64(f) })
                  e.target.value = ''
                }}
              />
              {image ? (
                <div className="flex items-center gap-2">
                  <img
                    src={`data:${image.mime};base64,${image.base64}`}
                    alt=""
                    className="h-14 w-14 rounded object-cover"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">{image.name}</span>
                  <button className="btn-ghost btn-sm" onClick={() => setImage(undefined)}>
                    {t('video.removeImage')}
                  </button>
                </div>
              ) : (
                <button className="btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>
                  <Icon name="image" className="h-3.5 w-3.5" />
                  {t('video.chooseImage')}
                </button>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('video.size')}</label>
              <select
                className="input"
                value={size}
                onChange={(e) => setSize(e.target.value)}
                disabled={!sizes.length}
              >
                {!sizes.length && <option value="">{t('video.providerDefault')}</option>}
                {sizes.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">{t('video.duration')}</label>
              <select
                className="input"
                value={duration}
                onChange={(e) => setDuration(e.target.value ? Number(e.target.value) : '')}
                disabled={!durations.length}
              >
                <option value="">{t('video.providerDefault')}</option>
                {durations.map((d) => (
                  <option key={d} value={d}>
                    {d}s
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            className="btn-primary w-full"
            onClick={submit}
            disabled={busy || !sel?.model || !prompt.trim()}
          >
            <Icon name="video" />
            {busy ? t('video.submitting') : t('video.submit')}
          </button>
          <p className="text-xs text-slate-500">{t('video.note')}</p>
          {error && <ErrorBox error={error} onDismiss={() => setError(undefined)} />}
        </section>

        <section className="min-h-0 flex-1 overflow-y-auto p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-500">{t('video.jobs')}</h2>
          {jobs.length === 0 && (
            <p className="py-16 text-center text-slate-500">{t('video.empty')}</p>
          )}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
            {jobs.map((job) => (
              <div key={job.id} className="card overflow-hidden">
                {job.status === 'completed' && job.filePath ? (
                  <video
                    controls
                    src={mediaUrl('video', job.id, job.updatedAt)}
                    className="aspect-video w-full bg-black"
                  />
                ) : (
                  <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 bg-slate-100 p-4 dark:bg-slate-800">
                    {(job.status === 'queued' || job.status === 'running') && (
                      <>
                        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
                        <div className="h-2 w-2/3 overflow-hidden rounded-full bg-slate-300 dark:bg-slate-700">
                          <div
                            className="h-full bg-brand-600 transition-all"
                            style={{ width: `${job.progress ?? 5}%` }}
                          />
                        </div>
                        {job.progress !== undefined && (
                          <span className="text-xs text-slate-500">
                            {Math.round(job.progress)}%
                          </span>
                        )}
                      </>
                    )}
                    {job.status === 'failed' && (
                      <Icon name="alert" className="h-8 w-8 text-red-500" />
                    )}
                    {job.status === 'cancelled' && (
                      <Icon name="stop" className="h-8 w-8 text-slate-400" />
                    )}
                  </div>
                )}
                <div className="space-y-2 p-3">
                  <div className="flex items-center gap-2">
                    <span className={`badge ${STATUS_CLS[job.status]}`}>
                      {tDynamic(`video.status_${job.status}`)}
                    </span>
                    <span className="truncate text-xs text-slate-500">
                      {job.model} {job.size ? `· ${job.size}` : ''} · {formatTime(job.createdAt)}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-sm" title={job.prompt}>
                    {job.prompt}
                  </p>
                  {job.error &&
                    (job.status === 'failed' ||
                      job.status === 'running' ||
                      job.status === 'queued') && <ErrorBox error={job.error} compact />}
                  <div className="flex flex-wrap gap-1">
                    {job.status === 'completed' && (
                      <>
                        <button
                          className="btn-secondary btn-sm"
                          onClick={() =>
                            act(async () => {
                              const p = await call(api().video.saveAs(job.id))
                              if (p) showToast(t('common.savedTo', { path: p }))
                            })
                          }
                        >
                          <Icon name="download" className="h-3.5 w-3.5" />
                          {t('common.saveAs')}
                        </button>
                        <button
                          className="btn-ghost btn-sm"
                          onClick={() => act(() => call(api().video.reveal(job.id)))}
                        >
                          <Icon name="folder" className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                    {(job.status === 'queued' || job.status === 'running') && (
                      <button
                        className="btn-ghost btn-sm"
                        onClick={() => act(() => call(api().video.cancel(job.id)))}
                      >
                        {t('video.cancel')}
                      </button>
                    )}
                    {(job.status === 'failed' || job.status === 'cancelled') &&
                      job.providerJobId && (
                        <button
                          className="btn-ghost btn-sm"
                          onClick={() => act(() => call(api().video.retry(job.id)))}
                        >
                          <Icon name="refresh" className="h-3.5 w-3.5" />
                          {t('video.retry')}
                        </button>
                      )}
                    <button
                      className="btn-ghost btn-sm"
                      onClick={() => setPrompt(job.prompt)}
                      title={t('images.reusePrompt')}
                    >
                      <Icon name="edit" className="h-3.5 w-3.5" />
                    </button>
                    <button
                      className="btn-ghost btn-sm ms-auto text-red-600"
                      title={t('common.delete')}
                      onClick={() =>
                        act(async () => {
                          if (!window.confirm(t('common.confirmDelete'))) return
                          await call(api().video.delete(job.id))
                          setJobs((cur) => cur.filter((j) => j.id !== job.id))
                        })
                      }
                    >
                      <Icon name="trash" className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  )
}
