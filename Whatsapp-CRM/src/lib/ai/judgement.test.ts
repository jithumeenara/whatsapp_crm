import { describe, expect, it } from 'vitest'
import {
  normalizeJudgement,
  buildPrompt,
  buildTranscript,
  NOT_LEAD_REASONS,
  type JudgementInput,
} from './judgement'

const CATEGORIES = [
  { key: 'lgs', label: 'Sub Staff (LGS)' },
  { key: 'ldc', label: 'Ministerial (LDC/UDC)' },
]

const OUT_OF_SCOPE = [{ key: 'hostel', question: 'Hostel or accommodation' }]

function input(over: Partial<JudgementInput> = {}): JudgementInput {
  return {
    accountId: 'acc',
    transcript: [{ from: 'customer', text: 'What is the LGS coaching fee?' }],
    categories: CATEGORIES,
    outOfScope: OUT_OF_SCOPE,
    ...over,
  }
}

const full = {
  is_lead: true,
  not_lead_reason: '',
  category: 'lgs',
  category_confidence: 'high',
  priority: 'normal',
  out_of_scope_key: '',
  follow_up_phrase: '',
  reason: 'They asked the LGS fee.',
}

describe('the five answers arrive together', () => {
  it('reads a well-formed reply', () => {
    const j = normalizeJudgement(full, input())
    expect(j).toEqual({
      isLead: true,
      notLeadReason: null,
      category: 'lgs',
      categoryConfidence: 'high',
      priority: 'normal',
      outOfScopeKey: null,
      followUpPhrase: null,
      reason: 'They asked the LGS fee.',
    })
  })

  it('cannot contradict itself, because it is one answer', () => {
    // The whole reason this is a single call. A lead detector and a
    // router asking separately could disagree about the same message;
    // these two fields came out of one sentence.
    const j = normalizeJudgement({ ...full, is_lead: false, not_lead_reason: 'spam_or_wrong_number' }, input())
    expect(j.isLead).toBe(false)
    expect(j.notLeadReason).toBe('spam_or_wrong_number')
  })
})

describe('a category has to be one this business defined', () => {
  it('accepts a key from the list', () => {
    expect(normalizeJudgement(full, input()).category).toBe('lgs')
  })

  it('throws away one the model invented', () => {
    // A category nobody defined cannot be routed to anybody, and
    // storing it would make the reports lie about what was asked.
    const j = normalizeJudgement({ ...full, category: 'astrology' }, input())
    expect(j.category).toBeNull()
  })

  it('is unsure whenever there is no category, whatever the model claimed', () => {
    // "high confidence in nothing" is not a state the rest of the app
    // should have to think about.
    const j = normalizeJudgement({ ...full, category: '', category_confidence: 'high' }, input())
    expect(j.categoryConfidence).toBe('unsure')
  })

  it('keeps unsure when the model says it genuinely could be either', () => {
    // The answer that stops a patient being sent to the wrong doctor.
    const j = normalizeJudgement({ ...full, category_confidence: 'unsure' }, input())
    expect(j.categoryConfidence).toBe('unsure')
  })

  it('falls back to low rather than high when the confidence is unreadable', () => {
    // Erring downward: low confidence shows the category but does not
    // route on it, which is the harmless direction to be wrong in.
    const j = normalizeJudgement({ ...full, category_confidence: 'very sure' }, input())
    expect(j.categoryConfidence).toBe('low')
  })

  it('works for a business that has set no categories at all', () => {
    const j = normalizeJudgement(full, input({ categories: [] }))
    expect(j.category).toBeNull()
    expect(j.categoryConfidence).toBe('unsure')
  })
})

describe('why it is not a lead', () => {
  it('keeps a reason from the closed list', () => {
    const j = normalizeJudgement(
      { ...full, is_lead: false, not_lead_reason: 'job_application' },
      input(),
    )
    expect(j.notLeadReason).toBe('job_application')
  })

  it('falls back to unclear rather than inventing a category of person', () => {
    const j = normalizeJudgement(
      { ...full, is_lead: false, not_lead_reason: 'probably a student' },
      input(),
    )
    expect(j.notLeadReason).toBe('unclear')
  })

  it('has no reason at all when it IS a lead', () => {
    // Otherwise the review screen has to explain why a lead is also a
    // job application.
    const j = normalizeJudgement({ ...full, not_lead_reason: 'vendor_or_sales' }, input())
    expect(j.notLeadReason).toBeNull()
  })

  it('offers unclear as a real option', () => {
    expect(NOT_LEAD_REASONS).toContain('unclear')
  })
})

describe('how loud', () => {
  it('takes a level from the list', () => {
    expect(normalizeJudgement({ ...full, priority: 'urgent' }, input()).priority).toBe('urgent')
    expect(normalizeJudgement({ ...full, priority: 'quiet' }, input()).priority).toBe('quiet')
  })

  it('lands on normal when the model says something else', () => {
    // Not urgent. When everything is urgent nothing is, so the
    // fallback must never be the loud one.
    expect(normalizeJudgement({ ...full, priority: 'critical' }, input()).priority).toBe('normal')
    expect(normalizeJudgement({ ...full, priority: '' }, input()).priority).toBe('normal')
  })
})

