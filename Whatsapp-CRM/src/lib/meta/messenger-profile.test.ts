import { describe, expect, it } from 'vitest'
import { cleanProfile, fieldsToClear, profileRequestBody, storedProfile } from './messenger-profile'

// The chat "front door" settings are rebuilt field by field before they
// reach Meta or the database: nothing extra, https links only, Meta's limits.

describe('cleaning the owner\'s chat starters', () => {
  it('keeps only the known fields', () => {
    const r = cleanProfile({
      ice_breakers: [{ question: ' Hours? ', payload: 'HOURS', extra: 'x' }],
      persistent_menu: [{ title: 'Site', type: 'web_url', url: 'https://example.com/a', webview_share_button: 'show' }],
      role: 'owner',
    }, 'instagram')
    expect(r).toEqual({ ok: true, value: { ice_breakers: [{ question: 'Hours?', payload: 'HOURS' }], persistent_menu: [{ title: 'Site', type: 'web_url', url: 'https://example.com/a' }], greeting: '', get_started: false } })
  })

  it.each([
    ['javascript:alert(1)'],
    ['http://example.com'],
    ['https://user:pass@example.com'],
    ['not a url'],
  ])('refuses the menu link %s', (url) => {
    const r = cleanProfile({ persistent_menu: [{ title: 'x', type: 'web_url', url }] }, 'facebook')
    expect(r.ok).toBe(false)
  })

  it('refuses too many, too long, wrong types and hidden characters', () => {
    expect(cleanProfile({ ice_breakers: Array(5).fill({ question: 'q', payload: 'p' }) }, 'instagram').ok).toBe(false)
    expect(cleanProfile({ ice_breakers: [{ question: 'q'.repeat(81), payload: 'p' }] }, 'instagram').ok).toBe(false)
    expect(cleanProfile({ ice_breakers: 'abc' }, 'instagram').ok).toBe(false)
    expect(cleanProfile({ persistent_menu: [{ title: 'a\u0000b', payload: 'p' }] }, 'instagram').ok).toBe(false)
    expect(cleanProfile({ greeting: 'g'.repeat(161) }, 'facebook').ok).toBe(false)
  })

  it('Messenger: a menu turns Get Started on (Meta needs it); Instagram never has greeting', () => {
    const fb = cleanProfile({ persistent_menu: [{ title: 'Help', payload: 'HELP' }], greeting: 'Hi' }, 'facebook')
    expect(fb.ok && fb.value.get_started).toBe(true)
    const ig = cleanProfile({ greeting: 'Hi', get_started: true }, 'instagram')
    expect(ig.ok && ig.value).toMatchObject({ greeting: '', get_started: false })
  })
})

describe('the request to Meta', () => {
  it('Messenger body has locale-wrapped lists, a postback menu and Get Started', () => {
    const r = cleanProfile({ ice_breakers: [{ question: 'Q', payload: 'P' }], persistent_menu: [{ title: 'Help', payload: 'HELP' }], greeting: 'Hi' }, 'facebook')
    if (!r.ok) throw new Error(r.error)
    expect(profileRequestBody(r.value, 'facebook')).toEqual({
      ice_breakers: [{ locale: 'default', call_to_actions: [{ question: 'Q', payload: 'P' }] }],
      persistent_menu: [{ locale: 'default', composer_input_disabled: false, call_to_actions: [{ type: 'postback', title: 'Help', payload: 'HELP' }] }],
      get_started: { payload: 'GET_STARTED' },
      greeting: [{ locale: 'default', text: 'Hi' }],
    })
    expect(fieldsToClear(r.value, 'facebook')).toEqual([])
  })
  it('emptied fields are cleared at Meta, never sent as empty lists', () => {
    const r = cleanProfile({}, 'facebook')
    if (!r.ok) throw new Error(r.error)
    expect(profileRequestBody(r.value, 'facebook')).toEqual({})
    expect(fieldsToClear(r.value, 'facebook')).toEqual(['ice_breakers', 'persistent_menu', 'greeting', 'get_started'])
  })
  it('an old stored row with junk reads back empty, not as a crash', () => {
    expect(storedProfile({ ice_breakers: 'junk' }, 'instagram').ice_breakers).toEqual([])
    expect(storedProfile(null, 'facebook').persistent_menu).toEqual([])
  })
})
