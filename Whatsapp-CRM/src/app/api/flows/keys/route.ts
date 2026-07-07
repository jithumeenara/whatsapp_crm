import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'

const META_API_VERSION = 'v21.0'

async function getAccountAndConfig(userId: string) {
  const profile = await prisma.profile.findUnique({
    where: { user_id: userId },
    select: { account_id: true },
  })
  if (!profile?.account_id) return null

  const config = await prisma.whatsAppConfig.findUnique({
    where: { account_id: profile.account_id },
    select: {
      flows_private_key: true,
      phone_number_id: true,
      access_token: true,
    },
  })
  return { accountId: profile.account_id, config }
}

/** Derives publicKey + fingerprint from a PEM private key. */
function derivePublicInfo(privateKeyPem: string): { publicKey: string; fingerprint: string } {
  const keyObj = crypto.createPrivateKey(privateKeyPem)
  const publicKey = keyObj.export({ type: 'spki', format: 'pem' }) as string
  const fingerprint = crypto
    .createHash('sha256')
    .update(keyObj.export({ type: 'pkcs1', format: 'der' }) as Buffer)
    .digest('hex')
    .match(/.{2}/g)!
    .join(':')
  return { publicKey, fingerprint }
}

/** Uploads a public key PEM to Meta's WhatsApp Business Encryption endpoint. */
async function uploadToMeta(phoneNumberId: string, accessToken: string, publicKeyPem: string): Promise<void> {
  const res = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}/whatsapp_business_encryption`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_public_key: publicKeyPem }),
    },
  )
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(body?.error?.message ?? `Meta API error: ${res.status}`)
  }
}

/**
 * GET /api/flows/keys
 *
 * Returns the public key that the webhook will use (DB first, then env var).
 * This ensures "Resync with Meta" always uploads the correct active key.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Try DB first (same priority order as the webhook)
  try {
    const row = await getAccountAndConfig(session.user.id)
    if (row?.config?.flows_private_key) {
      const pem = decrypt(row.config.flows_private_key)
      const { publicKey, fingerprint } = derivePublicInfo(pem)
      return NextResponse.json({ hasKey: true, publicKey, fingerprint, source: 'db' })
    }
  } catch {
    // Fall through to env var
  }

  // Fall back to env var
  const rawPem = process.env.FLOWS_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!rawPem) {
    return NextResponse.json({ hasKey: false, error: 'No key found. Generate one below.' }, { status: 400 })
  }

  try {
    const { publicKey, fingerprint } = derivePublicInfo(rawPem)
    return NextResponse.json({ hasKey: true, publicKey, fingerprint, source: 'env' })
  } catch (err) {
    return NextResponse.json({
      error: `Key in FLOWS_PRIVATE_KEY is malformed: ${err instanceof Error ? err.message : err}`,
      hasKey: true,
    }, { status: 400 })
  }
}

/**
 * POST /api/flows/keys
 *
 * Generates a fresh RSA-2048 key pair, saves private key to DB (encrypted),
 * and automatically uploads the public key to Meta — all in one step.
 *
 * Returns:
 *   privateKey       — PEM (PKCS#8) — copy to .env.local as a fallback
 *   publicKey        — PEM (SPKI)
 *   envValue         — ready-to-paste .env.local line
 *   uploadedToMeta   — whether the public key was successfully sent to Meta
 *   uploadError      — error message if uploadedToMeta is false
 */
export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })

  // Save private key to DB so webhook picks it up immediately (no restart needed)
  let accountId: string | undefined
  try {
    const row = await getAccountAndConfig(session.user.id)
    accountId = row?.accountId
    if (accountId) {
      await prisma.whatsAppConfig.updateMany({
        where: { account_id: accountId },
        data: { flows_private_key: encrypt(privateKey) },
      })
    }
  } catch {
    // Non-fatal — webhook falls back to env var
  }

  // Auto-upload public key to Meta
  let uploadedToMeta = false
  let uploadError: string | undefined
  if (accountId) {
    try {
      const row = await getAccountAndConfig(session.user.id)
      const config = row?.config
      if (config?.phone_number_id && config?.access_token) {
        const accessToken = decrypt(config.access_token)
        await uploadToMeta(config.phone_number_id, accessToken, publicKey)
        uploadedToMeta = true
      } else {
        uploadError = 'WhatsApp not configured — upload the public key manually in Meta.'
      }
    } catch (err) {
      uploadError = err instanceof Error ? err.message : 'Failed to upload to Meta'
    }
  } else {
    uploadError = 'No account found — upload the public key manually in Meta.'
  }

  const envValue = `FLOWS_PRIVATE_KEY="${privateKey.replace(/\n/g, '\\n')}"`

  return NextResponse.json({ privateKey, publicKey, envValue, uploadedToMeta, uploadError })
}
