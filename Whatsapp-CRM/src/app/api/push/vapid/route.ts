import { NextResponse } from 'next/server'
import webpush from 'web-push'
import { auth } from '@/auth'

/**
 * GET /api/push/vapid
 * Returns the public VAPID key (safe to expose to browser).
 * Also exposes a ?generate=1 endpoint (owner-only) to generate new keys.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)

  if (searchParams.get('generate') === '1') {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { publicKey, privateKey } = webpush.generateVAPIDKeys()
    return NextResponse.json({
      publicKey,
      privateKey,
      envLines: `VAPID_PUBLIC_KEY="${publicKey}"\nVAPID_PRIVATE_KEY="${privateKey}"\nVAPID_SUBJECT="mailto:admin@yourapp.com"`,
    })
  }

  const publicKey = process.env.VAPID_PUBLIC_KEY
  if (!publicKey) {
    return NextResponse.json({ error: 'VAPID not configured', publicKey: null })
  }
  return NextResponse.json({ publicKey })
}
