/**
 * The pixel size of a PNG or JPEG, read from its header: no decoding, so an
 * image built to be enormous costs nothing to measure. Null when the header
 * is not one this can read (the caller then refuses the file).
 */
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

/** Big enough for any logo, small enough that a PDF writer decodes it in no time. */
export const MAX_LOGO_SIDE = 6000
export const MAX_LOGO_PIXELS = 16_000_000

export function logoDimensionsOk(d: { width: number; height: number } | null): boolean {
  return Boolean(
    d && d.width >= 1 && d.height >= 1 && d.width <= MAX_LOGO_SIDE && d.height <= MAX_LOGO_SIDE &&
      d.width * d.height <= MAX_LOGO_PIXELS,
  )
}
