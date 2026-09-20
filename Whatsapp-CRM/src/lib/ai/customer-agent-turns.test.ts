import { describe, expect, it } from 'vitest'
import type { Content } from '@google/generative-ai'
import { describeTurns } from './customer-agent'

/**
 * The diagnostic line that has to be right the one time it prints.
 *
 * It exists because a 400 — "Requests ending with a model turn are not
 * supported" — appeared in production against a loop that appends a
 * user turn before every request, and reading the source could not
 * explain it. The next occurrence has to answer the question rather
 * than repeat it, and a describer that is itself wrong would waste that
 * one chance.
 *
 * The other half of its job is what it must never do: print what a
 * customer said.
 */

const turn = (role: string, parts: unknown[]): Content => ({ role, parts } as Content)

describe('describeTurns', () => {
  it('never prints message text', () => {
    const secret = 'my phone is 9876543210 and my name is Abhijith'
    const out = describeTurns([turn('user', [{ text: secret }])])
    expect(out).not.toContain(secret)
    expect(out).not.toContain('9876543210')
    expect(out).toBe('user[text]')
  })

  it('shows the order of turns, which is the whole question', () => {
    const out = describeTurns([
      turn('user', [{ text: 'hi' }]),
      turn('model', [{ text: 'hello' }]),
      turn('user', [{ text: 'what are the fees' }]),
    ])
    expect(out).toBe('user[text] > model[text] > user[text]')
  })

  it('names the tool in a call and in its result', () => {
    // So a failing round can be traced to the tool that caused it.
    const out = describeTurns([
      turn('model', [{ functionCall: { name: 'lookup_record', args: {} } }]),
      turn('user', [{ functionResponse: { name: 'lookup_record', response: {} } }]),
    ])
    expect(out).toBe('model[call:lookup_record] > user[result:lookup_record]')
  })

  it('makes an empty text part obvious', () => {
    // A blank message is a candidate cause and would otherwise read as
    // an ordinary text turn.
    expect(describeTurns([turn('user', [{ text: '   ' }])])).toBe('user[EMPTY-TEXT]')
  })

  it('makes a turn with no parts at all obvious', () => {
    expect(describeTurns([turn('model', [])])).toBe('model[NO-PARTS]')
  })

  it('survives a turn whose parts are missing entirely', () => {
    // Never throw while reporting an error — that would replace a
    // useful diagnosis with a second, more confusing failure.
    expect(describeTurns([{ role: 'model' } as Content])).toBe('model[NO-PARTS]')
  })

  it('shows several parts in one turn', () => {
    const out = describeTurns([
      turn('model', [{ text: 'let me check' }, { functionCall: { name: 'get_price', args: {} } }]),
    ])
    expect(out).toBe('model[text+call:get_price]')
  })

  it('would show a request that ends on a model turn', () => {
    // The exact shape the API refused. If this ever prints, the line
    // says so in as many words.
    const out = describeTurns([
      turn('user', [{ text: 'hi' }]),
      turn('model', [{ functionCall: { name: 'lookup_record', args: {} } }]),
    ])
    expect(out.endsWith('model[call:lookup_record]')).toBe(true)
  })
})
