/**
 * Fetches a page the account asked to add to its knowledge base and
 * reduces it to plain readable text.
 *
 * Deliberately dependency-free. A real DOM parser (cheerio/jsdom) buys
 * accuracy this use case doesn't need: the output is chunked and
 * embedded, so imperfect whitespace or a stray nav item costs a little
 * retrieval precision, never correctness. What it must get right — and
 * does — is dropping script/style content so executable text never ends
 * up quoted back to a customer as if it were business knowledge.
 *
 * The URL is user-supplied and fetched by this server, so it goes
 * through the same SSRF guard the custom-AI-provider base_url uses; see
 * that file for exactly how far that protection does and doesn't go
 * (notably: no DNS-rebinding protection).
 */

import { assertSafeAiBaseUrl } from './providers/ssrf-guard'
import { looksLikePdf, type PdfReadOptions } from './pdf-extract'

/** Pages beyond this are truncated rather than refused — a long page is
 *  usually long because of boilerplate, and the leading content is what
 *  carries the actual information. */
const MAX_TEXT_CHARS = 200_000
const FETCH_TIMEOUT_MS = 20_000

const BLOCK_ELEMENTS = /<\/(p|div|section|article|h[1-6]|li|tr|td|th|br|blockquote)>/gi

/** Named entities worth handling by hand — the numeric forms are covered
 *  generically below, and anything rarer degrades to literal text, which
 *  is acceptable in embedded reference material. */
const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&ldquo;': '“',
  '&rdquo;': '”',
  '&mdash;': '—',
  '&ndash;': '–',
  '&hellip;': '…',
}

export function htmlToText(html: string): string {
  // <head> holds the title, meta descriptions and inline JSON-LD — none
  // of it body prose, and leaving it in duplicated the page title into
  // the top of every synced entry (htmlTitle reads it separately).
  let out = html.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, ' ')

  // Anything whose *content* is not prose — scripts, styles, templates,
  // inline SVG — is removed wholesale, not just stripped of tags.
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  out = out.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  out = out.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
  out = out.replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, ' ')
  out = out.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
  out = out.replace(/<!--[\s\S]*?-->/g, ' ')

  // Chrome that's almost never the information someone wanted to teach
  // the bot, and that otherwise repeats on every synced page.
  out = out.replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, ' ')
  out = out.replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, ' ')
  out = out.replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, ' ')

  // Keep block structure as paragraph breaks — knowledge.ts chunks on
  // blank lines, so this is what gives the chunker something sane to cut
  // along instead of one undifferentiated wall of text.
  out = out.replace(BLOCK_ELEMENTS, '\n\n')
  out = out.replace(/<br\s*\/?>/gi, '\n')

  out = out.replace(/<[^>]+>/g, ' ')

  for (const [entity, char] of Object.entries(ENTITIES)) {
    out = out.split(entity).join(char)
  }
  out = out.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
  out = out.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))

  // Collapse runs of spaces/tabs, then runs of blank lines, without
  // flattening the paragraph breaks established above.
  out = out.replace(/[ \t ]+/g, ' ')
  out = out.replace(/\s*\n\s*/g, '\n')
  out = out.replace(/\n{3,}/g, '\n\n')

  return out.trim().slice(0, MAX_TEXT_CHARS)
}

/** Best-effort page title, for naming the knowledge entry when the user
 *  didn't type one. */
export function htmlTitle(html: string): string | null {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
  if (!match) return null
  const title = htmlToText(match[1])
  return title ? title.slice(0, 120) : null
}

/** A PDF has no <title>, so its filename is the only name in it —
 *  "KCS-ACT_1969.pdf" becomes "KCS ACT 1969", which is what somebody
 *  would have typed anyway. */
function filenameTitle(rawUrl: string): string | null {
  let path: string
  try {
    path = new URL(rawUrl).pathname
  } catch {
    path = rawUrl.split('?')[0]
  }
  const file = decodeURIComponent(path.split('/').filter(Boolean).pop() ?? '')
  const bare = file.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim()
  return bare ? bare.slice(0, 120) : null
}

export interface FetchedPage {
  url: string
  title: string | null
  text: string
}

export async function fetchPageText(
  rawUrl: string,
  opts: PdfReadOptions = {},
): Promise<FetchedPage> {
  // Same guard as the custom AI provider's base_url: this server makes
  // the request, so an unguarded URL is an SSRF hole into whatever the
  // VPS can reach.
  assertSafeAiBaseUrl(rawUrl)

  const res = await fetch(rawUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      // Some sites serve a JS-only shell or a 403 to an unidentified
      // client; a plain, honest UA gets the real HTML more often.
      'User-Agent': 'Mozilla/5.0 (compatible; WhatsAppCRM-KnowledgeSync/1.0)',
      Accept: 'text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.8',
    },
  })

  if (!res.ok) {
    throw new Error(`The page returned HTTP ${res.status}.`)
  }

  const contentType = res.headers.get('content-type') ?? ''

  // A PDF is not a web page, and reading one as text is not merely
  // useless — it is harmful. `res.text()` on a PDF returns the binary
  // container decoded as characters: a few thousand bytes of "%PDF-1.4",
  // stream markers and mojibake. It is not empty, so nothing below would
  // have rejected it, and the whole lot went into the knowledge base as
  // though it were the document. Found while adding a link to a
  // government Act, which is exactly the kind of URL somebody pastes.
  if (looksLikePdf(rawUrl, contentType)) {
    const { readPdf } = await import('./pdf-extract')
    const bytes = new Uint8Array(await res.arrayBuffer())
    const { text: pdfText } = await readPdf(bytes, { ...opts, label: rawUrl })
    return { url: rawUrl, title: filenameTitle(rawUrl), text: pdfText }
  }

  const body = await res.text()

  // A plain-text or markdown URL needs no stripping at all.
  const isHtml = contentType.includes('html') || /<\/?(html|body|div|p)\b/i.test(body.slice(0, 2000))
  const text = isHtml ? htmlToText(body) : body.slice(0, MAX_TEXT_CHARS).trim()

  if (!text) {
    throw new Error('No readable text found on that page — it may be rendered entirely by JavaScript.')
  }

  return { url: rawUrl, title: isHtml ? htmlTitle(body) : null, text }
}
