import { describe, it, expect } from 'vitest'
import { selectRelevantContext } from './knowledge'

// Keyword search is what answers when the search by meaning is not
// available. It used to keep only a–z and 0–9, so a Malayalam question
// matched nothing at all.
const QA = [
  { question: 'പരിശീലന ഫീസ് എങ്ങനെ അടയ്ക്കാം?', answer: 'രജിസ്ട്രേഷന് ശേഷം അയയ്ക്കുന്ന ലിങ്ക് വഴി ഓൺലൈനായി അടയ്ക്കാം.', id: 'fee' },
  { question: 'ട്രെയിനിങ്ങിൽ താമസ സൗകര്യം ഉണ്ടോ?', answer: 'ഹോസ്റ്റൽ സൗകര്യം ലഭ്യമാണ്.', id: 'hostel' },
  { question: 'What are the clinic timings?', answer: 'OPD runs 9 am to 1 pm, Monday to Saturday.', id: 'opd' },
  { question: 'How do I give feedback?', answer: 'Use the feedback form on our website.', id: 'feedback' },
]

async function pick(question: string) {
  const selected = await selectRelevantContext(question, QA, [], { maxQaPairs: 2 })
  return selected.qaPairs.map((p) => p.id)
}

describe('keyword search in any script', () => {
  it('finds a Malayalam entry from a Malayalam question', async () => {
    expect((await pick('ഫീസ് എങ്ങനെ അടയ്ക്കണം'))[0]).toBe('fee')
  })

  it('matches a word with a Malayalam ending added', async () => {
    // "ട്രെയിനിങ്" asked, "ട്രെയിനിങ്ങിൽ" stored.
    expect((await pick('ട്രെയിനിങ് താമസം'))[0]).toBe('hostel')
  })

  it('ignores question words that appear in every message', async () => {
    expect(await pick('ഏതൊക്കെ ആണ് ഉള്ളത്')).toEqual([])
  })

  it('treats the old and new Malayalam spellings as one', async () => {
    // "ഫീസ്" with a zero-width joiner, as older keyboards type it.
    expect((await pick('ഫീസ്\u200D അടയ്ക്കാം'))[0]).toBe('fee')
  })

  it('still works in English, plurals included, without "fee" matching "feedback"', async () => {
    expect((await pick('clinic timing'))[0]).toBe('opd')
    expect(await pick('fee')).not.toContain('feedback')
  })
})
