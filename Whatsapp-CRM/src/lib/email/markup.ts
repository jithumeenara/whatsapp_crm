/**
 * The light formatting the email composer writes, and what it becomes.
 *
 *   **bold**   *italic*   __underline__
 *   [our fees](https://example.com/fees)   a link with its own words
 *   https://example.com                    a bare address, linked as is
 *   - bullet item            (a line starting with "- " or "• ")
 *   1. numbered item         (a line starting with "1. ", "2) " …)
 *
 * Why a markup of our own rather than HTML from a rich-text editor: the
 * text is escaped first and only these few patterns are turned back into
 * tags, so nothing an agent pastes — and nothing a customer's reply could
 * smuggle into a draft — can become a script or a style in someone's
 * mail client. A link is only ever an http(s) address that parses as
 * one: never javascript:, data: or anything else a mail client might run.
 */

export type Inline = { text: string; b?: boolean; i?: boolean; u?: boolean; href?: string }

/** The address, normalised, if it is a plain web address — else null. */
export function safeLink(raw: string): string | null {
  if (raw.length > 2000) return null
  try {
    const u = new URL(raw)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}
export type Block =
  | { type: 'p'; lines: Inline[][] }
  | { type: 'ul'; items: Inline[][] }
  | { type: 'ol'; items: Inline[][] }

const BULLET = /^\s*(?:[-•*])\s+(.*)$/
const NUMBER = /^\s*\d{1,3}[.)]\s+(.*)$/

/** Splits one line into formatted runs. Markers must be closed on the
 *  same line; an unclosed one is left as typed. */
export function parseInline(line: string): Inline[] {
  const out: Inline[] = []
  // Links come first in the alternation, so the underscores and stars
  // inside an address are never read as formatting.
  const re =
    /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]{1,2000})\)|(https?:\/\/[^\s<>"']{1,2000})|\*\*(.+?)\*\*|__(.+?)__|\*(?!\s)(.+?)(?<!\s)\*/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    if (m.index > last) out.push({ text: line.slice(last, m.index) })
    if (m[1] !== undefined) {
      const href = safeLink(m[2])
      if (href) out.push(...parseInline(m[1]).map((r) => ({ ...r, href })))
      else out.push({ text: m[0] })
    } else if (m[3] !== undefined) {
      // "see https://x.com/fees." — the full stop is the sentence's.
      const address = m[3].replace(/[.,;:!?'")\]]+$/, '')
      const href = safeLink(address)
      out.push(href ? { text: address, href } : { text: address })
      if (address.length < m[3].length) out.push({ text: m[3].slice(address.length) })
    } else if (m[4] !== undefined) out.push(...parseInline(m[4]).map((r) => ({ ...r, b: true })))
    else if (m[5] !== undefined) out.push(...parseInline(m[5]).map((r) => ({ ...r, u: true })))
    else if (m[6] !== undefined) out.push(...parseInline(m[6]).map((r) => ({ ...r, i: true })))
    last = m.index + m[0].length
  }
  if (last < line.length) out.push({ text: line.slice(last) })
  return out.length ? out : [{ text: '' }]
}

export function parseMarkup(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  for (const line of lines) {
    const bullet = line.match(BULLET)
    const numbered = !bullet && line.match(NUMBER)
    const last = blocks[blocks.length - 1]
    if (bullet) {
      if (last?.type === 'ul') last.items.push(parseInline(bullet[1]))
      else blocks.push({ type: 'ul', items: [parseInline(bullet[1])] })
    } else if (numbered) {
      if (last?.type === 'ol') last.items.push(parseInline(numbered[1]))
      else blocks.push({ type: 'ol', items: [parseInline(numbered[1])] })
    } else if (last?.type === 'p') {
      last.lines.push(parseInline(line))
    } else {
      blocks.push({ type: 'p', lines: [parseInline(line)] })
    }
  }
  return blocks
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function inlineHtml(runs: Inline[]): string {
  return runs
    .map((r) => {
      let h = escapeHtml(r.text)
      if (r.u) h = `<u>${h}</u>`
      if (r.i) h = `<em>${h}</em>`
      if (r.b) h = `<strong>${h}</strong>`
      if (r.href) {
        h = `<a href="${escapeHtml(r.href)}" style="color:#0b57d0;text-decoration:underline" target="_blank" rel="noopener noreferrer">${h}</a>`
      }
      return h
    })
    .join('')
}

/** HTML for the email body — only p/br/strong/em/u/ul/ol/li and
 *  http(s) links, ever. */
export function markupToHtml(text: string): string {
  return parseMarkup(text)
    .map((b) => {
      if (b.type === 'p') return `<p style="margin:0 0 12px">${b.lines.map(inlineHtml).join('<br>')}</p>`
      const tag = b.type
      return `<${tag} style="margin:0 0 12px;padding-left:24px">${b.items.map((i) => `<li>${inlineHtml(i)}</li>`).join('')}</${tag}>`
    })
    .join('')
}

/** The plain-text version: markers removed, lists kept readable. */
export function markupToPlain(text: string): string {
  // A link with its own words keeps its address in brackets, so the
  // plain-text copy still gets them there.
  const plain = (runs: Inline[]) =>
    runs
      .map((r, i) => {
        const endsLink = r.href && r.text !== r.href && runs[i + 1]?.href !== r.href
        return endsLink ? `${r.text} (${r.href})` : r.text
      })
      .join('')
  return parseMarkup(text)
    .map((b) => {
      if (b.type === 'p') return b.lines.map(plain).join('\n')
      return b.items.map((i, n) => `${b.type === 'ol' ? `${n + 1}.` : '•'} ${plain(i)}`).join('\n')
    })
    .join('\n')
    .trim()
}
