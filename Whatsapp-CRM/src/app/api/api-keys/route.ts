import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { generateApiKey, MAX_API_KEY_LIFETIME_MS } from '@/lib/auth/api-key'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

/**
 * Owner only — the same rule as the Settings tab (canEditWhatsAppConfig in
 * lib/auth/roles.ts). A key acts at supervisor level, so letting any
 * member mint one handed a viewer or an agent a supervisor's reach in a
 * single request.
 */
async function requireKeyManager() {
  try {
    const ctx = await requireRole('owner')
    return { ok: true as const, accountId: ctx.accountId, userId: ctx.userId }
  } catch (err) {
    return { ok: false as const, response: toErrorResponse(err) }
  }
}

async function hadCreatorlessKeys(accountId: string): Promise<boolean> {
  try {
    return (await prisma.apiKey.count({ where: { account_id: accountId, created_by_user_id: null } })) > 0
  } catch (err) {
    console.error('[GET /api/api-keys] creatorless key count failed', err)
    return false
  }
}

export async function GET() {
  try {
    const guard = await requireKeyManager()
    if (!guard.ok) return guard.response

    const keys = await prisma.apiKey.findMany({
      // Revoked keys (their creator was removed) stay in the table for the
      // audit trail but are not keys any more.
      where: { account_id: guard.accountId, revoked_at: null },
      select: {
        id: true,
        name: true,
        key_prefix: true,
        last_used_at: true,
        created_at: true,
        expires_at: true,
      },
      orderBy: { created_at: 'desc' },
    })
    // Keys with no recorded creator are refused (security review N2) and
    // revoked by migration 154. Say so, so the owner knows why an
    // integration stopped. Revoked rows stay in the table, so this keeps
    // answering after the migration. Never fails the list.
    const legacyKeysOff = await hadCreatorlessKeys(guard.accountId)
    return NextResponse.json({ keys, legacy_keys_off: legacyKeysOff })
  } catch (err) {
    console.error('[GET /api/api-keys]', err)
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const guard = await requireKeyManager()
    if (!guard.ok) return guard.response

    const body = await req.json().catch(() => null)
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!name) return NextResponse.json({ error: 'name is required.' }, { status: 400 })
    if (name.length > 80) return NextResponse.json({ error: 'name too long.' }, { status: 400 })

    // Optional end of life: an ISO time in the future, at most a year out.
    let expiresAt: Date | null = null
    if (body?.expires_at !== undefined && body?.expires_at !== null) {
      const at = typeof body.expires_at === 'string' ? new Date(body.expires_at) : null
      const now = Date.now()
      if (!at || Number.isNaN(at.getTime()) || at.getTime() <= now || at.getTime() > now + MAX_API_KEY_LIFETIME_MS) {
        return NextResponse.json({ error: 'expires_at must be a date in the next 12 months.' }, { status: 400 })
      }
      expiresAt = at
    }

    const { raw, hash, prefix } = generateApiKey()

    const key = await prisma.apiKey.create({
      data: {
        account_id: guard.accountId,
        name,
        key_hash: hash,
        key_prefix: prefix,
        // Who minted it: verifyApiKey refuses the key once this person is
        // no longer a member here at supervisor rank or above.
        created_by_user_id: guard.userId,
        expires_at: expiresAt,
      },
      select: { id: true, name: true, key_prefix: true, created_at: true, expires_at: true },
    })

    // Return the raw key ONLY on creation — it will never be shown again.
    return NextResponse.json({ key, raw }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/api-keys]', err)
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}
