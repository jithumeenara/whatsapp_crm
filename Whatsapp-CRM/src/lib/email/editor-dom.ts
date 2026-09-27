/**
 * The bridge between the email editor people see (real bold, real lists)
 * and the light markup the server turns into the email (lib/email/markup).
 *
 * The editor is a contentEditable box, so what it holds is whatever DOM
 * the browser chose to build — <b> in one browser, <strong> or a span
 * with font-weight in another, a <div> per line, <br> for an empty one.
 * `markupFromEditor` reads all of those into markup. Nothing from the DOM
 * travels further than that: the server never sees HTML, only the markup,
 * and builds the email's HTML itself from escaped text.
 *
 * `editorHtmlFromMarkup` goes the other way, for a saved draft, an AI
 * draft or a translation. It is built only from escaped text and a fixed
 * set of tags, so it is safe to place in the editor.
 */

import { escapeHtml, parseMarkup, safeLink, type Inline } from './markup'

// ── markup → editor ─────────────────────────────────────────────────────

function inlineToEditor(runs: Inline[]): string {
  return runs
    .map((r) => {
      let h = escapeHtml(r.text)
      if (r.u) h = `<u>${h}</u>`
      if (r.i) h = `<i>${h}</i>`
      if (r.b) h = `<b>${h}</b>`
      if (r.href) h = `<a href="${escapeHtml(r.href)}">${h}</a>`
      return h
    })
    .join('')
}

export function editorHtmlFromMarkup(markup: string): string {
  if (!markup.trim()) return ''
  return parseMarkup(markup)
    .map((b) => {
      if (b.type === 'p') {
        return b.lines
          .map((line) => {
            const html = inlineToEditor(line)
            return `<div>${html || '<br>'}</div>`
          })
          .join('')
      }
      return `<${b.type}>${b.items.map((i) => `<li>${inlineToEditor(i) || '<br>'}</li>`).join('')}</${b.type}>`
    })
    .join('')
}

// ── editor → markup ─────────────────────────────────────────────────────

interface Run {
  text: string
  b: boolean
  i: boolean
  u: boolean
  href: string | null
}

type Flags = Omit<Run, 'text'>

const BLOCK = new Set(['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE'])

function flagsOf(el: Element, parent: Flags): Flags {
  const tag = el.tagName
  const style = (el as HTMLElement).style
  const weight = style?.fontWeight ?? ''
  const decoration = `${style?.textDecoration ?? ''} ${style?.textDecorationLine ?? ''}`
  let href = parent.href
  if (tag === 'A') {
    const raw = el.getAttribute('href') ?? ''
    href = safeLink(raw) ?? parent.href
  }
  return {
    b: parent.b || tag === 'B' || tag === 'STRONG' || weight === 'bold' || Number(weight) >= 600,
    i: parent.i || tag === 'I' || tag === 'EM' || style?.fontStyle === 'italic',
    u: parent.u || tag === 'U' || decoration.includes('underline'),
    href,
  }
}

/** Markers only hold when they hug the words, so spaces go outside. */
function wrapRun(text: string, marker: string): string {
  const lead = text.match(/^\s*/)?.[0] ?? ''
  const trail = text.slice(lead.length).match(/\s*$/)?.[0] ?? ''
  const core = text.slice(lead.length, text.length - trail.length)
  return core ? `${lead}${marker}${core}${marker}${trail}` : text
}

function sameFlags(a: Run, b: Run): boolean {
  return a.b === b.b && a.i === b.i && a.u === b.u && a.href === b.href
}

export function runsToMarkup(runs: Run[]): string {
  // Neighbours with the same formatting are one run: "**a****b**" would
  // read back wrongly.
  const merged: Run[] = []
  for (const r of runs) {
    if (!r.text) continue
    const last = merged[merged.length - 1]
    if (last && sameFlags(last, r)) last.text += r.text
    else merged.push({ ...r })
  }

  const out: string[] = []
  for (let k = 0; k < merged.length; k++) {
    const r = merged[k]
    if (r.href) {
      // A whole link, which may hold differently formatted pieces.
      const pieces: Run[] = [r]
      while (merged[k + 1]?.href === r.href) pieces.push(merged[++k])
      const words = pieces.map((p) => styled(p)).join('')
      const plainWords = pieces.map((p) => p.text).join('').trim()
      out.push(plainWords === r.href ? r.href : `[${words.replace(/[[\]]/g, '')}](${r.href})`)
      continue
    }
    out.push(styled(r))
  }
  return out.join('')
}

function styled(r: Run): string {
  let t = r.text
  if (r.i) t = wrapRun(t, '*')
  if (r.u) t = wrapRun(t, '__')
  if (r.b) t = wrapRun(t, '**')
  return t
}

export function markupFromEditor(root: Node): string {
  const lines: string[] = []
  let current: Run[] = []
  const base: Flags = { b: false, i: false, u: false, href: null }

  const flush = () => {
    lines.push(runsToMarkup(current).replace(/\s+$/, ''))
    current = []
  }
  const hasContent = () => current.some((r) => r.text.length > 0)

  function inline(node: Node, flags: Flags, inList: boolean) {
    if (node.nodeType === 3) {
      const text = (node.nodeValue ?? '').replace(/ /g, ' ').replace(/​/g, '')
      const parts = text.split('\n')
      parts.forEach((part, n) => {
        if (n > 0) {
          if (inList) current.push({ text: ' ', ...flags })
          else flush()
        }
        if (part) current.push({ text: part, ...flags })
      })
      return
    }
    if (node.nodeType !== 1) return
    const el = node as Element
    const tag = el.tagName
    if (tag === 'BR') {
      if (inList) current.push({ text: ' ', ...flags })
      else flush()
      return
    }
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE') return
    if (tag === 'UL' || tag === 'OL') {
      if (inList) {
        // A list inside a list item: its items become their own lines.
        list(el)
        return
      }
      if (hasContent()) flush()
      list(el)
      return
    }
    const isBlock = BLOCK.has(tag) || tag === 'LI'
    if (isBlock && !inList && hasContent()) flush()
    const next = flagsOf(el, flags)
    el.childNodes.forEach((child) => inline(child, next, inList))
    if (isBlock && !inList && hasContent()) flush()
  }

  function list(el: Element) {
    const numbered = el.tagName === 'OL'
    let n = 0
    el.childNodes.forEach((child) => {
      if (child.nodeType === 1 && (child as Element).tagName === 'LI') {
        n += 1
        current = []
        const nested: Element[] = []
        ;(child as Element).childNodes.forEach((grand) => {
          if (grand.nodeType === 1 && ['UL', 'OL'].includes((grand as Element).tagName)) nested.push(grand as Element)
          else inline(grand, base, true)
        })
        const body = runsToMarkup(current).replace(/\s+/g, ' ').trim()
        current = []
        if (body) lines.push(`${numbered ? `${n}.` : '-'} ${body}`)
        else n -= 1
        nested.forEach((sub) => list(sub))
      } else if (child.nodeType === 1 && ['UL', 'OL'].includes((child as Element).tagName)) {
        list(child as Element)
      }
    })
  }

  root.childNodes.forEach((child) => inline(child, base, false))
  if (hasContent()) flush()

  // No run of more than one blank line, and none at either end.
  const tidy: string[] = []
  for (const line of lines) {
    if (line === '' && (tidy.length === 0 || tidy[tidy.length - 1] === '')) continue
    tidy.push(line)
  }
  while (tidy.length && tidy[tidy.length - 1] === '') tidy.pop()
  return tidy.join('\n')
}
