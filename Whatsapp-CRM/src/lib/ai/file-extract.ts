/**
 * Pulls plain text out of an uploaded knowledge document.
 *
 * PDF goes through unpdf (a serverless-friendly wrapper over pdf.js,
 * imported lazily so the heavy parser is only loaded by a request that
 * actually uploads a PDF — the knowledge routes that never see one, and
 * every other route in the app, don't pay for it). Everything else is
 * read as UTF-8 text.
 *
 * Scanned PDFs are images with no text layer; there is no OCR here, and
 * the caller is told that in plain words rather than being handed an
 * empty entry that silently teaches the bot nothing.
 */

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

export async function extractFileText(file: File): Promise<string> {
  const ext = extensionOf(file.name)
  const type = file.type.toLowerCase()

  if (ext === '.pdf' || type === 'application/pdf') {
    // Lazy import: keeps pdf.js out of every other server bundle.
    const { extractText, getDocumentProxy } = await import('unpdf')
    const buffer = new Uint8Array(await file.arrayBuffer())
    let pdf
    try {
      pdf = await getDocumentProxy(buffer)
    } catch {
      throw new Error('That PDF could not be opened — it may be corrupted or password-protected.')
    }
    const { text } = await extractText(pdf, { mergePages: true })
    // pdf.js emits per-item text with hard line breaks mid-sentence;
    // collapsing single newlines while keeping blank lines preserves the
    // paragraph boundaries the chunker splits on.
    const normalized = text
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/([^\n])\n(?!\n)/g, '$1 ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    return normalized.slice(0, MAX_TEXT_CHARS)
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
