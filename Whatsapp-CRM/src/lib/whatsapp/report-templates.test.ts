import { describe, expect, it } from 'vitest'
import { checkKitDraft } from './template-kit'
import { READY_REPORT_TEMPLATES } from './report-templates'

// The ready-made report template (Templates → Ready-made): what scheduled
// reports, red alerts and the morning brief send outside WhatsApp's
// 24-hour window, with two variables: the person's name and one line.
describe('ready-made report templates', () => {
  it('there is one in English and one in Malayalam, both Utility', () => {
    expect(READY_REPORT_TEMPLATES.map((t) => t.language).sort()).toEqual(['en', 'ml'])
    expect(READY_REPORT_TEMPLATES.every((t) => t.category === 'Utility')).toBe(true)
  })
  it("each passes the same Meta checks as the kit's templates, with no problems", () => {
    for (const t of READY_REPORT_TEMPLATES) expect(checkKitDraft(t).problems, t.language).toEqual([])
  })
  it('exactly two variables, {{1}} the name and {{2}} the line, never at the very start or end', () => {
    for (const t of READY_REPORT_TEMPLATES) {
      expect(t.body.match(/\{\{\d+\}\}/g)).toEqual(['{{1}}', '{{2}}'])
      expect(t.body.trim().startsWith('{{')).toBe(false)
      expect(t.body.trim().endsWith('}}')).toBe(false)
      expect(t.samples).toHaveLength(2)
    }
  })
  it('purely informational wording, so Meta keeps it as Utility (no offers or prices)', () => {
    for (const t of READY_REPORT_TEMPLATES) expect(t.body).not.toMatch(/offer|discount|sale|buy|free|%|₹/i)
  })
})
