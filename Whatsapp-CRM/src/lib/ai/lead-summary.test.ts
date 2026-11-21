import { describe, expect, it } from 'vitest'
import {
  buildSummaryTranscript, cleanSummary, normaliseFocus, summarySystemPrompt,
  MAX_MESSAGES, MAX_PER_MESSAGE, MAX_TRANSCRIPT,
} from './lead-summary'

const at = (m: number) => new Date(Date.UTC(2026, 10, 21, 10, m))
const row = (sender_type: string, content_text: string | null, m: number, extra: Record<string, unknown> = {}) =>
  ({ sender_type, content_text, created_at: at(m), ...extra })

describe('buildSummaryTranscript', () => {
  it('labels customer, staff and bot, oldest first, whatever order the rows come in', () => {
    const t = buildSummaryTranscript([row('agent', 'December has two programmes', 2), row('customer', 'Send the schedule', 1), row('bot', 'Hi!', 0)])
    expect(t.text).toBe('Bot: Hi!\nCustomer: Send the schedule\nUs: December has two programmes')
    expect(t.used).toBe(3)
    expect(t.lastAt).toEqual(at(2))
  })

  it('never sends internal notes, system lines or deleted messages', () => {
    const t = buildSummaryTranscript([
      row('note', 'Customer is rude, owner said no discount', 1),
      row('system', 'Conversation closed automatically', 2),
      row('customer', 'gone', 3, { deleted_at: at(4) }),
      row('customer', 'hello', 5),
    ])
    expect(t.text).toBe('Customer: hello')
    expect(t.text).not.toMatch(/discount|closed automatically|gone/)
  })

  it('uses the voice note transcript, and names media that has no words', () => {
    const t = buildSummaryTranscript([
      row('customer', null, 1, { transcript: 'fees ethra aanu', content_type: 'audio' }),
      row('customer', null, 2, { content_type: 'document', media_filename: 'marksheet.pdf' }),
    ])
    expect(t.text).toBe('Customer: fees ethra aanu\nCustomer: [document: marksheet.pdf]')
  })

  it('masks Aadhaar and long account numbers before anything leaves the CRM', () => {
    const t = buildSummaryTranscript([row('customer', 'Aadhaar 2345 6789 0123, account 123456789012345', 1)])
    expect(t.text).not.toContain('2345 6789 0123')
    expect(t.text).not.toContain('123456789012345')
    expect(t.text).toContain('0123')
  })

  it('keeps only the newest messages and caps each one and the whole', () => {
    const many = Array.from({ length: MAX_MESSAGES + 15 }, (_, i) => row('customer', `m${i} ${'x'.repeat(900)}`, i))
    const t = buildSummaryTranscript(many)
    expect(t.text.startsWith('Customer: m')).toBe(true)
    expect(t.text).toContain(`m${MAX_MESSAGES + 14} `)
    expect(t.text).not.toContain('m0 ')
    for (const line of t.text.split('\n')) expect(line.length).toBeLessThanOrEqual('Customer: '.length + MAX_PER_MESSAGE + 1)
    expect(t.text.length).toBeLessThanOrEqual(MAX_TRANSCRIPT)
  })

  it('an empty chat gives nothing', () => {
    expect(buildSummaryTranscript([])).toEqual({ text: '', used: 0, lastAt: null })
  })
})

describe('normaliseFocus', () => {
  it('trims, lowercases, removes control characters and caps the length', () => {
    expect(normaliseFocus('  Fees\n  Discussion ')).toBe('fees discussion')
    expect(normaliseFocus('x'.repeat(200))).toHaveLength(60)
    expect(normaliseFocus(42)).toBe('')
    expect(normaliseFocus(undefined)).toBe('')
  })
})

describe('summarySystemPrompt', () => {
  it('asks for English, three sentences, facts only', () => {
    const p = summarySystemPrompt('')
    expect(p).toMatch(/English/)
    expect(p).toMatch(/At most 3 sentences/)
    expect(p).toMatch(/Never guess/)
  })
  it('with a focus, says what to answer when the chat never mentions it', () => {
    expect(summarySystemPrompt('fees')).toContain('This chat does not mention fees.')
  })
})

describe('cleanSummary', () => {
  it('strips markdown and keeps at most three sentences', () => {
    expect(cleanSummary('**Summary:**\n- Asked for fees. We sent them. Waiting for reply. Extra sentence.'))
      .toBe('Summary: Asked for fees. We sent them. Waiting for reply.')
  })
  it('keeps a reply without a full stop', () => {
    expect(cleanSummary('Customer asked about the January batch')).toBe('Customer asked about the January batch')
  })
  it('an empty reply stays empty', () => {
    expect(cleanSummary('   ')).toBe('')
  })
})
