import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: {} }))

import { GOOGLE_SERVICES, scopesFor, serviceById, serviceState, servicesGranted } from './services'
import { googleAuthorizeUrl, normaliseScopes } from './oauth'

const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file'

describe('the services hub', () => {
  it('asks once for the union of the chosen services, plus sign-in', () => {
    expect(scopesFor(['sheets', 'drive'])).toEqual(['openid', 'email', DRIVE_FILE])
  })

  it('switches on only the services whose every scope Google granted', () => {
    expect(servicesGranted(['openid', 'email', DRIVE_FILE])).toEqual(['sheets', 'drive'])
    expect(servicesGranted(['openid', 'email'])).toEqual([])
  })

  it('never treats a coming-soon service as granted', () => {
    expect(servicesGranted(['https://www.googleapis.com/auth/gmail.send'])).not.toContain('gmail_send')
  })

  it('shows a card as missing permission when a scope was taken away', () => {
    const sheets = serviceById('sheets')!
    expect(serviceState(sheets, { connected: true, granted_scopes: [DRIVE_FILE], enabled_services: ['sheets'] })).toBe('connected')
    expect(serviceState(sheets, { connected: true, granted_scopes: ['openid'], enabled_services: ['sheets'] })).toBe('missing_permission')
    expect(serviceState(sheets, { connected: true, granted_scopes: [DRIVE_FILE], enabled_services: [] })).toBe('off')
    expect(serviceState(sheets, null)).toBe('off')
    expect(serviceState(serviceById('calendar')!, null)).toBe('coming')
  })

  it('gives every service at least one scope and a feature line', () => {
    for (const s of GOOGLE_SERVICES) {
      expect(s.scopes.length).toBeGreaterThan(0)
      expect(s.features.length).toBeGreaterThan(0)
    }
  })

  it('reads Google\'s long form of "email" as the same permission', () => {
    expect(normaliseScopes(`openid https://www.googleapis.com/auth/userinfo.email ${DRIVE_FILE}`)).toEqual(['openid', 'email', DRIVE_FILE])
  })

  it('adds services to the connected account rather than asking which account', () => {
    const url = new URL(googleAuthorizeUrl({
      clientId: '123456789012-abc.apps.googleusercontent.com',
      redirectUri: 'https://crm.example.com/api/google/callback',
      state: 's',
      challenge: 'c',
      scopes: scopesFor(['sheets']),
      loginHint: 'office@example.com',
    }))
    expect(url.searchParams.get('login_hint')).toBe('office@example.com')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('include_granted_scopes')).toBe('true')
  })
})
