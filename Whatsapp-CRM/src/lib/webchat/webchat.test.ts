import { describe, expect, it } from 'vitest'
import { frameAncestors, hostOf, isHostAllowed, normalizeDomain, normalizeDomainList } from './domains'
import {
  hashToken, isPublicKeyShape, isSessionTokenShape, newPublicKey, newSessionToken, newVisitorId, visitorPhone,
} from './tokens'
import { cleanVisitorText, toVisitorMessage } from './public-message'
import { parseWidgetPatch, installSnippet } from './settings'
import { publicWidgetConfig } from './widget-config'
import { isPlaceholderPhone, usablePhone } from '@/lib/contacts/validate'
import { buildLanguageBlock } from '@/lib/ai/language'
import { customerToolDeclarations } from '@/lib/ai/customer-tools'

describe('allowed domains', () => {
  it('normalises what people type', () => {
    expect(normalizeDomain('https://www.Example.com/contact?x=1')).toBe('www.example.com')
    expect(normalizeDomain(' example.com ')).toBe('example.com')
    expect(normalizeDomain('*.example.com')).toBe('*.example.com')
    expect(normalizeDomain('localhost:5500')).toBe('localhost:5500')
    expect(normalizeDomain('not a domain')).toBeNull()
    expect(normalizeDomain('javascript:alert(1)')).toBeNull()
    expect(normalizeDomain('intranet')).toBeNull()
    expect(normalizeDomain('-bad-.com')).toBeNull()
  })

  it('reports entries that are not hostnames', () => {
    const { domains, invalid } = normalizeDomainList('example.com\nbad domain\nexample.com\n*.shop.in')
    expect(domains).toEqual(['example.com', '*.shop.in'])
    expect(invalid).toEqual(['bad', 'domain'])
  })

  it('matches the site, its www form and wildcard subdomains — nothing else', () => {
    const list = ['example.com', '*.shop.in', 'localhost:5500']
    expect(isHostAllowed('example.com', list)).toBe(true)
    expect(isHostAllowed('www.example.com', list)).toBe(true)
    expect(isHostAllowed('blog.example.com', list)).toBe(false)
    expect(isHostAllowed('evil-example.com', list)).toBe(false)
    expect(isHostAllowed('example.com.evil.net', list)).toBe(false)
    expect(isHostAllowed('a.shop.in', list)).toBe(true)
    expect(isHostAllowed('shop.in', list)).toBe(true)
    expect(isHostAllowed('notshop.in', list)).toBe(false)
    expect(isHostAllowed('localhost:5500', list)).toBe(true)
    expect(isHostAllowed('localhost:3000', list)).toBe(false)
    expect(isHostAllowed(null, list)).toBe(false)
  })

  it('treats an empty list as anywhere, and says so in frame-ancestors', () => {
    expect(isHostAllowed('anything.com', [])).toBe(true)
    expect(frameAncestors([])).toBe('*')
  })

  it('builds frame-ancestors from the list', () => {
    const value = frameAncestors(['example.com', '*.shop.in'])
    expect(value).toContain('https://example.com')
    expect(value).toContain('https://www.example.com')
    expect(value).toContain('https://*.shop.in')
    expect(value).not.toContain('*.example.com')
  })

  it('reads hosts only from http(s) URLs', () => {
    expect(hostOf('https://Example.com:8443/x')).toBe('example.com:8443')
    expect(hostOf('file:///etc/passwd')).toBeNull()
    expect(hostOf('nonsense')).toBeNull()
  })
})

describe('tokens', () => {
  it('makes keys and tokens of the shape the routes accept', () => {
    const key = newPublicKey()
    expect(isPublicKeyShape(key)).toBe(true)
    expect(isPublicKeyShape('wk_short')).toBe(false)
    expect(isPublicKeyShape("wk_aaaaaaaaaaaaaaaaaaaaaaa'")).toBe(false)
    const token = newSessionToken()
    expect(isSessionTokenShape(token)).toBe(true)
    expect(isSessionTokenShape(token + 'x')).toBe(false)
    expect(isSessionTokenShape(123)).toBe(false)
  })

  it('stores only a hash of the session token', () => {
    const token = newSessionToken()
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashToken(token)).not.toContain(token)
  })

  it('never puts a digit in a visitor id, so it cannot match a phone suffix', () => {
    for (let i = 0; i < 200; i++) expect(newVisitorId()).toMatch(/^[a-z]{28}$/)
    expect(isPlaceholderPhone(visitorPhone(newVisitorId()))).toBe(true)
    expect(isPlaceholderPhone('email:a@b.com')).toBe(true)
    expect(isPlaceholderPhone('+919876543210')).toBe(false)
  })
})

