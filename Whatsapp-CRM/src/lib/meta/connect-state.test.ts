import { beforeAll, describe, expect, it } from 'vitest'
import crypto from 'crypto'
import { appSecretProof, newNonce, signConnectState, verifyConnectState, CONNECT_STATE_TTL_MS } from './connect-state'

beforeAll(() => { process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-for-connect-state' })

describe('Connect Facebook & Instagram: the signed state', () => {
  const nonce = newNonce()
  const state = () => signConnectState({ accountId: 'acc-1', userId: 'owner-1', nonce })

  it('round-trips for the same browser (same nonce cookie)', () => {
    expect(verifyConnectState(state(), nonce)).toMatchObject({ accountId: 'acc-1', userId: 'owner-1' })
  })

  it("is refused in another browser (login CSRF): the nonce cookie doesn't match or is missing", () => {
    expect(verifyConnectState(state(), newNonce())).toBeNull()
    expect(verifyConnectState(state(), undefined)).toBeNull()
  })

  it('is refused when tampered with (another workspace written in)', () => {
    const [enc, sig] = state().split('.')
    const body = JSON.parse(Buffer.from(enc, 'base64url').toString())
    body.accountId = 'acc-2'
    const forged = `${Buffer.from(JSON.stringify(body)).toString('base64url')}.${sig}`
    expect(verifyConnectState(forged, nonce)).toBeNull()
  })

  it('expires after 10 minutes', () => {
    const t0 = Date.now()
    const s = signConnectState({ accountId: 'a', userId: 'u', nonce }, t0)
    expect(verifyConnectState(s, nonce, t0 + CONNECT_STATE_TTL_MS - 1)).not.toBeNull()
    expect(verifyConnectState(s, nonce, t0 + CONNECT_STATE_TTL_MS + 1)).toBeNull()
  })

  it('garbage is refused without throwing', () => {
    for (const bad of [null, '', 'x', 'a.b', 'a'.repeat(5000), 42]) expect(verifyConnectState(bad, nonce)).toBeNull()
  })

  it('appsecret_proof is HMAC-SHA256 of the token with the app secret', () => {
    expect(appSecretProof('EAAtoken', 'shh')).toBe(crypto.createHmac('sha256', 'shh').update('EAAtoken').digest('hex'))
  })
})
