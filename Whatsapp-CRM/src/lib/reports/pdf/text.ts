/**
 * Text for the report PDF, in any language this app writes reports in.
 *
 * Why this exists: pdfkit and fontkit shape a single WORD correctly in every
 * script (Malayalam conjuncts, Devanagari, Tamil, Arabic joining), but pdfkit's
 * own handling of a string with spaces is wrong for right-to-left text: words
 * come out in the wrong order or lose their spaces (checked against glyph
 * positions). So a string with a space is never handed to pdfkit. Text is cut
 * into word tokens, ordered with the Unicode bidirectional algorithm (bidi-js),
 * and each token is placed here, in the font of its own script.
 *
 * Complex scripts are extracted from a PDF in glyph order, so a line that has
 * a non-Latin word carries an /ActualText of its real Unicode: copy, search
 * and screen readers then get the right text.
 *
 * Verified in a scratch lab for English, Malayalam, Hindi, Tamil, Telugu,
 * Kannada, Bengali and Arabic (rendered pages compared with Chrome).
 */
import type PDFDocument from 'pdfkit'
import bidiFactory from 'bidi-js'
import { getFont, type Script } from './fonts'

const bidi = bidiFactory()

const RANGES: ReadonlyArray<readonly [number, number, Script]> = [
  [0x0d00, 0x0d7f, 'malayalam'], [0x0900, 0x097f, 'devanagari'], [0x0980, 0x09ff, 'bengali'],
  [0x0b80, 0x0bff, 'tamil'], [0x0c00, 0x0c7f, 'telugu'], [0x0c80, 0x0cff, 'kannada'],
  [0x0600, 0x06ff, 'arabic'], [0x0750, 0x077f, 'arabic'], [0x08a0, 0x08ff, 'arabic'],
  [0xfb50, 0xfdff, 'arabic'], [0xfe70, 0xfeff, 'arabic'],
]

/** The script a code point belongs to, or null for Latin, digits and punctuation. */
export function scriptOf(cp: number): Script | null {
  for (const [a, b, s] of RANGES) if (cp >= a && cp <= b) return s
  return null
}

