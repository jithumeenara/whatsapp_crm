/**
 * The number's two-step verification PIN, kept so a later Quick Connect of
 * the same number registers with the PIN Meta already has.
 *
 * Stored encrypted in whatsapp_config.two_step_pin (migration 182), read
 * and written with plain SQL so a database without the column keeps
 * working: then a reconnect falls back to setting a new PIN (registerWithPin).
 * Never returned to a browser and never logged.
 */

import { randomInt } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { isPinMismatch, registerPhoneNumber, setTwoStepPin } from '@/lib/whatsapp/meta-api'

/** crypto.randomInt is uniform — no modulo bias (same as lib/auth/mfa.ts). */
export function newPin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export async function storedPin(accountId: string, phoneNumberId: string): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ pin: string | null }>>(
      Prisma.sql`SELECT two_step_pin AS pin FROM whatsapp_config WHERE account_id = ${accountId}::uuid AND phone_number_id = ${phoneNumberId} LIMIT 1`,
    )
    const sealed = rows[0]?.pin
    if (!sealed) return null
    const pin = decrypt(sealed)
    return /^\d{6}$/.test(pin) ? pin : null
  } catch {
    return null
  }
}

export async function savePin(accountId: string, phoneNumberId: string, pin: string): Promise<void> {
  try {
    await prisma.$executeRaw(
      Prisma.sql`UPDATE whatsapp_config SET two_step_pin = ${encrypt(pin)} WHERE account_id = ${accountId}::uuid AND phone_number_id = ${phoneNumberId}`,
    )
  } catch (err) {
    // No column yet (migration 182): the next reconnect sets a new PIN.
    console.warn('[two-step-pin] not saved:', err instanceof Error ? err.message : err)
  }
}

/**
 * Register the number. Uses the PIN kept from last time; on a PIN mismatch
 * (the number was registered before with a PIN nobody kept) sets a new PIN
 * with the business token and registers once more. Returns the PIN that
 * worked, for savePin.
 */
export async function registerWithPin(args: { accountId: string; phoneNumberId: string; accessToken: string }): Promise<string> {
  const kept = await storedPin(args.accountId, args.phoneNumberId)
  const pin = kept ?? newPin()
  try {
    await registerPhoneNumber({ phoneNumberId: args.phoneNumberId, accessToken: args.accessToken, pin })
    return pin
  } catch (err) {
    if (!isPinMismatch(err)) throw err
    const fresh = newPin()
    await setTwoStepPin({ phoneNumberId: args.phoneNumberId, accessToken: args.accessToken, pin: fresh })
    await registerPhoneNumber({ phoneNumberId: args.phoneNumberId, accessToken: args.accessToken, pin: fresh })
    return fresh
  }
}
