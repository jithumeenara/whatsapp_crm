import { describe, expect, it } from 'vitest'
import { profileFromMe } from './profile-from-me'

// Bug: an admin chose an agent's pages in Settings → Members (Dashboard,
// Leads, Contacts, Reports, Catalog, Inbox), the server saved them and
// /api/me returned them as allowed_pages — but the agent's menu showed
// the role default instead (Calls and AI Quality, no Reports). The
// browser built its profile from /api/me field by field and left
// allowed_pages out, so the menu never saw the choice and fell back.

const me = {
  id: 'p1',
  full_name: 'Pramod',
  email: '9061450540@agent.local',
  avatar_url: null,
  phone: null,
  phone_verified: false,
  email_verified: false,
  account_id: 'a1',
  account_role: 'agent',
  preferred_language: null,
  quick_links: [],
  quick_links_enabled: true,
  allowed_pages: ['/dashboard', '/leads', '/contacts', '/reports', '/catalog', '/inbox'],
}

describe('the profile the menu is drawn from', () => {
  it('keeps the pages the server says this person may open', () => {
    expect(profileFromMe(me).allowed_pages).toEqual([
      '/dashboard', '/leads', '/contacts', '/reports', '/catalog', '/inbox',
    ])
  })

  it('keeps an empty list — every page taken away — rather than dropping it', () => {
    expect(profileFromMe({ ...me, allowed_pages: [] }).allowed_pages).toEqual([])
  })

  it('leaves it undefined when the server sent none, so the menu waits instead of guessing', () => {
    const { allowed_pages: _drop, ...older } = me
    void _drop
    expect(profileFromMe(older).allowed_pages).toBeUndefined()
  })
})
