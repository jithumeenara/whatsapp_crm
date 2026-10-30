import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { parseServiceAccount, getAccessToken, clearTokenCache } from './google-auth'

const pem = () =>
  generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

const saJson = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'service_account', client_email: 'tts@victim.iam.gserviceaccount.com', private_key: pem(), ...over })

// Security audit A9-03 / A9-04: an account's uploaded service-account JSON.
describe('parseServiceAccount — token_uri', () => {
  it('ignores a token_uri that is not Google’s token endpoint', () => {
    const sa = parseServiceAccount(saJson({ token_uri: 'http://169.254.169.254/latest/meta-data/' }))
    expect(sa?.token_uri).toBe('https://oauth2.googleapis.com/token')
  })
  it('keeps Google’s own token endpoint', () => {
    const sa = parseServiceAccount(saJson({ token_uri: 'https://oauth2.googleapis.com/token' }))
    expect(sa?.token_uri).toBe('https://oauth2.googleapis.com/token')
  })
})

describe('getAccessToken — cache', () => {
  beforeEach(() => clearTokenCache())
  afterEach(() => vi.unstubAllGlobals())

  it('does not hand one account’s token to another JSON naming the same client_email', async () => {
    const victim = parseServiceAccount(saJson())!
    // Same public client_email, attacker's own key.
    const attacker = parseServiceAccount(saJson())!
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: 'victim-token', expires_in: 3600 }))
      .mockResolvedValueOnce(Response.json({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await getAccessToken('scope', victim)).toBe('victim-token')
    await expect(getAccessToken('scope', attacker)).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('still reuses a token for the same credentials', async () => {
    const sa = parseServiceAccount(saJson())!
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ access_token: 't', expires_in: 3600 }))
    vi.stubGlobal('fetch', fetchMock)
    await getAccessToken('scope', sa)
    await getAccessToken('scope', sa)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
