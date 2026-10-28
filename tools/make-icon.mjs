// Generates the placeholder app icon (build/icon.png 512x512 and build/icon.ico 256x256)
// without any dependencies. Replace build/icon.png / build/icon.ico with your own artwork.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function render(size) {
  const px = Buffer.alloc(size * size * 4)
  const r = size * 0.22 // corner radius
  const inRounded = (x, y) => {
    const cx = Math.min(Math.max(x, r), size - r)
    const cy = Math.min(Math.max(y, r), size - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      if (!inRounded(x + 0.5, y + 0.5)) continue
      const t = (x + y) / (2 * size)
      // gradient brand blue (#3366ff) -> violet (#7c3aed)
      let R = Math.round(0x33 + (0x7c - 0x33) * t)
      let G = Math.round(0x66 + (0x3a - 0x66) * t)
      let B = Math.round(0xff + (0xed - 0xff) * t)
      // white "hub": a ring with 3 satellite dots
      const cx = size / 2,
        cy = size / 2
      const d = Math.hypot(x - cx, y - cy)
      const ring = Math.abs(d - size * 0.2) < size * 0.035
      const dots = [0, 1, 2].some((k) => {
        const a = -Math.PI / 2 + (k * 2 * Math.PI) / 3
        return (
          Math.hypot(x - (cx + Math.cos(a) * size * 0.33), y - (cy + Math.sin(a) * size * 0.33)) <
          size * 0.06
        )
      })
      const core = d < size * 0.08
      if (ring || dots || core) R = G = B = 255
      px[i] = R
      px[i + 1] = G
      px[i + 2] = B
      px[i + 3] = 255
    }
  }
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function ico(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  const entries = []
  let offset = 6 + 16 * pngs.length
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16)
    e[0] = size >= 256 ? 0 : size
    e[1] = size >= 256 ? 0 : size
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += data.length
    entries.push(e)
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)])
}

const out = path.resolve('build')
fs.mkdirSync(out, { recursive: true })
fs.writeFileSync(path.join(out, 'icon.png'), render(512))
fs.writeFileSync(
  path.join(out, 'icon.ico'),
  ico([16, 32, 48, 256].map((s) => ({ size: s, data: render(s) })))
)
console.log('Wrote build/icon.png and build/icon.ico')
