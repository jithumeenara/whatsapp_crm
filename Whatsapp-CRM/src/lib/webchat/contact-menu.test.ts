import { describe, expect, it } from 'vitest'
import { normalizePhone, parseCallLinks, parseWhatsAppSelection, publicContactMenu } from './contact-menu'

describe('phone numbers for the contact menu', () => {
  it('keeps digits only, with the country code', () => {
    expect(normalizePhone('+91 85900 55117')).toBe('918590055117')
    expect(normalizePhone('0091-85900-55117')).toBe('918590055117')
    expect(normalizePhone('(044) 2345 6789')).toBe('04423456789')
  })

  it('refuses what is not a phone number', () => {
    expect(normalizePhone('12345')).toBeNull()
    expect(normalizePhone('call me')).toBeNull()
    expect(normalizePhone('9'.repeat(16))).toBeNull()
    expect(normalizePhone('javascript:alert(1)')).toBeNull()
  })
})

describe('call numbers typed in Settings', () => {
  it('cleans each one and fills in a label', () => {
    expect(parseCallLinks([{ label: ' Office ', phone: '+91 471 234 5678' }, { label: '', phone: '+91 85900 55117' }])).toEqual({
      ok: true,
      links: [
        { label: 'Office', phone: '914712345678' },
        { label: 'Call us', phone: '918590055117' },
      ],
    })
  })

  it('says which number is wrong', () => {
    const r = parseCallLinks([{ label: 'Desk', phone: '123' }])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('Desk')
  })

  it('takes at most five', () => {
    expect(parseCallLinks(Array.from({ length: 6 }, () => ({ label: 'x', phone: '+918590055117' }))).ok).toBe(false)
  })
})

describe('WhatsApp numbers chosen in Settings', () => {
  const id = '11111111-2222-4333-8444-555555555555'
  it('takes config ids and labels, nothing else', () => {
    expect(parseWhatsAppSelection([{ config_id: id, label: ' Admissions ', phone: '999' }])).toEqual({
      ok: true,
      selection: [{ config_id: id, label: 'Admissions' }],
    })
  })

  it('refuses ids that are not ids', () => {
    expect(parseWhatsAppSelection([{ config_id: 'x; drop', label: 'a' }]).ok).toBe(false)
  })
})

describe('what the website receives', () => {
  const base = {
    contact_menu_enabled: true,
    whatsapp_links: [{ config_id: 'c', label: 'Admissions', phone: '918590055117' }],
    call_links: [{ label: 'Office', phone: '914712345678' }],
    whatsapp_prefill: 'Hi, I came from your website',
  }

  it('gives the numbers to show, without internal ids', () => {
    expect(publicContactMenu(base)).toEqual({
      whatsapp: [{ label: 'Admissions', phone: '918590055117' }],
      call: [{ label: 'Office', phone: '914712345678' }],
      prefill: 'Hi, I came from your website',
    })
  })

  it('is off when switched off, or when there is nothing but the bot', () => {
    expect(publicContactMenu({ ...base, contact_menu_enabled: false })).toBeNull()
    expect(publicContactMenu({ ...base, whatsapp_links: [], call_links: [] })).toBeNull()
  })

  it('drops a stored row that is not a clean number', () => {
    const menu = publicContactMenu({ ...base, call_links: [{ label: '<b>x</b>', phone: 'tel:evil' }, 'junk'] })
    expect(menu?.call).toEqual([])
  })
})
