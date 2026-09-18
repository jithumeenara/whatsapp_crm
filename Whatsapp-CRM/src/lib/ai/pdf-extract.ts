/**
 * Reading a PDF, including one that is only pictures of words.
 *
 * ── Two kinds of PDF ────────────────────────────────────────────────
 *
 * A PDF made by exporting a document carries a text layer, and pdf.js
 * reads it in milliseconds for nothing. A PDF made by putting paper on a
 * scanner carries photographs of pages and no text at all — and the two
 * are indistinguishable until you try. Government circulars, the ones a
 * co-operative institute most needs its assistant to know, are very
 * often the second kind.
 *
 * Until now the second kind produced an empty extraction, and the upload
 * route turned that into "the text has to be typed or pasted in
 * instead". Honest, and useless against a 60-page Act.
 *
 * So the text layer is tried first, and when it comes back empty the
 * pages are handed to Gemini, which reads images natively. The order
 * matters and is not just about cost: the text layer is the *original*
 * characters, exact by construction, while OCR is a model's reading of a
 * picture and can misread a digit. Anything with real text keeps using
 * its real text.
 *
 * ── What OCR is allowed to do ───────────────────────────────────────
 *
 * Transcribe, and nothing else. The prompt says so in as many ways as it
 * can, because the failure that matters here is not a missed word — it
 * is a model that helpfully summarises a fee table, or fills in a figure
 * it cannot quite see. That text then enters the knowledge base as
 * though somebody had typed it, and the assistant will quote it to a
 * customer with a straight face. A short transcript with gaps marked is
 * worth far more than a fluent one that invented two numbers.
 *
 * Verified against ai.google.dev/gemini-api/docs/document-processing,
 * September 2026: a PDF goes inline as base64 with mime type
 * application/pdf, the whole request must stay under 20MB — so roughly
 * 15MB on disk, base64 being about a third larger — and a document may
 * not exceed 1,000 pages.
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import { recordAiUsage } from './usage'

/** Same cap the other extractors use. Past this a document is an
 *  archive rather than one reference text. */
const MAX_TEXT_CHARS = 200_000

/** Below this, a "successful" text-layer extraction is almost certainly
 *  a scan with a few stray characters — a page number, a header baked
 *  into the template — rather than a document. Worth trying OCR on. */
const TEXT_LAYER_FLOOR = 200

/** Google's documented inline ceiling is 20MB for the whole request and
 *  base64 inflates by about a third, so this is the honest disk-size
 *  limit. Larger files need the Files API, which is a bigger change than
 *  this is worth today. */
const MAX_OCR_BYTES = 14 * 1024 * 1024

/** OCR of a long scan is minutes of work for the model. Generous, and
 *  still bounded — an unbounded call here would hang an upload request
 *  with nothing to show for it. */
const OCR_TIMEOUT_MS = 180_000

/** Room for a long document to come back whole. A 60-page Act runs to
 *  tens of thousands of tokens, and a ceiling that truncates it produces
 *  a knowledge entry that stops mid-sentence. */
const OCR_MAX_TOKENS = 65_536

const OCR_PROMPT = [
  'Transcribe this document to plain text, exactly as it appears.',
  '',
  'Rules:',
  '- Output only the transcription. No preamble, no commentary, no summary.',
  '- Do not correct, rephrase, translate or shorten anything. Copy the words as written, in the language they are written in.',
  '- Keep the reading order, headings, numbered clauses and paragraph breaks.',
  '- Render a table as plain rows, one per line, columns separated by " | ".',
  '- If a word, figure or line is genuinely unreadable, write [unreadable] in its place. Never guess a number, a date, an amount or a name.',
  '- If a page is blank, write [blank page].',
  '',
  'The transcription will be quoted to customers as fact, so an honest gap is far better than a plausible invention.',
].join('\n')

export interface PdfReadOptions {
  /** Decrypted. Absent means no OCR is attempted — a scanned PDF then
   *  fails with the same clear message it always did. */
  geminiApiKey?: string | null
  /** The account's own model, so OCR is billed and behaves like every
   *  other call this account makes. */
  model?: string | null
  /** Named in errors and logs so "which file failed" is answerable. */
  label?: string
  /** When given, the OCR call is recorded in the Usage tab. Reading a
   *  60-page scan is one of the larger single charges an account can
   *  incur here, and a bill it cannot see is the thing the Usage tab
   *  exists to prevent. */
  accountId?: string | null
}

export interface PdfReadResult {
  text: string
  /** True when the words came from Gemini reading pictures rather than
   *  from the file's own text layer. Worth surfacing: it is the
   *  difference between exact characters and a careful reading. */
  ocrUsed: boolean
}

