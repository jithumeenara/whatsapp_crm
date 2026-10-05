import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { imageSettingsFor, setImageSettings } from '@/lib/ai/image-settings'
import { getProviderKeys } from '@/lib/ai/providers/registry'

/**
 * Whether the assistant reads images customers send, and whether it asks
 * them to confirm what it read (lib/ai/image-settings.ts). Says too whether
 * it can — reading needs a Gemini key — so the screen never shows a switch
 * that is on and doing nothing.
 *
 * Admin only, like the rest of AI Config.
 */

export const dynamic = 'force-dynamic'

async function view(accountId: string) {
  const [settings, ai] = await Promise.all([
    imageSettingsFor(accountId),
    prisma.aiConfig.findUnique({ where: { account_id: accountId }, select: { provider_keys: true, ai_auto_reply_enabled: true } }),
  ])
  return {
    ...settings,
    gemini_ready: Boolean(ai && getProviderKeys(ai).gemini?.api_key),
    auto_reply_enabled: ai?.ai_auto_reply_enabled ?? false,
  }
}

export async function GET() {
  try {
    const ctx = await requireRole('admin')
    return NextResponse.json(await view(ctx.accountId))
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = (await req.json().catch(() => null)) as { read_images?: unknown; confirm?: unknown } | null
    if (typeof body?.read_images !== 'boolean' || typeof body?.confirm !== 'boolean') {
      return NextResponse.json({ error: 'read_images and confirm must be true or false.' }, { status: 400 })
    }
    const exists = await prisma.aiConfig.findUnique({ where: { account_id: ctx.accountId }, select: { id: true } })
    if (!exists) return NextResponse.json({ error: 'Set up the AI assistant first.' }, { status: 400 })
    await setImageSettings(ctx.accountId, { read_images: body.read_images, confirm: body.confirm })
    return NextResponse.json(await view(ctx.accountId))
  } catch (err) {
    return toErrorResponse(err)
  }
}