describe('things this business does not offer', () => {
  it('matches an entry it was given', () => {
    const j = normalizeJudgement({ ...full, out_of_scope_key: 'hostel' }, input())
    expect(j.outOfScopeKey).toBe('hostel')
  })

  it('ignores one it was not', () => {
    // The assistant answers from the entry's own wording, so a key with
    // no entry behind it would mean answering from nothing.
    const j = normalizeJudgement({ ...full, out_of_scope_key: 'swimming_pool' }, input())
    expect(j.outOfScopeKey).toBeNull()
  })
})

describe('a time the customer named', () => {
  it('keeps their own words', () => {
    // Words, not a timestamp: turning "after my exam on the 15th" into
    // a date needs the business's calendar and time zone, which this
    // module does not have and must not guess at.
    const j = normalizeJudgement({ ...full, follow_up_phrase: 'tomorrow evening' }, input())
    expect(j.followUpPhrase).toBe('tomorrow evening')
  })

  it('is empty when they named nothing', () => {
    expect(normalizeJudgement(full, input()).followUpPhrase).toBeNull()
  })

  it('does not overflow a row with a whole message', () => {
    const j = normalizeJudgement({ ...full, follow_up_phrase: 'x'.repeat(500) }, input())
    expect(j.followUpPhrase!.length).toBeLessThanOrEqual(120)
  })
})

describe('surviving a bad reply', () => {
  it('reads an empty object without throwing', () => {
    const j = normalizeJudgement({}, input())
    expect(j.isLead).toBe(false)
    expect(j.notLeadReason).toBe('unclear')
    expect(j.priority).toBe('normal')
  })

  it('reads null and nonsense without throwing', () => {
    expect(() => normalizeJudgement(null, input())).not.toThrow()
    expect(() => normalizeJudgement('a string', input())).not.toThrow()
    expect(() => normalizeJudgement(42, input())).not.toThrow()
  })

  it('does not treat a truthy non-boolean as a lead', () => {
    // A lead created from the string "yes" is a row somebody has to
    // delete. Only a real boolean counts.
    expect(normalizeJudgement({ ...full, is_lead: 'yes' }, input()).isLead).toBe(false)
    expect(normalizeJudgement({ ...full, is_lead: 1 }, input()).isLead).toBe(false)
  })
})

describe('the transcript it reads', () => {
  it('keeps the most recent turns, not the first ones', () => {
    const turns = Array.from({ length: 20 }, (_, i) => ({
      from: 'customer' as const,
      text: `message number ${i}`,
    }))
    const text = buildTranscript(turns, 3)
    expect(text).toContain('message number 19')
    expect(text).not.toContain('message number 0')
  })

  it('says who is speaking', () => {
    const text = buildTranscript([
      { from: 'customer', text: 'what is the fee please' },
      { from: 'business', text: 'let me check that for you' },
    ])
    expect(text).toContain('Customer: what is the fee please')
    expect(text).toContain('Business: let me check that for you')
  })

  it('cuts a rambling message rather than dropping it', () => {
    // The opening of a long message is nearly always the part that says
    // what they want.
    const text = buildTranscript([{ from: 'customer', text: 'I want to know ' + 'x'.repeat(2000) }])
    expect(text).toContain('I want to know')
    expect(text.length).toBeLessThan(600)
  })
})

describe('the prompt', () => {
  it('lists the categories with their keys', () => {
    const p = buildPrompt(input())
    expect(p).toContain('lgs — Sub Staff (LGS)')
    expect(p).toContain('ldc — Ministerial (LDC/UDC)')
  })

  it('tells it to say unsure rather than choose between two', () => {
    expect(buildPrompt(input())).toContain('unsure')
  })

  it('lists what the business does not offer', () => {
    expect(buildPrompt(input())).toContain('hostel — Hostel or accommodation')
  })

  it("carries this business's own words about what counts", () => {
    const p = buildPrompt(input({ leadRules: 'Anyone asking about a course.' }))
    expect(p).toContain('Anyone asking about a course.')
  })

  it('carries confirmed examples, which teach it better than the rules do', () => {
    const p = buildPrompt(
      input({
        examples: [
          { text: 'Is there a December batch?', isLead: true },
          { text: 'Sir any vacancy?', isLead: false },
        ],
      }),
    )
    expect(p).toContain('LEAD: "Is there a December batch?"')
    expect(p).toContain('NOT a lead: "Sir any vacancy?"')
  })

  it('caps the examples so the prompt cannot grow without limit', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ text: `example ${i}`, isLead: true }))
    const p = buildPrompt(input({ examples: many }))
    expect(p).not.toContain('example 20')
  })

  it('works for a business that has configured nothing yet', () => {
    // Every account starts here, and a prompt that needed the lists
    // would make the feature useless on day one.
    const p = buildPrompt(input({ categories: [], outOfScope: [] }))
    expect(p).toContain('Customer: What is the LGS coaching fee?')
  })
})
