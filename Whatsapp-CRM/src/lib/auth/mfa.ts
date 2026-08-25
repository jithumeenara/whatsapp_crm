/**
 * Login MFA challenge lifecycle — shared by the login-time flow
 * (/api/auth/mfa/start + verify, consumed by auth.ts's authorize()) and
 * account enrollment (/api/account/mfa/enroll/*, which confirms a new
 * phone number or authenticator app BEFORE actually turning MFA on).
 */
import { prisma } from "@/lib/db"
import bcrypt from "bcryptjs"
import crypto from "crypto"
import { decrypt } from "@/lib/whatsapp/encryption"
import { sendSmsText } from "@/lib/messaging/channels/sms"
import { sendTemplateMessage } from "@/lib/whatsapp/meta-api"
import { verifyTotp } from "@/lib/auth/totp"
import { isMessageTemplate } from "@/lib/whatsapp/template-row-guard"

export type MfaMethod = "sms" | "whatsapp" | "totp"
export type MfaPurpose = "login" | "enroll"

const CODE_TTL_MS = 5 * 60_000 // 5 minutes
const MAX_ATTEMPTS = 5

function generateOtpCode(): string {
  // crypto.randomInt is uniform (unlike Math.random-based mod bias) and
  // cryptographically sourced — appropriate for a security code.
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0")
}

/** Resolves the account a user's Profile belongs to — needed to load that
 *  account's WhatsApp/SMS config for OTP delivery. */
async function resolveAccountId(userId: string): Promise<string | null> {
  const profile = await prisma.profile.findUnique({ where: { user_id: userId }, select: { account_id: true } })
  return profile?.account_id ?? null
}

async function sendSmsOtp(userId: string, phone: string, code: string): Promise<void> {
  const accountId = await resolveAccountId(userId)
  if (!accountId) throw new Error("No account linked to this user")
  await sendSmsText({ accountId, to: phone, text: `Your WhatsApp CRM login code is ${code}. It expires in 5 minutes. Do not share it.` })
}

/**
 * WhatsApp OTP requires a pre-approved Meta "Authentication"-category
 * template (Meta rejects free-form OTP text) — picks the account's first
 * approved one. Throws a clear, actionable error if none exists yet,
 * rather than silently failing; the Settings UI surfaces that message.
 */
async function sendWhatsappOtp(userId: string, phone: string, code: string): Promise<void> {
  const accountId = await resolveAccountId(userId)
  if (!accountId) throw new Error("No account linked to this user")

  const config = await prisma.whatsAppConfig.findUnique({ where: { account_id: accountId } })
  if (!config) throw new Error("WhatsApp isn't connected for this account yet")

  const template = await prisma.messageTemplate.findFirst({
    where: { account_id: accountId, category: "Authentication", status: "APPROVED" },
    orderBy: { created_at: "asc" },
  })
  if (!template || !isMessageTemplate(template)) {
    throw new Error(
      "No approved WhatsApp Authentication-category template found — create and get one approved in Settings > Templates first.",
    )
  }

  await sendTemplateMessage({
    phoneNumberId: config.phone_number_id,
    accessToken: decrypt(config.access_token),
    to: phone,
    templateName: template.name,
    language: template.language ?? "en_US",
    template,
    messageParams: { body: [code], buttonParams: { 0: code } },
  })
}

/**
 * Creates a challenge and (for sms/whatsapp) sends the code. TOTP has
 * nothing to send — the code lives in the user's own authenticator app —
 * so its challenge row exists only to carry purpose/method/expiry through
 * to verifyChallenge, with code_hash left null.
 */
