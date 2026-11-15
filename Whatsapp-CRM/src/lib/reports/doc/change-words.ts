/**
 * The change words (change.ts) in the report's language, for the files
 * (PDF, slides, workbook). Kept apart from change.ts so the screen, which
 * is English, does not load every language's dictionary.
 */

import { t } from '../i18n'
import type { ChangeWords } from './change'

export function changeWords(lang: string): ChangeWords {
  return { tooFew: t(lang, 'dTooFew'), times: (n) => t(lang, 'dTimesBefore', { n }) }
}
