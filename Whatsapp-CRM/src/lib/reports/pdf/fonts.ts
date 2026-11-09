/**
 * The fonts the report PDF is written in.
 *
 * One Latin font and one font per script. A font is opened only when text in
 * its script occurs, and each is parsed once per process and shared by every
 * document after that: nothing here grows with the number of reports built.
 *
 * Files are named in this table and nowhere else: a language code or any
 * request value never becomes part of a path.
 */
import fs from 'node:fs'
import path from 'node:path'
import * as fontkit from 'fontkit'

export type Script = 'latin' | 'malayalam' | 'devanagari' | 'tamil' | 'telugu' | 'kannada' | 'bengali' | 'arabic'

/** [regular, bold] per script, in assets/fonts (Noto, SIL Open Font License). */
export const FONT_FILES: Record<Script, readonly [string, string]> = {
  latin: ['NotoSans-Regular.ttf', 'NotoSans-Bold.ttf'],
  malayalam: ['NotoSansMalayalam-Regular.ttf', 'NotoSansMalayalam-Bold.ttf'],
  devanagari: ['NotoSansDevanagari-Regular.ttf', 'NotoSansDevanagari-Bold.ttf'],
  tamil: ['NotoSansTamil-Regular.ttf', 'NotoSansTamil-Bold.ttf'],
  telugu: ['NotoSansTelugu-Regular.ttf', 'NotoSansTelugu-Bold.ttf'],
  kannada: ['NotoSansKannada-Regular.ttf', 'NotoSansKannada-Bold.ttf'],
  bengali: ['NotoSansBengali-Regular.ttf', 'NotoSansBengali-Bold.ttf'],
  arabic: ['NotoSansArabic-Regular.ttf', 'NotoSansArabic-Bold.ttf'],
}

const FONT_DIR = path.join(process.cwd(), 'assets', 'fonts')
const cache = new Map<string, fontkit.Font>()

export function getFont(script: Script, bold: boolean): { key: string; font: fontkit.Font } {
  const file = FONT_FILES[script][bold ? 1 : 0]
  let font = cache.get(file)
  if (!font) {
    font = fontkit.create(fs.readFileSync(path.join(FONT_DIR, file)))
    cache.set(file, font)
  }
  return { key: file, font }
}
