/**
 * The light formatting the email composer writes, and what it becomes.
 *
 *   **bold**   *italic*   __underline__
 *   - bullet item            (a line starting with "- " or "• ")
 *   1. numbered item         (a line starting with "1. ", "2) " …)
 *
 * Why a markup of our own rather than HTML from a rich-text editor: the
 * text is escaped first and only these few patterns are turned back into
 * tags, so nothing an agent pastes — and nothing a customer's reply could
 * smuggle into a draft — can become a script, a style or a link in
 * someone's mail client. There is nothing to sanitise because nothing
 * but these tags is ever produced.
 */

export type Inline = { text: string; b?: boolean; i?: boolean; u?: boolean }
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
  const re = /\*\*(.+?)\*\*|__(.+?)__|\*(?!\s)(.+?)(?<!\s)\*/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    if (m.index > last) out.push({ text: line.slice(last, m.index) })
    if (m[1] !== undefined) out.push(...parseInline(m[1]).map((r) => ({ ...r, b: true })))
    else if (m[2] !== undefined) out.push(...parseInline(m[2]).map((r) => ({ ...r, u: true })))
    else if (m[3] !== undefined) out.push(...parseInline(m[3]).map((r) => ({ ...r, i: true })))
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
      return h
    })
    .join('')
}

/** HTML for the email body — only p/br/strong/em/u/ul/ol/li, ever. */
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
  const plain = (runs: Inline[]) => runs.map((r) => r.text).join('')
  return parseMarkup(text)
    .map((b) => {
      if (b.type === 'p') return b.lines.map(plain).join('\n')
      return b.items.map((i, n) => `${b.type === 'ol' ? `${n + 1}.` : '•'} ${plain(i)}`).join('\n')
    })
    .join('\n')
    .trim()
}
