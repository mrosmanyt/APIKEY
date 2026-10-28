/**
 * aihub-media:// protocol: lets the renderer display generated images/audio/video without
 * giving it filesystem access. URLs look like aihub-media://image/<recordId>; only files
 * referenced by our own records can be served.
 */
import fs from 'node:fs'
import { protocol } from 'electron'
import type { Storage } from './storage'

export const MEDIA_SCHEME = 'aihub-media'

export function registerMediaSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

export function resolveMediaPath(
  storage: Storage,
  kind: string,
  id: string
): { path: string; mime: string } | undefined {
  const rec =
    kind === 'image'
      ? storage.images.get(id)
      : kind === 'audio'
        ? storage.audio.get(id)
        : kind === 'video'
          ? storage.videos.get(id)
          : undefined
  if (!rec?.filePath || !fs.existsSync(rec.filePath)) return undefined
  const mime = 'mime' in rec && rec.mime ? rec.mime : 'video/mp4'
  return { path: rec.filePath, mime }
}

export function handleMediaProtocol(storage: Storage): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const url = new URL(request.url)
    const id = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    const resolved = resolveMediaPath(storage, url.hostname, id)
    if (!resolved) return new Response('Not found', { status: 404 })

    const { size } = fs.statSync(resolved.path)
    const range = request.headers.get('range')
    const match = range ? /bytes=(\d*)-(\d*)/.exec(range) : null
    if (match) {
      const start = match[1] ? Number(match[1]) : 0
      const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
      if (start >= size || start > end) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
      }
      const buf = await readRange(resolved.path, start, end)
      return new Response(new Uint8Array(buf), {
        status: 206,
        headers: {
          'Content-Type': resolved.mime,
          'Content-Length': String(buf.length),
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes'
        }
      })
    }
    const data = await fs.promises.readFile(resolved.path)
    return new Response(new Uint8Array(data), {
      headers: {
        'Content-Type': resolved.mime,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes'
      }
    })
  })
}

async function readRange(file: string, start: number, end: number): Promise<Buffer> {
  const fh = await fs.promises.open(file, 'r')
  try {
    const length = end - start + 1
    const buf = Buffer.alloc(length)
    await fh.read(buf, 0, length, start)
    return buf
  } finally {
    await fh.close()
  }
}
