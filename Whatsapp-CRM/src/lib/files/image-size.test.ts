import zlib from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { imageDimensions, imageProblem, logoDimensionsOk } from './image-size'

function png(w: number, h: number): Buffer {
  const b = Buffer.alloc(40)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8)
  b.write('IHDR', 12, 'ascii')
  b.writeUInt32BE(w, 16)
  b.writeUInt32BE(h, 20)
  return b
}

/** SOI, an APP0 segment, then a baseline start-of-frame carrying the size. */
function jpeg(w: number, h: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])
  const sof = Buffer.alloc(19)
  sof[0] = 0xff
  sof[1] = 0xc0
  sof.writeUInt16BE(17, 2)
  sof[4] = 8
  sof.writeUInt16BE(h, 5)
  sof.writeUInt16BE(w, 7)
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof])
}

describe('imageDimensions', () => {
  it('reads a PNG header', () => {
    expect(imageDimensions('image/png', png(640, 200))).toEqual({ width: 640, height: 200 })
  })

  it('reads a JPEG past its leading segments', () => {
    expect(imageDimensions('image/jpeg', jpeg(800, 300))).toEqual({ width: 800, height: 300 })
  })

  it('returns null for a header it cannot read, and for other types', () => {
    expect(imageDimensions('image/png', Buffer.from('not a png at all, just words here'))).toBeNull()
    expect(imageDimensions('image/jpeg', Buffer.from([0xff, 0xd8, 0x00, 0x00]))).toBeNull()
    expect(imageDimensions('image/gif', png(10, 10))).toBeNull()
  })
})

describe('logoDimensionsOk', () => {
  it('accepts an ordinary logo and refuses empty, huge or unreadable ones', () => {
    expect(logoDimensionsOk({ width: 600, height: 200 })).toBe(true)
    expect(logoDimensionsOk({ width: 2000, height: 2000 })).toBe(true) // 4 million pixels
    expect(logoDimensionsOk({ width: 0, height: 10 })).toBe(false)
    expect(logoDimensionsOk({ width: 6001, height: 10 })).toBe(false)
    expect(logoDimensionsOk({ width: 3000, height: 3000 })).toBe(false) // 9 million pixels
    expect(logoDimensionsOk(null)).toBe(false)
  })
})

/** A PNG chunk with a real CRC. */
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  let crc = 0xffffffff
  for (const b of body) {
    crc ^= b
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  const out = Buffer.alloc(4)
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
  return Buffer.concat([len, body, out])
}

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function realPng(w: number, h: number, o: { color?: number; depth?: number; interlace?: number; idat?: Buffer; plte?: boolean; iend?: boolean } = {}): Buffer {
  const { color = 6, depth = 8, interlace = 0, plte = color === 3, iend = true } = o
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = depth
  ihdr[9] = color
  ihdr[12] = interlace
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color]
  const rowBytes = Math.ceil((w * channels * depth) / 8) + 1
  const idat = o.idat ?? zlib.deflateSync(Buffer.alloc(rowBytes * h))
  return Buffer.concat([
    SIG,
    chunk('IHDR', ihdr),
    ...(plte ? [chunk('PLTE', Buffer.alloc(3 * (1 << Math.min(depth, 8))))] : []),
    chunk('IDAT', idat),
    ...(iend ? [chunk('IEND', Buffer.alloc(0))] : []),
  ])
}

