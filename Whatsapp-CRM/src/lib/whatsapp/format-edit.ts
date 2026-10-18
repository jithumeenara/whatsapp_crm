/**
 * Formatting buttons for a plain text box that holds WhatsApp text — the
 * template editor's Bold, Italic, Strikethrough, Numbered and Bulleted list.
 *
 * WhatsApp formatting is characters in the text itself (*bold*, _italic_,
 * ~strike~, "1. " and "- " at the start of a line), which is also what
 * Meta's template API accepts, so the buttons only ever edit the text.
 * Each button toggles: pressed on formatted text, it takes the formatting
 * off again.
 *
 * Every function takes the text and the selection and returns the new
 * text and selection.
 */

export interface Edit {
  value: string
  start: number
  end: number
}

/**
 * Wraps the selection in a marker (*, _ or ~), or unwraps it when it is
 * already wrapped — inside or just around the selection. Spaces at the
 * selection's edges stay outside the markers, because WhatsApp ignores
 * "* bold *". With nothing selected, inserts an empty pair and puts the
 * cursor between them.
 */
export function toggleWrap(value: string, start: number, end: number, marker: string): Edit {
  const m = marker.length
  let s = Math.max(0, Math.min(start, end))
  let e = Math.min(value.length, Math.max(start, end))

  // Already wrapped, markers inside the selection: "*bold*" selected.
  const sel = value.slice(s, e)
  if (sel.length >= 2 * m && sel.startsWith(marker) && sel.endsWith(marker)) {
    const inner = sel.slice(m, sel.length - m)
    return { value: value.slice(0, s) + inner + value.slice(e), start: s, end: s + inner.length }
  }
  // Already wrapped, markers just outside the selection: "bold" selected in "*bold*".
  if (s >= m && value.slice(s - m, s) === marker && value.slice(e, e + m) === marker) {
    return { value: value.slice(0, s - m) + sel + value.slice(e + m), start: s - m, end: e - m }
  }

  if (s === e) {
    return { value: value.slice(0, s) + marker + marker + value.slice(e), start: s + m, end: s + m }
  }
  // Keep edge spaces outside the markers.
  while (s < e && /\s/.test(value[s])) s++
  while (e > s && /\s/.test(value[e - 1])) e--
  if (s === e) return { value, start, end }
  const inner = value.slice(s, e)
  return {
    value: value.slice(0, s) + marker + inner + marker + value.slice(e),
    start: s + m,
    end: e + m,
  }
}

const NUMBERED = /^\d+\.\s/
const BULLETED = /^[-*•]\s/

/**
 * Numbers ("1. ", "2. ", …) or bullets ("- ") every line the selection
 * touches; if all of them already have that kind of prefix, removes it.
 * Blank lines are left alone and do not count towards the numbering.
 */
export function toggleList(value: string, start: number, end: number, kind: 'numbered' | 'bulleted'): Edit {
  const s = Math.max(0, Math.min(start, end))
  const e = Math.min(value.length, Math.max(start, end))
  const lineStart = value.lastIndexOf('\n', s - 1) + 1
  const nl = value.indexOf('\n', e > s && value[e - 1] === '\n' ? e - 1 : e)
  const lineEnd = nl === -1 ? value.length : nl
  const lines = value.slice(lineStart, lineEnd).split('\n')
  const has = kind === 'numbered' ? NUMBERED : BULLETED
  const other = kind === 'numbered' ? BULLETED : NUMBERED
  const content = lines.filter((l) => l.trim() !== '')
  const allHave = content.length > 0 && content.every((l) => has.test(l))

  let n = 0
  const next = lines.map((l) => {
    if (l.trim() === '') return l
    if (allHave) return l.replace(has, '')
    const bare = l.replace(other, '').replace(has, '')
    n++
    return kind === 'numbered' ? `${n}. ${bare}` : `- ${bare}`
  })
  const block = next.join('\n')
  return {
    value: value.slice(0, lineStart) + block + value.slice(lineEnd),
    start: lineStart,
    end: lineStart + block.length,
  }
}
