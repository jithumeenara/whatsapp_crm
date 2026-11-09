import { describe, expect, it } from 'vitest'
import { imageDimensions, logoDimensionsOk } from './image-size'

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
    expect(logoDimensionsOk({ width: 6000, height: 2666 })).toBe(true)
    expect(logoDimensionsOk({ width: 0, height: 10 })).toBe(false)
    expect(logoDimensionsOk({ width: 6001, height: 10 })).toBe(false)
    expect(logoDimensionsOk({ width: 5000, height: 5000 })).toBe(false) // 25 million pixels
    expect(logoDimensionsOk(null)).toBe(false)
  })
})