describe('imageProblem: what a PDF writer must never be handed', () => {
  it('accepts real PNGs of the usual kinds', () => {
    expect(imageProblem('image/png', realPng(200, 80))).toBeNull()
    expect(imageProblem('image/png', realPng(64, 64, { color: 2 }))).toBeNull()
    expect(imageProblem('image/png', realPng(64, 64, { color: 3, depth: 8 }))).toBeNull()
    expect(imageProblem('image/png', realPng(64, 64, { color: 0, depth: 4 }))).toBeNull()
    expect(imageProblem('image/png', realPng(64, 64, { color: 4, depth: 16 }))).toBeNull()
  })

  it('accepts a JPEG with a readable header', () => {
    expect(imageProblem('image/jpeg', jpeg(800, 300))).toBeNull()
  })

  it('refuses a PNG whose header is fine and whose data is not (it crashed the PDF writer)', () => {
    expect(imageProblem('image/png', realPng(10, 10, { idat: Buffer.from('this is not zlib data at all') }))).toMatch(/damaged|corrupt/i)
  })

  it('refuses a PNG with no image data, no end, or a cut-off file', () => {
    const good = realPng(10, 10)
    expect(imageProblem('image/png', realPng(10, 10, { iend: false }))).not.toBeNull()
    expect(imageProblem('image/png', good.subarray(0, good.length - 20))).not.toBeNull()
    const noIdat = Buffer.concat([SIG, chunk('IHDR', good.subarray(16, 29)), chunk('IEND', Buffer.alloc(0))])
    expect(imageProblem('image/png', noIdat)).not.toBeNull()
  })

  it('refuses data that decodes to a different size than the header promises', () => {
    // Header says 100x100 RGBA; the data is for a 10x10 one.
    const ihdr = realPng(100, 100, { idat: zlib.deflateSync(Buffer.alloc((10 * 4 + 1) * 10)) })
    expect(imageProblem('image/png', ihdr)).not.toBeNull()
  })

  it('refuses a decompression bomb: a tiny file that claims a huge picture', () => {
    const bomb = realPng(2000, 2000, { idat: zlib.deflateSync(Buffer.alloc(20 * 1024 * 1024)) })
    expect(bomb.length).toBeLessThan(100 * 1024)
    expect(imageProblem('image/png', bomb)).not.toBeNull()
  })

  it('refuses a PNG with an impossible filter byte: it crashed the PDF writer even though its size was right', () => {
    // Found in review: every scanline starts with a filter byte that must be 0 to 4.
    // pdfkit throws "Invalid filter algorithm" in a callback nobody can catch.
    const withFilter = (color: number, depth: number, w: number, h: number, filter: number, row = 0) => {
      const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color]
      const rowBytes = Math.ceil((w * channels * depth) / 8) + 1
      const raw = Buffer.alloc(rowBytes * h)
      raw[row * rowBytes] = filter
      return realPng(w, h, { color, depth, idat: zlib.deflateSync(raw) })
    }
    for (const [color, depth] of [[6, 8], [2, 8], [3, 8], [4, 8], [0, 8]] as const) {
      expect(imageProblem('image/png', withFilter(color, depth, 10, 10, 9)), `colour ${color} first row`).toMatch(/damaged/i)
      expect(imageProblem('image/png', withFilter(color, depth, 10, 10, 5, 9)), `colour ${color} last row`).toMatch(/damaged/i)
      expect(imageProblem('image/png', withFilter(color, depth, 10, 10, 4)), `colour ${color} valid filter 4`).toBeNull()
    }
  })

  it('refuses an interlaced PNG, and a palette PNG with no palette', () => {
    expect(imageProblem('image/png', realPng(32, 32, { interlace: 1 }))).toMatch(/interlaced/i)
    expect(imageProblem('image/png', realPng(32, 32, { color: 3, plte: false }))).not.toBeNull()
  })

  it('refuses an impossible colour type or bit depth, and absurd dimensions', () => {
    // The colour type is byte 25 of the file and the bit depth byte 24.
    const badColour = realPng(10, 10)
    badColour[25] = 5
    expect(imageProblem('image/png', badColour)).not.toBeNull()
    const badDepth = realPng(10, 10, { color: 2 })
    badDepth[24] = 4
    expect(imageProblem('image/png', badDepth)).not.toBeNull()
    expect(imageProblem('image/png', realPng(20000, 20000, { idat: zlib.deflateSync(Buffer.alloc(10)) }))).not.toBeNull()
  })

  it('refuses text, other types and empty input', () => {
    expect(imageProblem('image/png', Buffer.from('<svg onload=alert(1)></svg>'))).not.toBeNull()
    expect(imageProblem('image/jpeg', Buffer.from('hello'))).not.toBeNull()
    expect(imageProblem('image/gif', realPng(10, 10))).not.toBeNull()
    expect(imageProblem('image/png', Buffer.alloc(0))).not.toBeNull()
  })
})
