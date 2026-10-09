/**
 * Shrinks a photo in the browser until WhatsApp will take it.
 *
 * WhatsApp refuses images over 5 MB, and a photo straight from a phone
 * camera is often 3–8 MB. The upload took it (the server allows 16 MB),
 * then Meta rejected the send, so a screenshot worked and a real photo
 * failed. Anything already small enough, and anything this cannot
 * redraw (GIF, HEIC in a browser without support), is returned as it was.
 */

/** Under Meta's 5 MB, with room for the multipart wrapper. */
export const WHATSAPP_IMAGE_MAX_BYTES = 4.8 * 1024 * 1024

const REDRAWABLE = new Set(['image/jpeg', 'image/png', 'image/webp'])

export async function shrinkImageForWhatsApp(file: File, maxBytes = WHATSAPP_IMAGE_MAX_BYTES): Promise<File> {
  if (file.size <= maxBytes || !REDRAWABLE.has(file.type)) return file
  if (typeof createImageBitmap !== 'function') return file

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file
  }

  // A long edge of 2560 px is sharper than WhatsApp shows anyway; quality
  // steps down only if that is still too heavy.
  const attempts: Array<{ edge: number; quality: number }> = [
    { edge: 2560, quality: 0.85 },
    { edge: 2048, quality: 0.8 },
    { edge: 1600, quality: 0.75 },
    { edge: 1280, quality: 0.7 },
  ]
  try {
    for (const { edge, quality } of attempts) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(bitmap.width * scale)
      canvas.height = Math.round(bitmap.height * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) return file
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
      if (blob && blob.size <= maxBytes) {
        const name = file.name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg'
        return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified })
      }
    }
  } finally {
    bitmap.close()
  }
  return file
}
