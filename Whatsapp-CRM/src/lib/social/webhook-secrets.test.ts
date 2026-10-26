import crypto from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The Instagram and Facebook webhooks took any POST: anyone who knew the
 * URL could put messages into an account's Inbox. Now only a body signed
 * with a known Meta app secret is processed.
 */

vi.mock('@/lib/whatsapp/webhook-secrets', () => ({ whatsappWebhookSecrets: () => Promise.resolve(['platform-secret']) }))
vi.mock('@/lib/db', () => ({
  prisma: { $queryRaw: () => Promise.resolve([{ app_secret: 'tenant-fb-secret' }]) },
}))

import { socialWebhookAllowed } from './webhook-secrets'

const sign = (body: string, secret: string) => 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex')
const body = JSON.stringify({ object: 'instagram', entry: [] })

describe('Instagram/Facebook webhook signature', () => {
  afterEach(() => {
    delete process.env.META_SOCIAL_SIGNATURE
  })

  it('accepts a body signed with the platform app secret', async () => {
    expect(await socialWebhookAllowed(body, sign(body, 'platform-secret'), 'instagram')).toBe(true)
  })

  it("accepts a body signed with a tenant's own Facebook app secret", async () => {
    expect(await socialWebhookAllowed(body, sign(body, 'tenant-fb-secret'), 'facebook')).toBe(true)
  })

  it('turns away an unsigned or wrongly signed body', async () => {
    expect(await socialWebhookAllowed(body, null, 'instagram')).toBe(false)
    expect(await socialWebhookAllowed(body, sign(body, 'guess'), 'instagram')).toBe(false)
  })

  it('observe mode lets it through while a secret is being fixed', async () => {
    process.env.META_SOCIAL_SIGNATURE = 'observe'
    expect(await socialWebhookAllowed(body, null, 'instagram')).toBe(true)
  })
})
