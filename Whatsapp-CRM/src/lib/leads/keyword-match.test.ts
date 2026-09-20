import { describe, expect, it } from 'vitest'
import { matchKeywords, normalize, similarity } from './keyword-match'

describe('normalize', () => {
  it('folds case, punctuation and repeated spaces', () => {
    expect(normalize('  What are the FEES?? ')).toBe('what are the fees')
  })

  it('leaves Malayalam alone', () => {
    // The vowel signs are part of the word, not accents on it. An
    // over-eager combining-mark strip would eat them.
    expect(normalize('അഡ്മിഷൻ ഫീസ്')).toBe('അഡ്മിഷൻ ഫീസ്')
  })
})

describe('similarity', () => {
  it('scores real typos above the default threshold', () => {
    expect(similarity('admision', 'admission')).toBeGreaterThanOrEqual(0.8)
    expect(similarity('addmission', 'admission')).toBeGreaterThanOrEqual(0.8)
  })

  it('keeps genuinely different words below it', () => {
    // The pair the threshold was chosen against.
    expect(similarity('admission', 'submission')).toBeLessThan(0.8)
  })

  it('charges very little for word order', () => {
    // Not free — the bigrams either side of the join change — but far
    // enough above the threshold that a reordered phrase still matches,
    // which is the property the 'similar' mode depends on.
    expect(similarity('course fees', 'fees course')).toBeGreaterThanOrEqual(0.85)
  })
})

describe('matchKeywords', () => {
  const opts = { mode: 'word' as const }

  it('does not match a word inside another word', () => {
    // The failure that makes a plain `includes` unusable as "keyword".
    expect(matchKeywords('please start now', ['art'], opts)).toBeNull()
    expect(matchKeywords('is this art', ['art'], opts)).not.toBeNull()
  })

  it('matches a multi-word phrase as a unit', () => {
    expect(matchKeywords('what is the course fee', ['course fee'], opts)).not.toBeNull()
    expect(matchKeywords('course is good, fee later', ['course fee'], opts)).toBeNull()
  })

  it('exact means the whole message', () => {
    const exact = { mode: 'exact' as const }
    expect(matchKeywords('yes', ['yes'], exact)).not.toBeNull()
    expect(matchKeywords('yes I already did, stop asking', ['yes'], exact)).toBeNull()
  })

  it('contains reaches inside a word', () => {
    const contains = { mode: 'contains' as const }
    expect(matchKeywords('model KX-900B please', ['kx-900'], contains)).not.toBeNull()
  })

  it('similar tolerates a typo in a long sentence', () => {
    const similar = { mode: 'similar' as const }
    const hit = matchKeywords(
      'hello sir what is the admision fees for next batch',
      ['admission fees'],
      similar,
    )
    expect(hit).not.toBeNull()
    expect(hit?.score).toBeGreaterThanOrEqual(0.8)
  })

  it('similar still refuses an unrelated sentence', () => {
    const similar = { mode: 'similar' as const }
    expect(
      matchKeywords('can you send me the location map', ['admission fees'], similar),
    ).toBeNull()
  })

  it('reports which keyword and which words matched', () => {
    const hit = matchKeywords('I want to know the fee structure', ['fee structure'], opts)
    expect(hit?.keyword).toBe('fee structure')
    expect(hit?.matched).toBe('fee structure')
  })

  it('matches a Malayalam word without the boundary bug', () => {
    // \b is defined over [A-Za-z0-9_], so a regex-boundary
    // implementation treats every Malayalam letter as a boundary and
    // matches anything at all.
    expect(matchKeywords('എനിക്ക് ഫീസ് അറിയണം', ['ഫീസ്'], opts)).not.toBeNull()
    expect(matchKeywords('എനിക്ക് വിലാസം അറിയണം', ['ഫീസ്'], opts)).toBeNull()
  })
})