/** Collapses pdf.js's per-item line breaks without losing paragraphs —
 *  the chunker splits on blank lines, so those have to survive. */
export function normalizePdfText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/([^\n])\n(?!\n)/g, '$1 ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** The text layer alone. Empty for a scan, which is the signal the
 *  caller acts on rather than an error. */
export async function extractPdfTextLayer(bytes: Uint8Array): Promise<string> {
  // Lazy: keeps pdf.js out of every server bundle that never sees a PDF.
  const { extractText, getDocumentProxy } = await import('unpdf')
  let pdf
  try {
    pdf = await getDocumentProxy(bytes)
  } catch {
    throw new Error('That PDF could not be opened — it may be corrupted or password-protected.')
  }
  const { text } = await extractText(pdf, { mergePages: true })
  return normalizePdfText(text).slice(0, MAX_TEXT_CHARS)
}

/**
 * Hands the pages to Gemini and takes back what it reads.
 *
 * Throws rather than returning empty: every caller has already
 * established that the cheap path found nothing, so a silent empty
 * result here would become an empty knowledge entry.
 */
export async function ocrPdfWithGemini(
  bytes: Uint8Array,
  apiKey: string,
  model?: string | null,
  accountId?: string | null,
): Promise<string> {
  if (bytes.byteLength > MAX_OCR_BYTES) {
    throw new Error(
      `That scan is larger than ${Math.round(MAX_OCR_BYTES / 1024 / 1024)}MB, which is more than can be read in one request. Split it into parts and add them separately.`,
    )
  }

  const resolvedModel = model || 'gemini-3.6-flash'
  const genAI = new GoogleGenerativeAI(apiKey)
  const client = genAI.getGenerativeModel(
    {
      model: resolvedModel,
      generationConfig: { temperature: 0, maxOutputTokens: OCR_MAX_TOKENS },
    },
    { timeout: OCR_TIMEOUT_MS },
  )

  const startedAt = Date.now()
  const result = await client.generateContent({
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'application/pdf', data: Buffer.from(bytes).toString('base64') } },
          { text: OCR_PROMPT },
        ],
      },
    ],
  })

  if (accountId) {
    const usage = result.response.usageMetadata
    void recordAiUsage({
      accountId,
      provider: 'gemini',
      model: resolvedModel,
      feature: 'pdf_ocr',
      tokens: usage
        ? {
            inputTokens: usage.promptTokenCount ?? 0,
            outputTokens: usage.candidatesTokenCount ?? 0,
            totalTokens: usage.totalTokenCount ?? 0,
          }
        : undefined,
      latencyMs: Date.now() - startedAt,
    })
  }

  const text = (result.response.text() ?? '').trim()
  if (!text) {
    throw new Error('Nothing could be read from that scan — the pages may be blank or too faint.')
  }
  return normalizePdfText(text).slice(0, MAX_TEXT_CHARS)
}

/**
 * The whole job: text layer, then OCR, then an honest refusal.
 *
 * The refusal is deliberately different depending on why: "no Gemini key
 * is saved" is something the account can fix in a minute, and telling
 * them to retype a 60-page Act instead would be poor advice.
 */
export async function readPdf(bytes: Uint8Array, opts: PdfReadOptions = {}): Promise<PdfReadResult> {
  const layer = await extractPdfTextLayer(bytes)
  if (layer.length >= TEXT_LAYER_FLOOR) return { text: layer, ocrUsed: false }

  if (!opts.geminiApiKey) {
    throw new Error(
      layer
        ? 'Almost no text could be read from that PDF — the pages are probably scanned images. Save a Gemini key in Settings > AI and it can be read that way instead.'
        : 'No text could be read from that PDF — the pages are images, not text. Save a Gemini key in Settings > AI and it can be read that way instead.',
    )
  }

  console.log(`[pdf] no text layer${opts.label ? ` in ${opts.label}` : ''} — reading the pages instead`)
  const ocr = await ocrPdfWithGemini(bytes, opts.geminiApiKey, opts.model, opts.accountId)

  // A scan that yields a handful of characters is a scan that failed,
  // not a short document. Better to say so than to store it.
  if (ocr.length < TEXT_LAYER_FLOOR && layer.length > ocr.length) {
    return { text: layer, ocrUsed: false }
  }
  return { text: ocr, ocrUsed: true }
}

/** Whether a URL or content type is pointing at a PDF. Both are checked
 *  because neither is reliable on its own: plenty of servers label a PDF
 *  application/octet-stream, and plenty of PDF URLs have no extension. */
export function looksLikePdf(url: string, contentType: string): boolean {
  if (contentType.toLowerCase().includes('application/pdf')) return true
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.pdf')
  } catch {
    return url.toLowerCase().split('?')[0].endsWith('.pdf')
  }
}