export async function createChallenge(args: {
  userId: string
  purpose: MfaPurpose
  method: MfaMethod
  /** Delivery number for sms/whatsapp — required for those methods on
   *  'enroll' (verifying a NEW number); on 'login' the caller should pass
   *  the user's already-saved mfa_phone. */
  phone?: string | null
}): Promise<{ challengeId: string }> {
  const expiresAt = new Date(Date.now() + CODE_TTL_MS)

  let codeHash: string | null = null
  if (args.method !== "totp") {
    if (!args.phone) throw new Error("A phone number is required for SMS/WhatsApp codes")
    const code = generateOtpCode()
    codeHash = await bcrypt.hash(code, 10)
    if (args.method === "sms") await sendSmsOtp(args.userId, args.phone, code)
    else await sendWhatsappOtp(args.userId, args.phone, code)
  }

  const challenge = await prisma.mfaChallenge.create({
    data: {
      user_id: args.userId,
      purpose: args.purpose,
      method: args.method,
      code_hash: codeHash,
      pending_phone: args.purpose === "enroll" ? (args.phone ?? null) : null,
      expires_at: expiresAt,
    },
  })
  return { challengeId: challenge.id }
}

export interface VerifyResult {
  ok: boolean
  error?: string
  challenge?: { id: string; user_id: string; purpose: MfaPurpose; method: MfaMethod; pending_phone: string | null }
}

/** Verifies a submitted code against an existing challenge. Does NOT
 *  consume it — 'login' challenges are consumed by auth.ts's authorize()
 *  at the exact moment the session is actually issued (so a verified-but-
 *  unused challenge can't be replayed for a second login), and 'enroll'
 *  challenges are finalized (writing the real User.mfa_* fields) by the
 *  caller in the same request that calls this. */
export async function verifyChallenge(challengeId: string, code: string): Promise<VerifyResult> {
  const challenge = await prisma.mfaChallenge.findUnique({ where: { id: challengeId } })
  if (!challenge) return { ok: false, error: "This code has expired — request a new one." }
  if (challenge.consumed_at) return { ok: false, error: "This code has already been used." }
  if (challenge.expires_at.getTime() < Date.now()) return { ok: false, error: "This code has expired — request a new one." }
  if (challenge.attempts >= MAX_ATTEMPTS) return { ok: false, error: "Too many incorrect attempts — request a new code." }

  let valid = false
  if (challenge.method === "totp") {
    const user = await prisma.user.findUnique({ where: { id: challenge.user_id }, select: { totp_secret: true } })
    // 'enroll' verifies against the freshly-generated secret the caller
    // passes through pending_phone-shaped storage isn't applicable here —
    // TOTP enrollment instead keeps the candidate secret out of the DB
    // until confirmed (see /api/account/mfa/enroll routes), so this path
    // only ever checks the ALREADY-SAVED secret — i.e. only 'login'.
    if (user?.totp_secret) valid = verifyTotp(decrypt(user.totp_secret), code)
  } else if (challenge.code_hash) {
    valid = await bcrypt.compare(code.replace(/\D/g, ""), challenge.code_hash)
  }

  if (!valid) {
    await prisma.mfaChallenge.update({ where: { id: challengeId }, data: { attempts: { increment: 1 } } })
    return { ok: false, error: "Incorrect code." }
  }

  await prisma.mfaChallenge.update({ where: { id: challengeId }, data: { verified: true } })
  return {
    ok: true,
    challenge: {
      id: challenge.id,
      user_id: challenge.user_id,
      purpose: challenge.purpose as MfaPurpose,
      method: challenge.method as MfaMethod,
      pending_phone: challenge.pending_phone,
    },
  }
}

/** Marks a verified 'login' challenge consumed — called by auth.ts's
 *  authorize() at the moment it actually issues the session, so the same
 *  verified challenge can never be replayed for a second sign-in. Returns
 *  false (and consumes nothing) if the challenge isn't a verified,
 *  unconsumed 'login' challenge for this exact user. */
export async function consumeLoginChallenge(challengeId: string, userId: string): Promise<boolean> {
  const result = await prisma.mfaChallenge.updateMany({
    where: { id: challengeId, user_id: userId, purpose: "login", verified: true, consumed_at: null },
    data: { consumed_at: new Date() },
  })
  return result.count > 0
}
