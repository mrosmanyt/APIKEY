/**
 * Generic asynchronous video job flow: submit -> poll status -> download result.
 * Works with any adapter that implements the `video` capability. Jobs survive restarts:
 * unfinished jobs are resumed on startup.
 */
import fs from 'node:fs'
import path from 'node:path'
import { newId } from '@shared/ids'
import type { VideoJob, VideoRequest } from '@shared/types'
import { ProviderError } from '../../providers/errors'
import type { AiService } from './ai'
import { extForMime, mediaDir, type AppContext } from './context'

const POLL_MS = 5_000
const MAX_POLL_MS = 15_000
const TIMEOUT_MS = 60 * 60 * 1000

export class VideoService {
  private readonly timers = new Map<string, NodeJS.Timeout>()

  constructor(
    private readonly app: AppContext,
    private readonly ai: AiService,
    private readonly pollMs = POLL_MS
  ) {}

  list(): VideoJob[] {
    return [...this.app.storage.videos.all()].sort((a, b) => b.createdAt - a.createdAt)
  }

  private update(id: string, changes: Partial<VideoJob>): VideoJob | undefined {
    const job = this.app.storage.videos.patch(id, { ...changes, updatedAt: Date.now() })
    if (job) this.app.emit('video:update', job)
    return job
  }

  async submit(req: VideoRequest): Promise<VideoJob> {
    const adapter = this.ai.adapter(req.providerId, 'video')
    const ctx = this.ai.providerContext(req.providerId)
    let providerJobId: string
    try {
      const res = await adapter.video!.submit(ctx, {
        model: req.model,
        prompt: req.prompt,
        size: req.size,
        durationSeconds: req.durationSeconds,
        image: req.imageBase64
          ? { data: Buffer.from(req.imageBase64, 'base64'), mime: req.imageMime ?? 'image/png' }
          : undefined
      })
      providerJobId = res.jobId
    } catch (err) {
      this.app.storage.usage.record(req.providerId, 'video', { error: true })
      throw new ProviderError({ ...this.ai.toError(err, req.providerId, 'video submit') })
    }
    this.app.storage.usage.record(req.providerId, 'video')
    const now = Date.now()
    const job: VideoJob = {
      id: newId('vid_'),
      providerId: req.providerId,
      model: req.model,
      prompt: req.prompt,
      size: req.size,
      durationSeconds: req.durationSeconds,
      hasImage: Boolean(req.imageBase64),
      status: 'queued',
      providerJobId,
      createdAt: now,
      updatedAt: now
    }
    this.app.storage.videos.upsert(job)
    this.app.logger.info(`Video job submitted ${job.id} (${req.providerId}/${req.model})`)
    this.schedule(job.id, this.pollMs)
    return job
  }

  /** Resume polling for unfinished jobs (call on startup). */
  resumePending(): void {
    for (const job of this.app.storage.videos.all()) {
      if (job.status === 'queued' || job.status === 'running') this.schedule(job.id, 1000)
    }
  }

  private schedule(id: string, delay: number): void {
    clearTimeout(this.timers.get(id))
    this.timers.set(
      id,
      setTimeout(() => {
        void this.pollOnce(id, delay)
      }, delay)
    )
  }

  /** One poll step. Exposed for tests. */
  async pollOnce(id: string, lastDelay = this.pollMs): Promise<VideoJob | undefined> {
    this.timers.delete(id)
    const job = this.app.storage.videos.get(id)
    if (!job || !job.providerJobId || (job.status !== 'queued' && job.status !== 'running'))
      return job

    if (Date.now() - (job.pollStartedAt ?? job.createdAt) > TIMEOUT_MS) {
      return this.update(id, {
        status: 'failed',
        error: {
          kind: 'server',
          message: 'Timed out waiting for the provider to finish the video.'
        }
      })
    }

    try {
      const adapter = this.ai.adapter(job.providerId, 'video')
      const ctx = this.ai.providerContext(job.providerId)
      const res = await adapter.video!.poll(ctx, job.providerJobId)
      if (res.status === 'completed') {
        this.update(id, { status: 'running', progress: 100, resultRef: res.resultRef })
        const out = await adapter.video!.download(ctx, job.providerJobId, res.resultRef)
        const filePath = path.join(mediaDir(this.app, 'videos'), `${id}.${extForMime(out.mime)}`)
        fs.writeFileSync(filePath, out.data)
        this.app.logger.info(`Video job completed ${id}`)
        return this.update(id, { status: 'completed', filePath, progress: 100 })
      }
      if (res.status === 'failed') {
        return this.update(id, {
          status: 'failed',
          error: {
            kind: 'server',
            message: res.error || 'The provider reported that the video failed.',
            providerId: job.providerId
          }
        })
      }
      const updated = this.update(id, { status: res.status, progress: res.progress })
      this.schedule(id, Math.min(MAX_POLL_MS, lastDelay + 1000))
      return updated
    } catch (err) {
      const error = this.ai.toError(err, job.providerId, 'video poll')
      if (error.kind === 'network' || error.kind === 'rate_limit' || error.kind === 'server') {
        // Transient: keep polling with a longer delay.
        this.schedule(id, MAX_POLL_MS)
        return this.update(id, { error })
      }
      return this.update(id, { status: 'failed', error })
    }
  }

  cancel(id: string): VideoJob | undefined {
    clearTimeout(this.timers.get(id))
    this.timers.delete(id)
    const job = this.app.storage.videos.get(id)
    if (job && (job.status === 'queued' || job.status === 'running'))
      return this.update(id, { status: 'cancelled' })
    return job
  }

  retryPolling(id: string): VideoJob | undefined {
    const job = this.app.storage.videos.get(id)
    if (!job || !job.providerJobId) return job
    const updated = this.update(id, {
      status: 'running',
      error: undefined,
      pollStartedAt: Date.now()
    })
    this.schedule(id, 500)
    return updated
  }

  delete(id: string): void {
    this.cancel(id)
    const job = this.app.storage.videos.remove(id)
    if (job?.filePath && fs.existsSync(job.filePath)) fs.unlinkSync(job.filePath)
  }

  stopAll(): void {
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
  }
}
