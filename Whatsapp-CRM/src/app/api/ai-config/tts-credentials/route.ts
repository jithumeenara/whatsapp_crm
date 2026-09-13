import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'
import { parseServiceAccount, clearTokenCache } from '@/lib/ai/google-auth'
import { synthesizeWithCloudTts } from '@/lib/ai/cloud-tts'
import { resolveTtsCredentials } from '@/lib/ai/tts-credentials'

/**
 * Upload, inspect and remove this account's Google Cloud key for
 * text-to-speech.
 *
 * Two rules shape the whole file:
 *
 *   1. **The key never comes back out.** GET reports whether one is
 *      stored, which service account it names and which project — enough
 *      to confirm the right key is loaded, and nothing that grants
 *      anything. There is no endpoint that returns it.
 *
 *   2. **A key is proven before it is stored.** Uploading runs a real
 *      synthesis call. Storing an unverified key means the failure
 *      surfaces days later as "voice replies stopped sounding right",
 *      with nothing connecting it to an upload, and the fallback engine
 *      quietly covering for it the whole time.
 *
 * Admin floor: this is a credential for the whole account, in the same
 * class as the WhatsApp token.
 */

export const dynamic = 'force-dynamic'

/** A service-account JSON is a couple of kilobytes. Anything far larger
 *  is a mistake or an attempt, and parsing it wastes memory either way. */
const MAX_JSON_BYTES = 64 * 1024

export async function GET() {
  let accountId: string
  try {
    accountId = (await requireRole('admin')).accountId
  } catch (err) {
    return toErrorResponse(err)
  }

  const config = await prisma.aiConfig.findUnique({
    where: { account_id: accountId },
    select: {
      google_tts_credentials: true,
      google_tts_client_email: true,
      google_tts_project_id: true,
      google_tts_verified_at: true,
    },
  })

  const { source } = await resolveTtsCredentials(accountId)

  return NextResponse.json({
    // Presence only — never the key itself.
    uploaded: Boolean(config?.google_tts_credentials),
    client_email: config?.google_tts_client_email ?? null,
    project_id: config?.google_tts_project_id ?? null,
    verified_at: config?.google_tts_verified_at ?? null,
    // 'account' | 'environment' | 'none' — says which credential the
    // send path would actually use, so the screen cannot claim one thing
    // while replies use another.
    source,
  })
}

export async function POST(req: Request) {
  let accountId: string
  try {
    accountId = (await requireRole('admin')).accountId
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = (await req.json().catch(() => null)) as { credentials?: string } | null
  const raw = body?.credentials?.trim()

  if (!raw) {
    return NextResponse.json({ error: 'Paste or upload the service-account JSON file.' }, { status: 400 })
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_JSON_BYTES) {
    return NextResponse.json({ error: 'That file is far too large to be a service-account key.' }, { status: 400 })
  }

  const parsed = parseServiceAccount(raw)
  if (!parsed) {
    return NextResponse.json(
      {
        error:
          'That does not look like a service-account key. It should be the JSON file Google Cloud downloads, containing "client_email" and "private_key".',
      },
      { status: 400 },
    )
  }

  // Proven before stored. A key that cannot speak is not a key.
  try {
    const probe = await synthesizeWithCloudTts({
      text: 'Voice check.',
      languageCode: 'en-IN',
      encoding: 'MP3',
      account: parsed,
    })
    if (probe.buffer.length < 200) throw new Error('The test returned no usable audio.')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      {
        error: `The key was read, but a test failed: ${message}`,
        // The two causes worth naming, because both look identical from
        // here and neither is guessable from Google's own wording.
        hint: 'Check the Text-to-Speech API is enabled on that Cloud project, and that the service account has the "Cloud Text-to-Speech User" role.',
      },
      { status: 400 },
    )
  }

  const aiConfig = await prisma.aiConfig.findUnique({
    where: { account_id: accountId },
    select: { id: true },
  })
  if (!aiConfig) {
    return NextResponse.json(
      { error: 'Set up the AI assistant before adding a voice key.' },
      { status: 400 },
    )
  }

  await prisma.aiConfig.update({
    where: { id: aiConfig.id },
    data: {
      google_tts_credentials: encrypt(raw),
      google_tts_client_email: parsed.client_email,
      google_tts_project_id: parsed.project_id || null,
      google_tts_verified_at: new Date(),
    },
  })

  // A replaced key leaves the old identity's token cached and usable
  // until it expires. Cleared so the change takes effect now.
  clearTokenCache(parsed)

  return NextResponse.json({
    ok: true,
    client_email: parsed.client_email,
    project_id: parsed.project_id || null,
    verified_at: new Date().toISOString(),
  })
}

export async function DELETE() {
  let accountId: string
  try {
    accountId = (await requireRole('admin')).accountId
  } catch (err) {
    return toErrorResponse(err)
  }

  const config = await prisma.aiConfig.findUnique({
    where: { account_id: accountId },
    select: { id: true, google_tts_client_email: true },
  })
  if (!config) return NextResponse.json({ ok: true })

  await prisma.aiConfig.update({
    where: { id: config.id },
    data: {
      google_tts_credentials: null,
      google_tts_client_email: null,
      google_tts_project_id: null,
      google_tts_verified_at: null,
    },
  })

  // Everything, not just this identity: the row is gone and there is no
  // parsed account left to key the eviction on.
  clearTokenCache()

  return NextResponse.json({ ok: true })
}
