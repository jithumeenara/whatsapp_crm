/**
 * Changes that widen Admin Chat access (turning it on, adding an admin,
 * widening someone's hours or scope) need the person making them to type
 * their own authenticator code again — a signed-in browser left open is
 * not enough.
 */

import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { matchTotpStep } from '@/lib/auth/totp'
import { checkRateLimit } from '@/lib/rate-limit'

export class StepUpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'StepUpError'
  }
}

export async function requireStepUp(userId: string, code: unknown): Promise<void> {
  const limit = checkRateLimit(`admin-chat-stepup:${userId}`, { limit: 8, windowMs: 15 * 60_000 })
  if (!limit.success) throw new StepUpError('Too many tries. Wait a few minutes and try again.', 429)
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { mfa_method: true, totp_secret: true } })
  if (user?.mfa_method !== 'totp' || !user.totp_secret) {
    throw new StepUpError('Turn on the authenticator app for your own login first (Profile → Security). Admin Chat settings need it.', 403)
  }
  const clean = typeof code === 'string' ? code.replace(/\s/g, '') : ''
  if (!/^\d{6}$/.test(clean)) throw new StepUpError('Enter the 6-digit code from your authenticator app.', 400)
  if (matchTotpStep(decrypt(user.totp_secret), clean) === null) throw new StepUpError('That authenticator code is not right. Try the current one.', 400)
}
