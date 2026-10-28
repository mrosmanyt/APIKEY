import { useEffect, useMemo, useState } from 'react'
import type { AppErrorInfo, GeneratedImage, ImageModelInfo } from '@shared/types'
import { ErrorBox } from '../components/ErrorBox'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { PromptPickerButton } from '../components/PromptPicker'
import { ProviderModelPicker } from '../components/ProviderModelPicker'
import { t } from '../i18n'
import { api, call, errorInfo } from '../lib/api'
import { formatTime, mediaUrl } from '../lib/files'
import { useModelInfo, useSelection } from '../lib/selection'
import { useApp } from '../lib/store'

export function ImagesPage() {
  const [sel, setSel] = useSelection('image', 'image')
  const model = useModelInfo('image', sel) as ImageModelInfo | undefined
  const providers = useApp((s) => s.providers)
  const showToast = useApp((s) => s.showToast)
  const pendingPrompt = useApp((s) => s.pendingPrompt)
  const applyPrompt = useApp((s) => s.applyPrompt)
  const [prompt, setPrompt] = useState('')
  const [negative, setNegative] = useState('')
  const [size, setSize] = useState('')
  const [count, setCount] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AppErrorInfo>()
  const [images, setImages] = useState<GeneratedImage[]>([])
  const [preview, setPreview] = useState<GeneratedImage>()

  // Models refreshed from an API have no size metadata; fall back to the provider's first model's sizes.
  const provider = providers.find((p) => p.id === sel?.providerId)
  const fallback = provider?.capabilities.image?.models[0]
  const sizes = useMemo(() => model?.sizes ?? fallback?.sizes ?? [], [model, fallback])
  const maxCount = model?.maxCount ?? fallback?.maxCount ?? 1
  const supportsNegative = model?.supportsNegativePrompt ?? false

  useEffect(() => {
    void call(api().images.list()).then(setImages)
  }, [])

  useEffect(() => {
    if (!sizes.includes(size)) setSize(sizes[0] ?? '')
    if (count > maxCount) setCount(maxCount)
  }, [sizes, size, count, maxCount])

  useEffect(() => {
    if (pendingPrompt?.page === 'images') {
      setPrompt(pendingPrompt.text)
      applyPrompt(undefined)
    }
  }, [pendingPrompt, applyPrompt])

  const generate = async () => {
    if (!sel?.model || !prompt.trim()) return
    setBusy(true)
    setError(undefined)
    try {
      const out = await call(
        api().images.generate({
          providerId: sel.providerId,
          model: sel.model,
          prompt,
          negativePrompt: supportsNegative && negative.trim() ? negative : undefined,
          size: size && size !== 'default' ? size : undefined,
          count
        })
      )
      setImages((cur) => [...out, ...cur])
    } catch (err) {
      setError(errorInfo(err))
    } finally {
      setBusy(false)
    }
  }

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn()
      if (ok) showToast(ok)
    } catch (err) {
      showToast(errorInfo(err).message, 'error')
    }
  }

  return (
    <>
      <PageHeader title={t('images.title')}>
        <button className="btn-secondary" onClick={() => void api().app.openOutputFolder()}>
          <Icon name="folder" />
          {t('common.openFolder')}
        </button>
      </PageHeader>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section className="space-y-4 overflow-y-auto border-b border-slate-200 p-4 dark:border-slate-800 lg:w-96 lg:shrink-0 lg:border-b-0 lg:border-r">
          <ProviderModelPicker capability="image" value={sel} onChange={setSel} />
          <div>
            <div className="flex items-center justify-between">
              <label className="label">{t('images.prompt')}</label>
              <PromptPickerButton modes={['image']} onPick={setPrompt} />
            </div>
            <textarea
              className="input min-h-[8rem]"
              placeholder={t('images.promptPlaceholder')}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>
          {supportsNegative && (
            <div>
              <label className="label">{t('images.negativePrompt')}</label>
              <textarea
                className="input min-h-[4rem]"
                placeholder={t('images.negativePlaceholder')}
                value={negative}
                onChange={(e) => setNegative(e.target.value)}
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('images.size')}</label>
              <select
                className="input"
                value={size}
                onChange={(e) => setSize(e.target.value)}
                disabled={sizes.length <= 1}
              >
                {sizes.map((s) => (
                  <option key={s} value={s}>
                    {s === 'default' ? t('video.providerDefault') : s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">{t('images.count')}</label>
              <select
                className="input"
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                disabled={maxCount <= 1}
              >
                {Array.from({ length: maxCount }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            className="btn-primary w-full"
            onClick={generate}
            disabled={busy || !sel?.model || !prompt.trim()}
          >
            <Icon name="image" />
            {busy ? t('images.generating') : t('images.generate')}
          </button>
          {error && <ErrorBox error={error} onDismiss={() => setError(undefined)} />}
        </section>

        <section className="min-h-0 flex-1 overflow-y-auto p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-500">{t('images.gallery')}</h2>
          {busy && (
            <div className="mb-4 flex h-24 animate-pulse items-center justify-center rounded-xl border-2 border-dashed border-brand-300 text-sm text-brand-600">
              {t('images.generating')}
            </div>
          )}
          {images.length === 0 && !busy && (
            <p className="py-16 text-center text-slate-500">{t('images.empty')}</p>
          )}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
            {images.map((img) => (
              <figure key={img.id} className="card group overflow-hidden">
                <button
                  className="block w-full bg-slate-100 dark:bg-slate-800"
                  onClick={() => setPreview(img)}
                >
                  <img
                    src={mediaUrl('image', img.id)}
                    alt={img.prompt}
                    className="aspect-square w-full object-cover"
                    loading="lazy"
                  />
                </button>
                <figcaption className="space-y-2 p-3">
                  <p className="line-clamp-2 text-sm" title={img.prompt}>
                    {img.prompt}
                  </p>
                  <p className="text-xs text-slate-500">
                    {img.model} {img.size ? `· ${img.size}` : ''} · {formatTime(img.createdAt)}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    <button
                      className="btn-ghost btn-sm"
                      title={t('images.copyImage')}
                      onClick={() =>
                        act(() => call(api().images.copy(img.id)), t('images.copiedImage'))
                      }
                    >
                      <Icon name="copy" className="h-3.5 w-3.5" />
                    </button>
                    <button
                      className="btn-ghost btn-sm"
                      title={t('images.reveal')}
                      onClick={() => act(() => call(api().images.reveal(img.id)))}
                    >
                      <Icon name="folder" className="h-3.5 w-3.5" />
                    </button>
                    <button
                      className="btn-ghost btn-sm"
                      title={t('common.saveAs')}
                      onClick={() =>
                        act(async () => {
                          const p = await call(api().images.saveAs(img.id))
                          if (p) showToast(t('common.savedTo', { path: p }))
                        })
                      }
                    >
                      <Icon name="download" className="h-3.5 w-3.5" />
                    </button>
                    <button
                      className="btn-ghost btn-sm"
                      title={t('images.reusePrompt')}
                      onClick={() => setPrompt(img.prompt)}
                    >
                      <Icon name="refresh" className="h-3.5 w-3.5" />
                    </button>
                    <button
                      className="btn-ghost btn-sm ml-auto text-red-600"
                      title={t('common.delete')}
                      onClick={() =>
                        act(async () => {
                          if (!window.confirm(t('common.confirmDelete'))) return
                          await call(api().images.delete(img.id))
                          setImages((cur) => cur.filter((x) => x.id !== img.id))
                        })
                      }
                    >
                      <Icon name="trash" className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      </div>

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setPreview(undefined)}
        >
          <div className="max-h-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
            <img
              src={mediaUrl('image', preview.id)}
              alt={preview.prompt}
              className="max-h-[80vh] rounded-lg object-contain"
            />
            <div className="mt-3 text-sm text-white">
              <p>{preview.prompt}</p>
              {preview.revisedPrompt && (
                <p className="mt-1 text-xs text-slate-300">
                  {t('images.revised')}: {preview.revisedPrompt}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
