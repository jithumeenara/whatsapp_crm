import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { resolveWhatsAppConfig } from '@/lib/whatsapp/resolve-config'

/**
 * The RSA key pair Meta uses to encrypt Flow requests to this CRM.
 *
 * ── Why this file is written so defensively ─────────────────────────
 *
 * Both handlers used to wrap their database work in a bare `catch {}`.
 * That made the one failure that matters invisible: when the private key
 * could not be stored, generation still reported success and still
 * uploaded the new public key to Meta. From then on Meta encrypted every
 * Flow request with a public key whose private half existed nowhere, so
 * Flows opened blank on the phone — and the only thing this dialog would
 * say was "No key configured. Generate one below.", which is the exact
 * action that had just broken it. An owner can regenerate for a week and
 * learn nothing.
 *
 * So: nothing here swallows an error, the save is read back and decrypted
 * before it is called a save, and the public key is never uploaded to
 * Meta unless the private key is provably retrievable. A key pair Meta
 * knows about and this server does not is strictly worse than none.
 */

const META_API_VERSION = 'v21.0'

async function getAccountAndConfig(userId: string) {
  const profile = await prisma.profile.findUnique({
    where: { user_id: userId },
    select: { account_id: true },
  })
  if (!profile?.account_id) return null

  // Account-level admin action, no conversation context (Finding #14) —
  // resolves to the account's default number.
  const config = await resolveWhatsAppConfig({ accountId: profile.account_id }).catch(() => null)
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

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * GET /api/flows/keys
 *
 * What the webhook would actually use, resolved in the order the webhook
 * resolves it: the database first, then FLOWS_PRIVATE_KEY.
 *
 * Three outcomes, deliberately kept distinct. A key that is present and
 * usable; no key at all, which "Generate" fixes; and a key that is there
 * but cannot be read, which "Generate" does not fix and would make worse.
 * The old handler collapsed the third into the second.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let storedCipher: string | null = null
  try {
    const row = await getAccountAndConfig(session.user.id)
    if (!row) {
      return NextResponse.json(
        { hasKey: false, error: 'Your login is not attached to an account yet.' },
        { status: 400 },
      )
    }
    if (!row.config) {
      return NextResponse.json(
        {
          hasKey: false,
          error:
            'No WhatsApp number is connected, so there is nowhere to keep the key. Connect a number first.',
        },
        { status: 400 },
      )
    }
    storedCipher = row.config.flows_private_key
  } catch (err) {
    // A database that cannot be read is not the same as a key that was
    // never generated, and must never be reported as one.
    return NextResponse.json(
      { hasKey: false, broken: true, error: `Could not read the stored key: ${reason(err)}` },
      { status: 500 },
    )
  }

  if (storedCipher) {
    try {
      const { publicKey, fingerprint } = derivePublicInfo(decrypt(storedCipher))
      return NextResponse.json({ hasKey: true, publicKey, fingerprint, source: 'db' })
    } catch (err) {
      // Stored but unreadable — almost always ENCRYPTION_KEY having
      // changed since it was written. Says so, because the fix is to
      // restore that value; regenerating here would silently invalidate
      // every Flow already published.
      return NextResponse.json(
        {
          hasKey: true,
          broken: true,
          source: 'db',
          error:
            `A key is stored but this server cannot decrypt it: ${reason(err)}. ` +
            'That usually means ENCRYPTION_KEY is no longer the value it had when the key was ' +
            'saved. Restore it if you can — generating a new pair will invalidate every Flow ' +
            'already published.',
        },
        { status: 500 },
      )
    }
  }

  const rawPem = process.env.FLOWS_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!rawPem) {
    return NextResponse.json(
      { hasKey: false, error: 'No key found. Generate one below.' },
      { status: 400 },
    )
  }

  try {
    const { publicKey, fingerprint } = derivePublicInfo(rawPem)
    return NextResponse.json({ hasKey: true, publicKey, fingerprint, source: 'env' })
  } catch (err) {
    return NextResponse.json(
      {
        hasKey: true,
        broken: true,
        source: 'env',
        error: `The key in FLOWS_PRIVATE_KEY is malformed: ${reason(err)}`,
      },
      { status: 400 },
    )
  }
}

/**
 * POST /api/flows/keys
 *
 * Generates a fresh RSA-2048 pair, stores the private half, proves it can
 * be read back, and only then tells Meta about the public half.
 *
 * The order is the whole point. Uploading first, or storing without
 * checking, leaves Meta encrypting requests this server cannot decrypt —
 * which looks to the customer like a Flow that opens blank, and to the
 * owner like nothing at all.
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
  // Returned whatever happens below, so a server that cannot store the
  // key still leaves the owner holding it rather than empty-handed.
  const envValue = `FLOWS_PRIVATE_KEY="${privateKey.replace(/\n/g, '\\n')}"`

  let accountId: string | undefined
  let stored = false
  let storeError: string | undefined

  try {
    const row = await getAccountAndConfig(session.user.id)
    if (!row) throw new Error('Your login is not attached to an account.')
    accountId = row.accountId
    if (!row.config) {
      throw new Error('No WhatsApp number is connected, so there is nowhere to keep the key.')
    }

    const written = await prisma.whatsAppConfig.updateMany({
      where: { account_id: accountId },
      data: { flows_private_key: encrypt(privateKey) },
    })
    if (written.count === 0) throw new Error('No WhatsApp number row was updated.')

    // Read back through the same path the webhook uses. "The write
    // returned" and "the key comes back" are different claims, and only
    // the second is worth acting on.
    const check = await resolveWhatsAppConfig({ accountId })
    if (!check.flows_private_key) throw new Error('The key did not survive being written.')
    if (decrypt(check.flows_private_key) !== privateKey) {
      throw new Error('The key read back does not match the one written.')
    }
    stored = true
  } catch (err) {
    storeError = reason(err)
  }

  // Meta is told nothing until the private half is provably here.
  let uploadedToMeta = false
  let uploadError: string | undefined
  if (!stored) {
    uploadError =
      'Not uploaded — the private key could not be saved on this server, and a public key at ' +
      'Meta with no private half would stop every Flow. Save the line below to .env.local, ' +
      'restart the server, then upload the public key.'
  } else {
    try {
      const row = await getAccountAndConfig(session.user.id)
      const config = row?.config
      if (config?.phone_number_id && config?.access_token) {
        await uploadToMeta(config.phone_number_id, decrypt(config.access_token), publicKey)
        uploadedToMeta = true
      } else {
        uploadError = 'WhatsApp not configured — upload the public key manually in Meta.'
      }
    } catch (err) {
      uploadError = reason(err)
    }
  }

  return NextResponse.json({
    privateKey,
    publicKey,
    envValue,
    stored,
    storeError,
    uploadedToMeta,
    uploadError,
  })
}
