import crypto from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

/**
 * Bug (security audit 2026-10): every tenant's own Facebook app secret
 * (typed in under Settings → Facebook) was accepted as proof for *any*
 * Facebook/Instagram webhook. An account owner could sign an event naming
 * another business's Page id and post it into that business's Inbox —
 * running its automations and AI replies with its Page token. A tenant's
 * secret now vouches for that tenant's own account only.
 */

vi.mock('@/lib/whatsapp/webhook-secrets', () => ({ whatsappWebhookSecrets: () => Promise.resolve(['platform-secret']) }))
vi.mock('@/lib/db', async () => {
  const { encrypt } = await vi.importActual<typeof import('@/lib/whatsapp/encryption')>('@/lib/whatsapp/encryption')
  return {
    prisma: {
      $queryRaw: () =>
        Promise.resolve([
          { account_id: 'attacker', app_secret: 'attacker-secret' },
          { account_id: 'sealed-tenant', app_secret: encrypt('sealed-secret') },
        ]),
    },
  }
})

import { scopeAllows, socialWebhookScope } from './webhook-secrets'

const sign = (body: string, secret: string) => 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex')
const body = JSON.stringify({ object: 'page', entry: [{ id: 'victim-page' }] })

describe('Facebook/Instagram webhook — whose events a signature vouches for', () => {
  it('a platform secret vouches for every account', async () => {
    const scope = await socialWebhookScope(body, sign(body, 'platform-secret'), 'facebook')
    expect(scope && scopeAllows(scope, 'victim')).toBe(true)
  })

  it("a tenant's own secret vouches only for that tenant", async () => {
    const scope = await socialWebhookScope(body, sign(body, 'attacker-secret'), 'facebook')
    expect(scope).not.toBeNull()
    expect(scopeAllows(scope!, 'attacker')).toBe(true)
    expect(scopeAllows(scope!, 'victim')).toBe(false)
  })

  it('reads a sealed tenant secret', async () => {
    const scope = await socialWebhookScope(body, sign(body, 'sealed-secret'), 'instagram')
    expect(scope && scopeAllows(scope, 'sealed-tenant')).toBe(true)
  })

  it('turns away a wrong signature', async () => {
    expect(await socialWebhookScope(body, sign(body, 'guess'), 'facebook')).toBeNull()
  })
})
