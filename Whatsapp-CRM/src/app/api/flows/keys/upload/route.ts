import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'

const META_API_VERSION = 'v21.0'

/**
 * POST /api/flows/keys/upload
 *
 * Uploads the RSA public key to Meta so they can encrypt webhook requests
 * to your WhatsApp Flows endpoint.
 *
 * Body: { publicKey: string }   — PEM SPKI format
 *
 * Meta API: POST /{PHONE_NUMBER_ID}/whatsapp_business_encryption
 *   { business_public_key: "-----BEGIN PUBLIC KEY-----\n..." }
 */
export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const profile = await prisma.profile.findUnique({
    where: { user_id: session.user.id },
    select: { account_id: true },
  })
  if (!profile?.account_id) {
    return NextResponse.json({ error: 'No account' }, { status: 403 })
  }

  const body = await request.json() as { publicKey?: string }
  if (!body.publicKey) {
    return NextResponse.json({ error: 'publicKey is required' }, { status: 400 })
  }

  const config = await prisma.whatsAppConfig.findUnique({
    where: { account_id: profile.account_id },
  })
  if (!config?.phone_number_id) {
    return NextResponse.json(
      { error: 'WhatsApp not configured. Connect your account in Settings first.' },
      { status: 400 },
    )
  }

  const accessToken = decrypt(config.access_token)

  const metaRes = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/${config.phone_number_id}/whatsapp_business_encryption`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ business_public_key: body.publicKey }),
    },
  )

  const metaBody = await metaRes.json() as { success?: boolean; error?: { message?: string } }

  if (!metaRes.ok) {
    const msg = metaBody?.error?.message ?? `Meta API error: ${metaRes.status}`
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
