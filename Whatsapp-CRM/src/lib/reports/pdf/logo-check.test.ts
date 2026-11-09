import zlib from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { pdfkitProblem } from './logo-check'

/**
 * The last gate before a picture reaches the PDF writer: pdfkit itself is asked
 * to read it, and whatever it throws (even a bare string) is a refusal. Found in
 * review: a PNG with a 200,000-byte text chunk, and a JPEG with fill bytes before
 * its frame header, passed every check of ours, made pdfkit throw in the middle
 * of building, and left the build hanging.
 */
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

function png(extra: Buffer[] = []): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(8, 0)
  ihdr.writeUInt32BE(8, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([SIG, chunk('IHDR', ihdr), ...extra, chunk('IDAT', zlib.deflateSync(Buffer.alloc((8 * 4 + 1) * 8))), chunk('IEND', Buffer.alloc(0))])
}

const SOF0 = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x10, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01])
const jpeg = (fill = 0) => Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(fill, 0xff), SOF0, Buffer.from([0xff, 0xd9])])

describe('pdfkitProblem', () => {
  it('accepts ordinary pictures', () => {
    expect(pdfkitProblem(png())).toBeNull()
    expect(pdfkitProblem(jpeg())).toBeNull()
  })

  it('refuses a PNG with a huge text chunk (it threw a RangeError inside the build)', () => {
    expect(pdfkitProblem(png([chunk('tEXt', Buffer.alloc(200_000, 0x41))]))).not.toBeNull()
  })

  it('refuses a JPEG with fill bytes before the frame header (it threw a bare string)', () => {
    expect(pdfkitProblem(jpeg(5))).not.toBeNull()
  })

  it('refuses anything that is not a picture, and never throws itself', () => {
    expect(pdfkitProblem(Buffer.from('not an image'))).not.toBeNull()
    expect(pdfkitProblem(Buffer.alloc(0))).not.toBeNull()
    expect(() => pdfkitProblem(Buffer.from([0xff, 0xd8, 0xff]))).not.toThrow()
  })
})
