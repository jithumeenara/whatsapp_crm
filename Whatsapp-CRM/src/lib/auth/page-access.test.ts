import { describe, it, expect } from 'vitest'
import {
  grantablePages,
  defaultPagesFor,
  parsePageAccess,
  pagesFor,
  canOpenPath,
  firstAllowedPage,
} from './page-access'

describe('grantablePages', () => {
  it('comes from the navigation, so the two cannot drift', () => {
    const pages = grantablePages()
    expect(pages).toContain('/dashboard')
    expect(pages).toContain('/leads')
    expect(pages).toContain('/reports')
    expect(new Set(pages).size).toBe(pages.length)
  })
})

describe('the rule that cannot be switched off', () => {
  // If an owner's pages could be taken away, one wrong click removes
  // the only account able to put them back, and the way out is a
  // database console. Every one of these has to hold whatever is
  // stored against them.
  for (const role of ['owner', 'admin'] as const) {
    it(`${role} keeps every page even when the column says otherwise`, () => {
      expect(pagesFor(role, []).size).toBe(grantablePages().length)
      expect(pagesFor(role, ['/dashboard']).size).toBe(grantablePages().length)
      expect(canOpenPath(role, [], '/reports')).toBe(true)
      expect(canOpenPath(role, ['/dashboard'], '/broadcasts')).toBe(true)
    })
  }

  it('a supervisor can be restricted — they are not the last way in', () => {
    expect(canOpenPath('supervisor', ['/dashboard'], '/reports')).toBe(false)
  })
})

describe('defaultPagesFor', () => {
  it('changes nothing for anybody until an admin decides', () => {
    // Turning this feature on must not move a single page for a single
    // person. Supervisors and above saw everything; agents saw what
    // agentAllowed marked.
    expect(defaultPagesFor('supervisor')).toEqual(grantablePages())
    expect(defaultPagesFor('agent')).toContain('/inbox')
    expect(defaultPagesFor('agent')).not.toContain('/broadcasts')
    expect(defaultPagesFor('viewer')).not.toContain('/reports')
  })
})

describe('parsePageAccess', () => {
  it('tells "not decided" apart from "decided: nothing"', () => {
    // These must not collapse into each other. null restores the role
    // default; an empty array is an admin who took every page away, and
    // quietly handing the defaults back would undo their decision.
    expect(parsePageAccess(null)).toBeNull()
    expect(parsePageAccess(undefined)).toBeNull()
    expect(parsePageAccess('/leads')).toBeNull()
    expect(parsePageAccess({ pages: ['/leads'] })).toBeNull()
    expect(parsePageAccess([])).toEqual([])
  })

  it('drops anything that is not a page', () => {
    expect(parsePageAccess(['/leads', '/not-a-page', 42, null, '/inbox']))
      .toEqual(['/leads', '/inbox'])
  })

  it('an empty array really does mean no pages', () => {
    expect(pagesFor('agent', []).size).toBe(0)
    expect(canOpenPath('agent', [], '/leads')).toBe(false)
    expect(firstAllowedPage('agent', [])).toBeNull()
  })
})

describe('canOpenPath', () => {
  it('a granted list covers its own detail pages', () => {
    // Withholding a list while leaving its detail pages open is a
    // permission that only looks like one.
    const stored = ['/leads']
    expect(canOpenPath('agent', stored, '/leads')).toBe(true)
    expect(canOpenPath('agent', stored, '/leads/abc-123')).toBe(true)
  })

  it('does not mistake a similar name for a child', () => {
    // A prefix test written as startsWith('/leads') would treat
    // /leadsomething as part of the /leads grant. It is not — it is not
    // a page at all, so the answer must not depend on whether /leads
    // was granted. (Being unrecognised, it falls through to this
    // function's "not my business" case and then to a 404.)
    const withLeads = canOpenPath('agent', ['/leads'], '/leadsomething')
    const without = canOpenPath('agent', ['/dashboard'], '/leadsomething')
    expect(withLeads).toBe(without)
  })

  it('refuses a page that was not granted', () => {
    expect(canOpenPath('agent', ['/dashboard'], '/reports')).toBe(false)
    expect(canOpenPath('agent', ['/dashboard'], '/reports/anything')).toBe(false)
  })

  it('leaves alone the addresses this is not about', () => {
    // /settings and an invitation link are protected by their own
    // rules. Answering "no" for them here would lock people out of
    // screens no admin chose to restrict.
    expect(canOpenPath('agent', ['/dashboard'], '/settings')).toBe(true)
    expect(canOpenPath('agent', ['/dashboard'], '/join/some-token')).toBe(true)
    expect(canOpenPath('agent', [], '/settings')).toBe(true)
  })

  it('prefers the more specific page when two could match', () => {
    // /data and /data/<id> are both real nav entries.
    expect(canOpenPath('agent', ['/data'], '/data/table-1')).toBe(true)
  })

  it('falls back to the role default when nothing is stored', () => {
    expect(canOpenPath('agent', null, '/inbox')).toBe(true)
    expect(canOpenPath('agent', null, '/broadcasts')).toBe(false)
    expect(canOpenPath('supervisor', null, '/broadcasts')).toBe(true)
  })
})

describe('firstAllowedPage', () => {
  it('sends somebody to a page they can actually open', () => {
    // Sending everybody to /dashboard is wrong for the one person whose
    // dashboard was taken away, and a redirect loop is worse than a
    // plain refusal.
    expect(firstAllowedPage('agent', ['/inbox'])).toBe('/inbox')
    expect(firstAllowedPage('agent', ['/leads', '/inbox'])).toBe('/leads')
  })

  it('has no answer when there is nowhere to send them', () => {
    expect(firstAllowedPage('agent', [])).toBeNull()
  })
})
