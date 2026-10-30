import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { resolveWhatsAppConfig } from '@/lib/whatsapp/resolve-config'

const META_API_VERSION = 'v21.0'

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0wG+W5bCPdgsRlRRO1/9
54C8O08JRQEPzV92E/ASQGd6YI7XFTun3XAAozZRk52G2PN3VwU6Oyu9aeCpwIFq
WPsvfpZDCjeo88zq9bcHDQR/ODC5YVd40LBwPSikyLpYPi7pLu5X3EAL3E93GJlX
gJESMOn6YUbJ8GC5bBiM+gOPoyj8qh73woL35w8GiHYWkLofaXFJ21KqPOaasLTe
eFgmIW0ALX+O9gkgeupd1C0MfY5Ul1FvH65yL/d1GLrq8qbx8ER9ss7kg83c6vko
vjwgLOm111/z0LPgpUI2TPpTdRulOjri3/VzLuqC6QTn2IJa5R7TfwAmj7Z+pz0t
NQIDAQAB
-----END PUBLIC KEY-----`

/**
 * GET /api/admin/setup-flows-key
 *
 * One-time route: uploads the generated RSA public key to Meta so the
 * Flows endpoint encryption works. Visit this URL once in your browser
 * while logged in, then you can delete this file.
 */
export async function GET() {
  // Owner only — this replaces the account's Flows encryption key at
  // Meta, which is WhatsApp configuration (canEditWhatsAppConfig). It
  // used to need nothing more than being signed in.
  let accountId: string
  try {
    accountId = (await requireRole('owner')).accountId
  } catch (err) {
    return toErrorResponse(err)
  }

  // Account-level admin action, no conversation context (Finding #14) —
  // resolves to the account's default number.
  const config = await resolveWhatsAppConfig({ accountId }).catch(() => null)
  if (!config?.phone_number_id || !config?.access_token) {
    return NextResponse.json(
      { error: 'WhatsApp not configured. Go to Settings → WhatsApp first.' },
      { status: 400 },
    )
  }

  const accessToken = decrypt(config.access_token)

  const formData = new URLSearchParams()
  formData.append('business_public_key', PUBLIC_KEY)

  const res = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/${config.phone_number_id}/whatsapp_business_encryption`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    },
  )

  const rawText = await res.text()
  let body: unknown
  try { body = JSON.parse(rawText) } catch { body = rawText }

  if (!res.ok) {
    return NextResponse.json(
      { error: 'Meta API error', status: res.status, detail: body },
      { status: 502 },
    )
  }

  return NextResponse.json({
    ok: true,
    message: 'Public key uploaded to Meta successfully! You can now run the health check.',
    meta_response: body,
  })
}
