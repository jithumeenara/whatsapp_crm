import { describe, expect, it } from 'vitest'
import { cleanConfigFields } from './config-fields'

// Token-paste form fields are checked one by one before they are stored.

const spec = { access_token: 'token', page_id: 'id', app_secret: 'app_secret', verify_token: 'verify_token' } as const

describe('connection form fields', () => {
  it('trims good values; empty or missing becomes empty', () => {
    expect(cleanConfigFields({ access_token: ' EAAabc ', page_id: '1001', verify_token: 'v' }, spec))
      .toEqual({ ok: true, value: { access_token: 'EAAabc', page_id: '1001', app_secret: '', verify_token: 'v' } })
  })
  it('the masked placeholder passes through as "keep the saved value"', () => {
    const r = cleanConfigFields({ app_secret: '••••••••••••••••' }, spec)
    expect(r.ok && r.value.app_secret).toBe('••••••••••••••••')
  })
  it.each([
    [{ page_id: '../me/accounts' }, /page_id must be digits/],
    [{ page_id: 1001 }, /page_id must be text/],
    [{ access_token: { $ne: null } }, /access_token must be text/],
    [{ access_token: 'EAA abc' }, /spaces/],
    [{ app_secret: "x' OR 1=1" }, /letters and digits/],
    [{ verify_token: 'x'.repeat(201) }, /too long/],
  ])('refuses %o', (body, msg) => {
    const r = cleanConfigFields(body as Record<string, unknown>, spec)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(msg)
  })
})
