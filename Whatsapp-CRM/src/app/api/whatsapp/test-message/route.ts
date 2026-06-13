import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { sendTextMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils'

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { phone } = body

    if (!phone || typeof phone !== 'string' || !phone.trim()) {
      return NextResponse.json({ error: 'Phone number is required' }, { status: 400 })
    }

    const normalized = sanitizePhoneForMeta(phone.trim())
    if (!isValidE164(normalized)) {
      return NextResponse.json(
        { error: 'Invalid phone number. Use international format, e.g. +919876543210' },
        { status: 400 },
      )
    }

    const profile = await prisma.profile.findUnique({
      where: { user_id: session.user.id },
      select: { account_id: true },
    })
    if (!profile?.account_id) {
      return NextResponse.json({ error: 'Profile not linked to an account' }, { status: 403 })
    }

    const config = await prisma.whatsAppConfig.findUnique({
      where: { account_id: profile.account_id },
      select: { phone_number_id: true, access_token: true },
    })
    if (!config) {
      return NextResponse.json(
        { error: 'No WhatsApp configuration found. Save your credentials first.' },
        { status: 400 },
      )
    }

    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch {
      return NextResponse.json(
        { error: 'Access token is corrupted. Reset and re-save your configuration.' },
        { status: 500 },
      )
    }

    const result = await sendTextMessage({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: normalized,
      text: '👋 Hello! This is a test message from your WhatsApp CRM. Everything is working correctly.',
    })

    return NextResponse.json({ success: true, message_id: result.messageId })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[test-message] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
