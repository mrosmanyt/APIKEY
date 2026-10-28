import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppErrorInfo, GeneratedImage, ImageModelInfo, ProviderInfo } from '@shared/types'
import { BetaBadge } from '../components/BetaBadge'
import { EnhanceButton } from '../components/EnhanceButton'
import { ErrorBox } from '../components/ErrorBox'
import { Modal } from '../components/Modal'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { PromptPickerButton } from '../components/PromptPicker'
import { ProviderModelPicker } from '../components/ProviderModelPicker'
import { t, tDynamic } from '../i18n'
import { api, call, errorInfo } from '../lib/api'
import { formatTime, mediaUrl, readAsBase64 } from '../lib/files'
import { useModelInfo, useSelection } from '../lib/selection'
import { usableProviders, useApp } from '../lib/store'

type Reference =
  | { kind: 'gallery'; image: GeneratedImage }
  | { kind: 'upload'; name: string; mime: string; base64: string }

type Tool = { kind: 'upscale' | 'vary'; image: GeneratedImage }

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
  const [reference, setReference] = useState<Reference>()
  const [strength, setStrength] = useState(0.6)
  const [tool, setTool] = useState<Tool>()
  const [toolBusy, setToolBusy] = useState<string>()
  const uploadRef = useRef<HTMLInputElement>(null)
  const statuses = useApp((s) => s.statuses)
  const imageProviders = usableProviders({ providers, statuses }, 'image')
  const upscalers = imageProviders.filter((p) => p.capabilities.image?.canUpscale)
  const varyers = imageProviders.filter((p) => p.capabilities.image?.canVary)

  // Models refreshed from an API have no size metadata; fall back to the provider's first model's sizes.
  const provider = providers.find((p) => p.id === sel?.providerId)
  const fallback = provider?.capabilities.image?.models[0]
  const sizes = useMemo(() => model?.sizes ?? fallback?.sizes ?? [], [model, fallback])
  const maxCount = model?.maxCount ?? fallback?.maxCount ?? 1
  const supportsNegative = model?.supportsNegativePrompt ?? false
  const supportsReference = model?.supportsReference ?? false
  const referenceModels = (provider?.capabilities.image?.models ?? []).filter(
    (m) => m.supportsReference
  )

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
          count,
          ...(reference && supportsReference
            ? {
                reference:
                  reference.kind === 'gallery'
                    ? { imageId: reference.image.id }
                    : { base64: reference.base64, mime: reference.mime },
                strength
              }
            : {})
        })
      )
      setImages((cur) => [...out, ...cur])
    } catch (err) {
      setError(errorInfo(err))
    } finally {
      setBusy(false)
    }
  }

  const runTool = async (kind: Tool['kind'], image: GeneratedImage, provider: ProviderInfo) => {
    setTool(undefined)
    setToolBusy(image.id)
    try {
      const out =
        kind === 'upscale'
          ? [await call(api().images.upscale(image.id, provider.id))]
          : await call(api().images.vary(image.id, provider.id, 2))
      setImages((cur) => [...out, ...cur])
    } catch (err) {
      setError(errorInfo(err))
    } finally {
      setToolBusy(undefined)
    }
  }

  /** Run directly when only one provider can do it; otherwise let the user pick. */
  const startTool = (kind: Tool['kind'], image: GeneratedImage) => {
    const list = kind === 'upscale' ? upscalers : varyers
    if (list.length === 1) void runTool(kind, image, list[0])
    else setTool({ kind, image })
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
        <section className="space-y-4 overflow-y-auto border-b border-slate-200 p-4 dark:border-slate-800 lg:w-96 lg:shrink-0 lg:border-b-0 lg:border-e">
          <ProviderModelPicker capability="image" value={sel} onChange={setSel} />
          <div>
            <div className="flex items-center justify-between">
              <label className="label">{t('images.prompt')}</label>
              <div className="flex items-center gap-1">
                <EnhanceButton target="image" value={prompt} onChange={setPrompt} />
                <PromptPickerButton modes={['image']} onPick={setPrompt} />
              </div>
            </div>
            <textarea
              className="input min-h-[8rem]"
              placeholder={t('images.promptPlaceholder')}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>
          <div>
            <div className="mb-1 flex items-center gap-2">
              <label className="label mb-0">{t('images.reference')}</label>
              {model?.referenceBeta && <BetaBadge />}
            </div>
            <input
              ref={uploadRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (f)
                  setReference({
                    kind: 'upload',
                    name: f.name,
                    mime: f.type,
                    base64: await readAsBase64(f)
                  })
                e.target.value = ''
              }}
            />
            {reference ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <img
                    src={
                      reference.kind === 'gallery'
                        ? mediaUrl('image', reference.image.id)
                        : `data:${reference.mime};base64,${reference.base64}`
                    }
                    alt=""
                    className="h-14 w-14 rounded object-cover"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {reference.kind === 'gallery' ? reference.image.prompt : reference.name}
                  </span>
                  <button className="btn-ghost btn-sm" onClick={() => setReference(undefined)}>
                    {t('images.removeReference')}
                  </button>
                </div>
                {supportsReference ? (
                  <div>
                    <label className="label">
                      {t('images.strength')}: {strength.toFixed(2)}
                    </label>
                    <input
                      type="range"
                      min={0.05}
                      max={1}
                      step={0.05}
                      className="w-full"
                      value={strength}
                      onChange={(e) => setStrength(Number(e.target.value))}
                    />
                    <p className="text-xs text-slate-500">{t('images.strengthHint')}</p>
                  </div>
                ) : (
                  <p className="text-xs text-amber-600">
                    {referenceModels.length
                      ? t('images.referenceUnsupported', {
                          models: referenceModels.map((m) => m.name ?? m.id).join(', ')
                        })
                      : t('images.referenceUnsupportedProvider')}
                  </p>
                )}
              </div>
            ) : (
              <button className="btn-secondary btn-sm" onClick={() => uploadRef.current?.click()}>
                <Icon name="upload" className="h-3.5 w-3.5" />
                {t('images.uploadReference')}
              </button>
            )}
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
          {(busy || toolBusy) && (
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
                  {img.operation && img.operation !== 'generate' && (
                    <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {tDynamic(`images.op_${img.operation}`)}
                    </span>
                  )}
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
                      className="btn-ghost btn-sm"
                      title={t('images.useAsReference')}
                      data-action="use-reference"
                      onClick={() => setReference({ kind: 'gallery', image: img })}
                    >
                      <Icon name="layers" className="h-3.5 w-3.5" />
                    </button>
                    {upscalers.length > 0 && (
                      <button
                        className="btn-ghost btn-sm"
                        title={t('images.upscale')}
                        data-action="upscale"
                        disabled={toolBusy === img.id}
                        onClick={() => startTool('upscale', img)}
                      >
                        <Icon name="expand" className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {varyers.length > 0 && (
                      <button
                        className="btn-ghost btn-sm"
                        title={t('images.variations')}
                        data-action="vary"
                        disabled={toolBusy === img.id}
                        onClick={() => startTool('vary', img)}
                      >
                        <Icon name="columns" className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      className="btn-ghost btn-sm ms-auto text-red-600"
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
      {tool && (
        <Modal
          title={tool.kind === 'upscale' ? t('images.upscale') : t('images.variations')}
          onClose={() => setTool(undefined)}
        >
          <p className="mb-3 text-sm text-slate-500">{t('images.chooseToolProvider')}</p>
          <div className="space-y-2">
            {(tool.kind === 'upscale' ? upscalers : varyers).map((p) => (
              <button
                key={p.id}
                className="btn-secondary w-full justify-between"
                onClick={() => runTool(tool.kind, tool.image, p)}
              >
                <span>{p.name}</span>
                {tool.kind === 'upscale' && p.capabilities.image?.upscaleBeta && <BetaBadge />}
                {tool.kind === 'vary' && p.capabilities.image?.variationModel && (
                  <span className="text-xs text-slate-500">
                    {p.capabilities.image.variationModel}
                  </span>
                )}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  )
}
