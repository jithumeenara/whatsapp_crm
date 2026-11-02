import { describe, expect, it } from 'vitest'
import { safeText } from './spreadsheet-safe'

// A formula hidden behind leading spaces or tabs, or written with the
// full-width signs, is still a formula to some spreadsheet programs.
describe('spreadsheet export text — hidden formulas', () => {
  it('neutralises a formula after leading spaces or tabs', () => {
    for (const bad of ['  =1+1', ' +1', '\t \t-2', '   @SUM(A1)', ' \t=HYPERLINK("http://x")']) {
      expect(safeText(bad)).toBe(`'${bad}`)
    }
  })

  it('neutralises the full-width forms ＝ ＋ － ＠, also after spaces', () => {
    for (const bad of ['＝1+1', '＋1', '－1', '＠SUM(A1)', '  ＝HYPERLINK("http://x")']) {
      expect(safeText(bad)).toBe(`'${bad}`)
    }
  })

  it('leaves ordinary text alone, including signs in the middle', () => {
    for (const ok of ['Anu', '  Anu', 'a=b', 'x + y', 'name@example.com', '98765-43210', '', '   ', 'ｈｅｌｌｏ']) {
      expect(safeText(ok)).toBe(ok)
    }
  })
})
