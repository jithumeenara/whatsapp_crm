import zlib from 'node:zlib'

/**
 * Checks for the logo image printed on report PDFs.
 *
 * Why this is strict: pdfkit decodes a PNG asynchronously, and a PNG whose
 * header is fine but whose data is corrupt makes it throw an exception nobody
 * can catch: a Node process that dies, or a request that never finishes. So an
 * image is never handed to the PDF writer until its structure has been checked
 * here, by inflating its data ourselves (bounded, inside a try) and comparing
 * the size it decodes to with what its header promises. A JPEG is embedded as
 * it is, never decoded, so its header is all that is read.
 */

/** The pixel size of a PNG or JPEG, from its header alone. Null when it cannot be read. */
export function imageDimensions(mime: string, bytes: Buffer): { width: number; height: number } | null {
  if (mime === 'image/png') {
    // 8-byte signature, then the IHDR chunk: length(4) 'IHDR' width(4) height(4).
    if (bytes.length < 24 || bytes.toString('ascii', 12, 16) !== 'IHDR') return null
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  }
  if (mime === 'image/jpeg') {
    let i = 2
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null
      let marker = bytes[i + 1]
      while (marker === 0xff && i + 2 < bytes.length) {
        i += 1
        marker = bytes[i + 1]
      }
      // Start-of-frame markers carry the size (not DHT 0xC4, JPG 0xC8, DAC 0xCC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: bytes.readUInt16BE(i + 7), height: bytes.readUInt16BE(i + 5) }
      }
      i += 2 + bytes.readUInt16BE(i + 2)
    }
    return null
  }
  return null
}

/** Big enough for any logo, small enough that decoding one costs nothing:
 *  4 million pixels is at most 16 MB of raw RGBA. */
export const MAX_LOGO_SIDE = 6000
export const MAX_LOGO_PIXELS = 4_000_000

export function logoDimensionsOk(d: { width: number; height: number } | null): boolean {
  return Boolean(
    d && d.width >= 1 && d.height >= 1 && d.width <= MAX_LOGO_SIDE && d.height <= MAX_LOGO_SIDE &&
      d.width * d.height <= MAX_LOGO_PIXELS,
  )
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
const DEPTHS: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }

/** Why a PNG cannot safely be embedded, or null when it can. */
function pngProblem(bytes: Buffer): string | null {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'That file is not a PNG image.'

  let pos = 8
  let ihdr: { w: number; h: number; depth: number; color: number; interlace: number } | null = null
  let hasPalette = false
  let sawEnd = false
  const idat: Buffer[] = []
  while (pos + 12 <= bytes.length) {
    const len = bytes.readUInt32BE(pos)
    const type = bytes.toString('ascii', pos + 4, pos + 8)
    if (len > bytes.length - pos - 12) return 'The PNG image is damaged (it is cut short).'
    const data = bytes.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      if (len !== 13 || ihdr) return 'The PNG image is damaged.'
      ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] }
    } else if (type === 'PLTE') hasPalette = true
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') {
      sawEnd = true
      break
    }
    pos += 12 + len
  }
  if (!ihdr || !sawEnd || idat.length === 0) return 'The PNG image is damaged (missing parts).'
  if (ihdr.interlace !== 0) return 'Save the logo as a PNG that is not interlaced, or as a JPEG.'
  if (!DEPTHS[ihdr.color]?.includes(ihdr.depth)) return 'The PNG image is damaged (an impossible colour format).'
  if (ihdr.color === 3 && !hasPalette) return 'The PNG image is damaged (no colour palette).'
  if (!logoDimensionsOk({ width: ihdr.w, height: ihdr.h })) return 'The logo is too large in pixels.'

  // What the data must decode to: one filter byte plus the row's pixels, per row.
  const rowBytes = Math.ceil((ihdr.w * CHANNELS[ihdr.color] * ihdr.depth) / 8) + 1
  const expected = rowBytes * ihdr.h
  try {
    // Bounded: a small file cannot be made to inflate into gigabytes.
    const out = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: expected + 1 })
    if (out.length !== expected) return 'The PNG image is damaged (its data does not match its size).'
    // Every scanline starts with a filter byte that must be 0 to 4. pdfkit
    // throws "Invalid filter algorithm" in a callback nobody can catch for
    // any other value (found in review, proven with a crafted RGBA PNG).
    for (let row = 0; row < ihdr.h; row++) {
      if (out[row * rowBytes] > 4) return 'The PNG image is damaged (a row has an impossible filter).'
    }
  } catch {
    return 'The PNG image is damaged (its data is corrupt).'
  }
  return null
}

/**
 * Why this logo cannot be used, in plain words, or null when it can: the
 * right kind of image, a size that is sensible, and (for PNG) data that
 * really decodes. Run before the file is stored and again before the PDF
 * writer is given it.
 */
export function imageProblem(mime: string, bytes: Buffer): string | null {
  if (mime === 'image/png') return pngProblem(bytes)
  if (mime === 'image/jpeg') {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 'That file is not a JPEG image.'
    const dims = imageDimensions(mime, bytes)
    if (!dims) return 'The JPEG image is damaged or its size cannot be read.'
    if (!logoDimensionsOk(dims)) return 'The logo is too large in pixels.'
    return null
  }
  return 'The logo must be a PNG or JPEG image.'
}
