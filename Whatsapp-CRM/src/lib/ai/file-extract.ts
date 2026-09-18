/**
 * Pulls plain text out of an uploaded knowledge document.
 *
 * PDFs go to `./pdf-extract`, which tries the file's own text layer
 * first and, when there isn't one — a scan — reads the pages with
 * Gemini instead. Everything else is read as UTF-8 text.
 *
 * That split is deliberate: the text layer is the original characters
 * and is exact, while OCR is a model reading a picture. Anything with
 * real text keeps using its real text.
 */

import type { PdfReadOptions } from './pdf-extract'

export const SUPPORTED_UPLOAD_HINT = 'Supported: PDF, TXT, MD, CSV, JSON.'

const TEXT_EXTENSIONS = ['.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.log', '.html', '.htm']

/** Same cap the website extractor uses — chunking and embedding cost
 *  scale with this, and a document longer than it is almost always an
 *  archive rather than one reference text. */
const MAX_TEXT_CHARS = 200_000

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot).toLowerCase()
}

export async function extractFileText(file: File, opts: PdfReadOptions = {}): Promise<string> {
  const ext = extensionOf(file.name)
  const type = file.type.toLowerCase()

  if (ext === '.pdf' || type === 'application/pdf') {
    const { readPdf } = await import('./pdf-extract')
    const bytes = new Uint8Array(await file.arrayBuffer())
    const { text } = await readPdf(bytes, { ...opts, label: file.name })
    return text
  }

  if (ext === '.html' || ext === '.htm' || type === 'text/html') {
    const { htmlToText } = await import('./web-extract')
    return htmlToText(await file.text())
  }

  if (TEXT_EXTENSIONS.includes(ext) || type.startsWith('text/') || type === 'application/json') {
    return (await file.text()).slice(0, MAX_TEXT_CHARS)
  }

  // Word/Excel files are zip containers — reading them as text yields
  // binary noise, which would quietly poison the knowledge base. Refused
  // with a usable next step instead.
  if (ext === '.docx' || ext === '.doc' || ext === '.xlsx' || ext === '.xls' || ext === '.pptx') {
    throw new Error(`Office files aren't supported yet — export it as PDF first. ${SUPPORTED_UPLOAD_HINT}`)
  }

  throw new Error(`That file type isn't supported. ${SUPPORTED_UPLOAD_HINT}`)
}
