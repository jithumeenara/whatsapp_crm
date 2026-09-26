import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { encrypt } from '@/lib/whatsapp/encryption'
import { CALLBACK_PATH, accessTokenFor, deleteSubscription, isGuid, loadMailbox } from '@/lib/email/microsoft/graph'
import { publicOrigin } from '@/lib/email/microsoft/origin'

/**
 * The Microsoft app registration's details, kept per account and
 * encrypted — entered here by an admin rather than put in the server's
 * environment.
 *
 * GET never returns the client secret, only whether one is stored.
 */

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole('admin')
    const box = await loadMailbox(ctx.accountId)
    return NextResponse.json({
      configured: Boolean(box),
      tenant_id: box?.tenant_id ?? '',
      client_id: box?.client_id ?? '',
      has_secret: Boolean(box?.client_secret),
      mailbox_email: box?.mailbox_email ?? null,
      mailbox_name: box?.mailbox_name ?? null,
      status: box?.status ?? 'not_connected',
      last_error: box?.last_error ?? null,
      subscription_expires_at: box?.subscription_expires_at ?? null,
      // What to register in Entra as the Redirect URI, from the address
      // the admin is using right now.
      redirect_uri: `${publicOrigin(req)}${CALLBACK_PATH}`,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireRole('admin')
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const tenantId = typeof body.tenant_id === 'string' ? body.tenant_id.trim() : ''
    const clientId = typeof body.client_id === 'string' ? body.client_id.trim() : ''
    const secret = typeof body.client_secret === 'string' ? body.client_secret.trim() : ''
    if (!isGuid(tenantId)) return NextResponse.json({ error: 'Directory (tenant) ID should look like 6177e5b2-f174-…' }, { status: 400 })
    if (!isGuid(clientId)) return NextResponse.json({ error: 'Application (client) ID should look like 1a2b3c4d-…' }, { status: 400 })
    if (secret && (secret.length < 10 || secret.length > 200 || /\s/.test(secret))) {
      return NextResponse.json({ error: 'That does not look like a client secret Value' }, { status: 400 })
    }

    const existing = await loadMailbox(ctx.accountId)
    if (!existing && !secret) return NextResponse.json({ error: 'Paste the client secret Value' }, { status: 400 })

    // A different app or directory invalidates the sign-in made with the
    // old one: start over rather than keep tokens that no longer match.
    const appChanged = existing && (existing.tenant_id !== tenantId || existing.client_id !== clientId)
    if (existing && appChanged && existing.subscription_id && existing.refresh_token) {
      const token = await accessTokenFor(existing).catch(() => null)
      if (token) await deleteSubscription(token, existing.subscription_id)
    }

    const data = {
      tenant_id: tenantId,
      client_id: clientId,
      ...(secret ? { client_secret: encrypt(secret) } : {}),
      ...(appChanged
        ? {
            refresh_token: null, access_token: null, access_expires_at: null,
            subscription_id: null, subscription_expires_at: null,
            mailbox_email: null, mailbox_name: null, status: 'not_connected', last_error: null,
          }
        : {}),
    }
    if (existing) {
      await prisma.microsoftMailbox.update({ where: { id: existing.id }, data })
    } else {
      await prisma.microsoftMailbox.create({
        data: {
          account_id: ctx.accountId,
          user_id: ctx.userId,
          tenant_id: tenantId,
          client_id: clientId,
          client_secret: encrypt(secret),
          client_state: crypto.randomBytes(32).toString('base64url'),
        },
      })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** Disconnect the mailbox. `?forget=1` also removes the app details. */
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireRole('admin')
    const box = await loadMailbox(ctx.accountId)
    if (!box) return NextResponse.json({ ok: true })
    if (box.subscription_id && box.refresh_token) {
      const token = await accessTokenFor(box).catch(() => null)
      if (token) await deleteSubscription(token, box.subscription_id)
    }
    if (req.nextUrl.searchParams.get('forget') === '1') {
      await prisma.microsoftMailbox.delete({ where: { id: box.id } })
    } else {
      await prisma.microsoftMailbox.update({
        where: { id: box.id },
        data: {
          refresh_token: null, access_token: null, access_expires_at: null,
          subscription_id: null, subscription_expires_at: null,
          mailbox_email: null, mailbox_name: null, status: 'not_connected', last_error: null,
        },
      })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
