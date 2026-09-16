import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { resolveWhatsAppConfig } from '@/lib/whatsapp/resolve-config'
import { derivePublicInfo } from '@/lib/flows/key-material'

/**
 * The RSA key pair Meta uses to encrypt Flow requests to this CRM.
 *
 * ── Why this file is written so defensively ─────────────────────────
 *
 * It used to hold a one-line bug that took weeks to find, and the reason
 * it took weeks is worth keeping written down.
 *
 * GET derived the public half of the stored key by calling
 * `privateKeyObject.export({ type: 'spki' })`. `spki` is a public-key
 * encoding and Node refuses it on a private key, so that call threw on
 * every request. The throw landed in a bare `catch {}`, the handler fell
 * through to the environment variable, found none, and answered "No key
 * configured. Generate one below." — so the owner generated. That
 * uploaded a fresh public key to Meta, left the private half exactly as
 * unreadable as before, and broke every published Flow. Repeat weekly.
 * Nothing in the UI, the logs or the database ever said what was wrong.
 *
 * Three rules came out of it, and each one is load-bearing:
 *
 *   1. Nothing is swallowed. Every failure says what failed and why.
 *   2. Failures that need opposite advice are reported separately — a
 *      key that is absent, one that will not decrypt, and one that
 *      decrypts but is not a key are three different states, and
 *      "Generate" is the correct answer to exactly one of them.
 *   3. Meta is told nothing until the private half has been written,
 *      read back and compared. A key pair Meta knows about and this
 *      server does not is strictly worse than no key pair at all.
 *
 * The key parsing itself now lives in `@/lib/flows/key-material`, with
 * tests, because the failure above was a single missing call that no
 * amount of care in this file would have caught.
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
    // Decryption and key parsing fail for completely different reasons
    // and are diagnosed separately. Wrapping both in one handler is how
    // the previous version came to blame ENCRYPTION_KEY for what was
    // actually a bad export call in this file — and an owner acting on
    // that message would have gone hunting through their environment for
    // a value that was never wrong.
    let pem: string
    try {
      pem = decrypt(storedCipher)
    } catch (err) {
      return NextResponse.json(
        {
          hasKey: true,
          broken: true,
          source: 'db',
          error:
            `A key is stored but this server cannot decrypt it: ${reason(err)}. ` +
            'That means ENCRYPTION_KEY is no longer the value it had when the key was saved. ' +
            'Restore it if you can — generating a new pair will invalidate every Flow already ' +
            'published.',
        },
        { status: 500 },
      )
    }

    try {
      const { publicKey, fingerprint } = derivePublicInfo(pem)
      return NextResponse.json({ hasKey: true, publicKey, fingerprint, source: 'db' })
    } catch (err) {
      return NextResponse.json(
        {
          hasKey: true,
          broken: true,
          source: 'db',
          error:
            `The stored key decrypts, but is not a usable RSA private key: ${reason(err)}. ` +
            'Generating a new pair is the repair here, and it is safe — nothing readable is ' +
            'being replaced.',
        },
        { status: 500 },
      )
    }
  }

  // No unescaping here — derivePublicInfo normalizes every shape a key
  // arrives in, including the single-line `\n`-escaped form an env var
  // holds.
  const rawPem = process.env.FLOWS_PRIVATE_KEY
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