describe('what a visitor may see', () => {
  const base = { id: 'm1', content_text: 'Hello', created_at: new Date('2026-10-12T10:00:00Z') }

  it('hides internal notes and unknown senders', () => {
    expect(toVisitorMessage({ ...base, sender_type: 'system' })).toBeNull()
    expect(toVisitorMessage({ ...base, sender_type: 'note' })).toBeNull()
    expect(toVisitorMessage({ ...base, sender_type: 'customer', deleted_at: new Date() })).toBeNull()
  })

  it('names fields one by one — nothing private rides along', () => {
    const row = { ...base, sender_type: 'bot', ai_meta: { sources: ['secret'] }, sender_id: 'agent-1' }
    const visible = toVisitorMessage(row)!
    expect(visible.sender).toBe('bot')
    expect(Object.keys(visible).sort()).toEqual(
      ['buttons', 'created_at', 'id', 'link', 'media_name', 'media_type', 'media_url', 'sender', 'text'].sort(),
    )
    expect(JSON.stringify(visible)).not.toContain('secret')
  })

  it('drops non-https media and links', () => {
    const visible = toVisitorMessage({
      ...base,
      sender_type: 'agent',
      media_url: '/api/files/private.pdf',
      web_meta: { link: { label: 'x', url: 'javascript:alert(1)' }, buttons: [{ id: 'a', title: 'Yes' }, { id: '', title: 'No' }] },
    })!
    expect(visible.media_url).toBeNull()
    expect(visible.link).toBeNull()
    expect(visible.buttons).toEqual([{ id: 'a', title: 'Yes' }])
  })

  it('cleans what a visitor types', () => {
    expect(cleanVisitorText('  hi\u0000 there\n ')).toBe('hi there')
    expect(cleanVisitorText('   ')).toBeNull()
    expect(cleanVisitorText('x'.repeat(2001))).toBeNull()
    expect(cleanVisitorText(42)).toBeNull()
  })
})

describe('widget settings', () => {
  it('accepts valid fields and refuses bad ones', () => {
    expect(parseWidgetPatch({ primary_color: '#ABCDEF', position: 'left', allowed_domains: ['Example.com'] })).toEqual({
      ok: true,
      patch: { primary_color: '#abcdef', position: 'left', allowed_domains: ['example.com'] },
    })
    expect(parseWidgetPatch({ primary_color: 'red' }).ok).toBe(false)
    expect(parseWidgetPatch({ logo_url: 'http://insecure.com/x.png' }).ok).toBe(false)
    expect(parseWidgetPatch({ allowed_domains: ['bad domain'] }).ok).toBe(false)
    expect(parseWidgetPatch({ title: '' }).ok).toBe(false)
    expect(parseWidgetPatch({ daily_ai_limit: -1 }).ok).toBe(false)
    expect(parseWidgetPatch({ enabled: 'yes' }).ok).toBe(false)
  })

  it('keeps the allowed-domain list and the limit out of the public config', () => {
    const config = publicWidgetConfig({
      id: 'w', account_id: 'acc', user_id: 'u', public_key: 'wk_x', enabled: true, name: 'n', title: 't',
      welcome_message: 'hi', primary_color: 'url(evil)', position: 'top', logo_url: 'javascript:x',
      allowed_domains: ['secret.example'], allow_handoff: true, daily_ai_limit: 5,
      last_seen_at: null, last_seen_origin: null, created_at: new Date(), updated_at: new Date(),
    })
    expect(config).toEqual({
      key: 'wk_x', title: 't', welcome_message: 'hi', primary_color: '#4f46e5', position: 'right', logo_url: null, allow_handoff: true,
    })
  })

  it('builds the snippet from the origin it was served on', () => {
    expect(installSnippet('https://crm.example.com', 'wk_abc')).toBe(
      '<script src="https://crm.example.com/webchat/widget.js" data-widget="wk_abc" defer></script>',
    )
  })
})

describe('assistant tools for an anonymous visitor', () => {
  const names = (anonymous: boolean) =>
    customerToolDeclarations({
      accountId: 'a', contactId: 'c', conversationId: 'v', userId: 'u', calendarBooking: true, anonymous,
    }).map((d) => d.name)

  it('withholds registrations and bookings, keeps the rest', () => {
    const known = names(false)
    const visitor = names(true)
    expect(known).toContain('book_appointment')
    expect(visitor).not.toContain('book_appointment')
    expect(visitor).not.toContain('submit_registration')
    expect(visitor).not.toContain('add_registration_details')
    expect(visitor).toContain('check_availability')
    expect(visitor).toContain('contact_handed_over')
  })

  it('offers save_my_details only until the visitor has given a number', () => {
    expect(names(true)).toContain('save_my_details')
    expect(names(false)).not.toContain('save_my_details')
  })
})

describe('a website visitor with a number', () => {
  it('uses their own phone, else the number they typed, never a placeholder', () => {
    expect(usablePhone({ phone: '+919876543210', alternate_phone: '+911111111111' })).toBe('+919876543210')
    expect(usablePhone({ phone: 'web:abcdefgh', alternate_phone: '+919876543210' })).toBe('+919876543210')
    expect(usablePhone({ phone: 'web:abcdefgh', alternate_phone: null })).toBeNull()
    expect(usablePhone({ phone: 'email:a@b.com', alternate_phone: '' })).toBeNull()
    expect(usablePhone(null)).toBeNull()
  })
})

describe('the language a customer chose', () => {
  it('reaches the assistant, and their own script still wins', () => {
    const chosen = buildLanguageBlock('ok', 'Malayalam')
    expect(chosen).toContain('The customer chose Malayalam')
    expect(buildLanguageBlock('ok')).not.toContain('chose')
    const typed = buildLanguageBlock('നവംബറിലെ പരിശീലനം', 'English')
    expect(typed).toContain('The customer chose English')
    expect(typed).toContain('Malayalam script')
  })
})
