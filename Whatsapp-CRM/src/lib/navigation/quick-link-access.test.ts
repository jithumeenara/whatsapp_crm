import { describe, expect, it } from 'vitest'
import { visibleQuickLinks } from './quick-link-access'

// Bug (found with the menu bug in profile-from-me.test.ts): dashboard
// quick links were filtered by the role's default pages, not by the pages
// an admin chose for this person. An agent given Reports had no Reports
// link; one whose Calls page was taken away still had a Calls link that
// the server then refused.

const links = [
  { href: '/reports', agentAllowed: false },
  { href: '/calls', agentAllowed: true },
  { href: '/inbox', agentAllowed: true },
  { href: '/data/t1', agentAllowed: false },
]

describe('quick links follow the pages chosen for the person', () => {
  it('shows a granted page and hides a withheld one, whatever the role default says', () => {
    const shown = visibleQuickLinks(links, { isAgent: true, allowedPages: ['/reports', '/inbox'] })
    expect(shown.map((l) => l.href)).toEqual(['/reports', '/inbox'])
  })

  it('a Data Store table link follows the Data Store page', () => {
    expect(visibleQuickLinks(links, { isAgent: true, allowedPages: ['/data'] }).map((l) => l.href)).toEqual(['/data/t1'])
    expect(visibleQuickLinks(links, { isAgent: true, allowedPages: ['/inbox'] }).map((l) => l.href)).toEqual(['/inbox'])
  })

  it('falls back to the role default only while the chosen pages are not known yet', () => {
    expect(visibleQuickLinks(links, { isAgent: true }).map((l) => l.href)).toEqual(['/calls', '/inbox'])
    expect(visibleQuickLinks(links, { isAgent: false }).map((l) => l.href)).toEqual(['/reports', '/calls', '/inbox', '/data/t1'])
  })
})