// Inside right-to-left text, digits after Arabic letters become "Arabic
// numbers" and '2026-10-01' flips to '01-10-2026' (a classic UAX#9 trap that
// browsers share). Latin and number runs are wrapped in LRI..PDI isolates,
// which draw nothing.
// A bracketed Latin phrase, "(GST)", is one run: its brackets belong to it, not to the Arabic around it.
const isolateLtr = (t: string) =>
  t.replace(/\([A-Za-z0-9][A-Za-z0-9 .,:/\-+%@_&#]*\)|[A-Za-z0-9]+(?:[ .,:/\-+%@_()&#]+[A-Za-z0-9]+)*/g, '⁦$&⁩')

export interface Token {
  text: string
  script: Script
  level: number
  space: boolean
}

export function tokenize(input: string, baseDir: 'ltr' | 'rtl'): { toks: Token[] } {
  const text = baseDir === 'rtl' ? isolateLtr(input) : input
  const levels = bidi.getEmbeddingLevels(text, baseDir).levels // per UTF-16 unit
  let u = 0
  let prev: Script = 'latin'
  const toks: Token[] = []
  for (const ch of Array.from(text)) {
    const cp = ch.codePointAt(0) as number
    // Bidi controls carry no glyph.
    if ((cp >= 0x2066 && cp <= 0x2069) || cp === 0x200e || cp === 0x200f) {
      u += ch.length
      continue
    }
    const space = cp === 0x20 || cp === 0xa0 || cp === 0x09
    let script = scriptOf(cp)
    if (script === null) script = space || cp === 0x200c || cp === 0x200d ? prev : 'latin'
    prev = script
    const level = levels[u]
    u += ch.length
    const last = toks[toks.length - 1]
    if (!space && last && !last.space && last.script === script && last.level === level) last.text += ch
    else toks.push({ text: ch, script: space ? 'latin' : script, level, space })
  }
  return { toks }
}

/** UAX#9 rule L2 on whole tokens: reverse runs from the highest level down to the lowest odd level. */
export function visualOrder(toks: Token[]): Token[] {
  const t = toks.slice()
  const lv = t.map((x) => x.level)
  const max = Math.max(0, ...lv)
  const odd = lv.filter((l) => l % 2)
  const minOdd = odd.length ? Math.min(...odd) : 99
  for (let l = max; l >= minOdd && l > 0; l--) {
    for (let i = 0; i < t.length; i++) {
      if (t[i].level >= l) {
        let j = i
        while (j + 1 < t.length && t[j + 1].level >= l) j++
        const seg = t.slice(i, j + 1).reverse()
        t.splice(i, seg.length, ...seg)
        i = j
      }
    }
  }
  return t
}

const MIRROR: Record<string, string> = {
  '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '«': '»', '»': '«',
}

/** Swaps each bracket for its pair. The font puts a right-to-left word's letters
 *  in reading order but leaves the brackets as they were, so "(تقديري)" came out
 *  as ")تقديري(" (seen on a rendered page). */
export const mirrorBrackets = (s: string) => s.replace(/[()[\]{}<>«»]/g, (c) => MIRROR[c] ?? c)

/** The text as it is drawn: brackets mirrored in a token read right to left
 *  (an odd bidi level), untouched otherwise. The token's own text stays the
 *  logical one, which is what copy and screen readers get. */
export const drawnText = (tk: Token): string => (tk.level % 2 === 1 ? mirrorBrackets(tk.text) : tk.text)

export const isRtlText = (t: string) => /[֐-ࣿיִ-﷿ﹰ-﻿]/.test(t)

const widthCache = new Map<string, number>()
type Doc = InstanceType<typeof PDFDocument>
type Anyfont = Parameters<Doc['font']>[0]

function tokenWidth(doc: Doc, tk: Token, size: number, bold: boolean): number {
  const k = `${tk.script}|${bold}|${size}|${tk.text}`
  let w = widthCache.get(k)
  if (w === undefined) {
    const { key, font } = getFont(tk.script, bold)
    w = doc.font(font as unknown as Anyfont, key).fontSize(size).widthOfString(tk.text)
    if (widthCache.size > 20000) widthCache.clear()
    widthCache.set(k, w)
  }
  return w
}

type MarkDoc = { markContent(tag: string, opts?: Record<string, unknown>): unknown; endMarkedContent(): unknown }

function drawTokens(doc: Doc, visual: Token[], x: number, y: number, size: number, bold: boolean, logical: Token[]) {
  const needActual = logical.some((t) => !t.space && t.script !== 'latin')
  if (needActual) (doc as unknown as MarkDoc).markContent('Span', { actual: logical.map((t) => t.text).join('') })
  const latin = getFont('latin', bold).font
  const latinAscent = latin.ascent / latin.unitsPerEm
  let cx = x
  for (const tk of visual) {
    const w = tokenWidth(doc, tk, size, bold)
    if (!tk.space) {
      const { key, font } = getFont(tk.script, bold)
      // One baseline for every font: pdfkit places text by each font's own ascender.
      doc.font(font as unknown as Anyfont, key).fontSize(size)
        .text(drawnText(tk), cx, y + (latinAscent - font.ascent / font.unitsPerEm) * size, { lineBreak: false })
    }
    cx += w
  }
  if (needActual) (doc as unknown as MarkDoc).endMarkedContent()
}

/**
 * What no font here can draw, taken out: emoji (a picture, drawn as empty
 * boxes by every text font), their skin-tone and variation marks, and the
 * joiner that glues one emoji to the next. The joiner that shapes Indic
 * letters (Malayalam chillu forms) is kept: only a joiner sitting between two
 * emoji goes. Spaces left behind are closed up.
 */
const EMOJI = '\\p{Extended_Pictographic}|\\p{Regional_Indicator}'
const EMOJI_TAIL = '[\\uFE0E\\uFE0F\\u{1F3FB}-\\u{1F3FF}\\u20E3]*'
const EMOJI_SEQUENCE = new RegExp(`(?:${EMOJI})${EMOJI_TAIL}(?:\\u200D(?:${EMOJI})${EMOJI_TAIL})*`, 'gu')

export function stripUnprintable(text: string): string {
  return String(text ?? '').replace(EMOJI_SEQUENCE, ' ').replace(/[︎️]/g, '').replace(/ {2,}/g, ' ').trim()
}

/** No cell or label is longer than this when drawn; the work grows with length. */
const MAX_DRAWN_CHARS = 600

export interface LineOptions {
  size?: number
  bold?: boolean
  color?: string
  /** The box the line must fit in. */
  width?: number | null
  /** Before cutting with an ellipsis, shrink the text down to this size, so
   *  an amount is never lost: a financial figure is shrunk, not truncated. */
  shrinkTo?: number
  align?: 'left' | 'right' | 'center'
  rtl?: boolean
}

/** One line: per-word font, bidi order, alignment, shrink-then-ellipsis. Returns the width drawn. */
export function line(doc: Doc, text: string, x: number, y: number, o: LineOptions = {}): number {
  const { size = 9, bold = false, color = '#111111', width = null, align = 'left', rtl = false, shrinkTo } = o
  // Bounded work: whatever arrives, at most this much is ever laid out.
  const str = Array.from(stripUnprintable(String(text ?? ''))).slice(0, MAX_DRAWN_CHARS).join('')
  const dir = rtl || isRtlText(str) ? 'rtl' : 'ltr'
  const fit = (s: string, sz: number) => {
    const { toks } = tokenize(s, dir)
    return { toks, w: toks.reduce((a, t) => a + tokenWidth(doc, t, sz, bold), 0) }
  }

  let drawSize = size
  let { toks, w } = fit(str, drawSize)
  // Smaller first, down to the floor, when the caller says the text must not be cut.
  while (width && w > width && shrinkTo !== undefined && drawSize > shrinkTo) {
    drawSize = Math.max(shrinkTo, drawSize - 0.5)
    ;({ toks, w } = fit(str, drawSize))
  }
  if (width && w > width) {
    // The longest prefix that fits with an ellipsis, found by halving: about
    // ten layouts however long the text is (it used to be one per character).
    const chars = Array.from(str)
    let lo = 1
    let hi = chars.length
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      if (fit(`${chars.slice(0, mid).join('').trimEnd()}…`, drawSize).w <= width) lo = mid
      else hi = mid - 1
    }
    ;({ toks, w } = fit(`${chars.slice(0, lo).join('').trimEnd()}…`, drawSize))
  }
  let cx = x
  if (width && align === 'right') cx = x + width - w
  else if (width && align === 'center') cx = x + (width - w) / 2
  doc.fillColor(color)
  drawTokens(doc, visualOrder(toks), cx, y, drawSize, bold, toks)
  return w
}

export interface ParagraphOptions {
  size?: number
  color?: string
  bold?: boolean
  align?: 'auto' | 'left' | 'right' | 'center'
  leading?: number
}

/** A wrapped paragraph, with its own line breaker so right-to-left and mixed text wrap correctly. Returns the y after it. */
export function paragraph(doc: Doc, text: string, x: number, y: number, width: number, o: ParagraphOptions = {}): number {
  const { size = 9, color = '#333333', bold = false, align = 'auto', leading = 1.4 } = o
  const str = String(text ?? '')
  const dir = isRtlText(str) ? 'rtl' : 'ltr'
  const { toks } = tokenize(str, dir)
  const lines: Token[][] = []
  let cur: Token[] = []
  let cw = 0
  for (const tk of toks) {
    const w = tokenWidth(doc, tk, size, bold)
    if (!tk.space && cw + w > width && cur.some((t) => !t.space)) {
      while (cur.length && cur[cur.length - 1].space) cur.pop()
      lines.push(cur)
      cur = []
      cw = 0
    }
    if (tk.space && !cur.length) continue // no space at the start of a wrapped line
    cur.push(tk)
    cw += w
  }
  if (cur.length) lines.push(cur)
  const al = align === 'auto' ? (dir === 'rtl' ? 'right' : 'left') : align
  doc.fillColor(color)
  let cy = y
  for (const ln of lines) {
    const lw = ln.reduce((a, t) => a + tokenWidth(doc, t, size, bold), 0)
    const sx = al === 'right' ? x + width - lw : al === 'center' ? x + (width - lw) / 2 : x
    drawTokens(doc, visualOrder(ln), sx, cy, size, bold, ln)
    cy += size * leading
  }
  return cy
}
