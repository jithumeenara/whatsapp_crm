import { describe, expect, it } from 'vitest'
import { checkLine, factLines, numbersIn, toFindings } from './rules'
import type { Finding } from '../doc/types'

const cards: Finding[] = [
  { severity: 'high', code: 'never_contacted', title: '27 leads were never contacted', evidence: 'Older than 24 hours with no call.', suggestion: 'Call them today.' },
  { severity: 'medium', code: 'agent_low:u1', title: 'Anugraha: 33% of calls answered', evidence: 'The team average is 56% (60 calls).', suggestion: 'Move calls.', href: '/x' },
  { severity: 'good', code: 'nothing', title: 'Nothing has dropped', evidence: 'e', suggestion: 's' },
]

describe('factLines', () => {
  it('only the code-written titles and evidence of the cards; no links, no suggestions, no good cards', () => {
    const f = factLines(cards)
    expect(f).toEqual(['27 leads were never contacted. Older than 24 hours with no call.', 'Anugraha: 33% of calls answered. The team average is 56% (60 calls).'])
  })
})

describe('numbersIn', () => {
  it('reads plain numbers, decimals and percentages', () => {
    expect(numbersIn('27 leads, 33% vs 56.5 and 1,200')).toEqual([27, 33, 56.5, 1200])
  })
})

describe('checkLine', () => {
  const allowed = new Set(numbersIn(factLines(cards).join(' ')))
  it('a line whose numbers all come from the facts is kept', () => {
    expect(checkLine('Call the 27 leads first; Anugraha is at 33% against 56%.', allowed)).toBe(true)
  })
  it('a line with a number the facts do not have is dropped', () => {
    expect(checkLine('This will raise sales by 40%.', allowed)).toBe(false)
  })
  it('small step numbers (1–5) are allowed', () => {
    expect(checkLine('Step 2: share the leads among 3 people.', allowed)).toBe(true)
  })
})

describe('toFindings', () => {
  it('kept lines become AI-labelled cards; an empty or failed answer gives none', () => {
    const allowed = new Set(numbersIn(factLines(cards).join(' ')))
    const out = toFindings({ summary: 'Leads wait too long (27 not called).', actions: ['Call the 27 leads today.', 'Raise answers by 90% next week.'] }, allowed)
    expect(out.every((x) => x.byAi)).toBe(true)
    expect(out.map((x) => x.title)).toEqual(['Leads wait too long (27 not called).', 'Call the 27 leads today.'])
    expect(toFindings(null, allowed)).toEqual([])
  })
})
