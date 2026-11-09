import PDFDocument from 'pdfkit'

/**
 * The last gate before a picture reaches the PDF writer: pdfkit itself is asked
 * to read it. Whatever it throws, including a bare string such as "Invalid
 * JPEG.", means the picture cannot be used.
 *
 * Why it exists although image-size.ts already checks a picture: pdfkit's own
 * parsers fail on things ours accept (found in review): a PNG with a text chunk
 * over about 130 KB makes it throw a RangeError, and a JPEG with fill bytes
 * before its frame header makes it throw a string. Thrown in the middle of
 * building a PDF, either left the build hanging. Asked up front, it is just a
 * refusal. This reads the picture's structure only; it draws nothing.
 */
export function pdfkitProblem(bytes: Buffer): string | null {
  const doc = new PDFDocument({ autoFirstPage: false })
  try {
    // openImage exists in pdfkit but not in its typings.
    ;(doc as unknown as { openImage(src: Buffer): unknown }).openImage(bytes)
    return null
  } catch {
    return 'That picture cannot be used in a PDF. Save it again as a plain PNG or JPEG.'
  } finally {
    try {
      doc.end()
    } catch {
      // nothing was written; nothing to close
    }
  }
}
