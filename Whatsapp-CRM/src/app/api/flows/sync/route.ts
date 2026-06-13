import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'

/**
 * POST /api/flows/sync
 *
 * Fetches WhatsApp Flows from Meta's Graph API for the caller's WABA and
 * upserts them into the local flows table with flow_type = "whatsapp_flow".
 * These are the interactive form-style flows (Meta's native WhatsApp Flows
 * product), distinct from the automation flows users build in the editor.
 *
 * Upsert key: account_id + name (matching Meta's own uniqueness constraint
 * per WABA — you can't publish two flows with the same name).
 */

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`
const PAGE_CAP = 20

interface MetaFlow {
  id: string
  name: string
  status: string
  categories?: string[]
}

// ── Meta → internal format conversion ────────────────────────────
// Meta stores components under screen.layout.children
// Internally we use screen.components (+ an id field per component for DnD)

interface MetaScreenRaw {
  id: string
  title?: string
  layout?: { children?: Record<string, unknown>[] }
}

function genCompId() {
  return 'comp_' + Math.random().toString(36).slice(2, 8)
}

function transformScreensFromMeta(raw: MetaScreenRaw[]): Record<string, unknown>[] {
  return raw.map((screen) => {
    const rawChildren = screen.layout?.children ?? []

    // v7.3: components are wrapped in a Form component — unwrap them
    let flatComps: Record<string, unknown>[]
    if (rawChildren.length === 1 && (rawChildren[0] as Record<string, unknown>).type === 'Form') {
      flatComps = ((rawChildren[0] as Record<string, unknown>).children as Record<string, unknown>[]) ?? []
    } else {
      flatComps = rawChildren
    }

    return {
      id: screen.id,
      title: screen.title ?? screen.id,
      // Preserve terminal flag if present
      ...(screen.id === 'SUCCESS' ? { terminal: true } : {}),
      components: flatComps.map((comp) => ({
        id: genCompId(),
        ...comp,
      })),
    }
  })
}

async function fetchFlowScreens(
  metaFlowId: string,
  accessToken: string,
): Promise<Record<string, unknown>[] | null> {
  try {
    const assetsRes = await fetch(`${META_API_BASE}/${metaFlowId}/assets`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!assetsRes.ok) return null

    const assetsBody = (await assetsRes.json()) as {
      data?: { name: string; asset_type: string; download_url?: string }[]
    }
    const asset = assetsBody.data?.find((a) => a.asset_type === 'FLOW_JSON')
    if (!asset?.download_url) return null

    const jsonRes = await fetch(asset.download_url)
    if (!jsonRes.ok) return null

    const flowJson = (await jsonRes.json()) as { screens?: MetaScreenRaw[] }
    if (!Array.isArray(flowJson.screens)) return null

    return transformScreensFromMeta(flowJson.screens)
  } catch {
    return null
  }
}

function mapStatus(metaStatus: string): 'draft' | 'active' | 'archived' {
  switch (metaStatus.toUpperCase()) {
    case 'PUBLISHED':
      return 'active'
    case 'DEPRECATED':
    case 'BLOCKED':
    case 'THROTTLED':
      return 'archived'
    default:
      return 'draft'
  }
}

export async function POST() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const profile = await prisma.profile.findUnique({
      where: { user_id: session.user.id },
      select: { account_id: true },
    })
    const accountId = profile?.account_id
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const config = await prisma.whatsAppConfig.findUnique({
      where: { account_id: accountId },
    })
    if (!config) {
      return NextResponse.json(
        {
          error:
            'WhatsApp not configured. Connect your WhatsApp Business account in Settings first.',
        },
        { status: 400 },
      )
    }
    if (!config.waba_id) {
      return NextResponse.json(
        {
          error:
            'WABA ID missing. Re-connect your WhatsApp Business account in Settings.',
        },
        { status: 400 },
      )
    }

    const accessToken = decrypt(config.access_token)

    // Paginate through all flows in the WABA
    const metaFlows: MetaFlow[] = []
    let nextUrl: string | null =
      `${META_API_BASE}/${config.waba_id}/flows?fields=id,name,status,categories&limit=100`
    let pageCount = 0

    while (nextUrl && pageCount < PAGE_CAP) {
      pageCount++
      const metaRes = await fetch(nextUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!metaRes.ok) {
        let metaErr = `Meta API error: ${metaRes.status}`
        try {
          const body = await metaRes.json()
          if (body?.error?.message) metaErr = body.error.message
        } catch {
          // non-JSON response — keep fallback message
        }
        return NextResponse.json({ error: metaErr }, { status: 502 })
      }

      const metaBody: { data?: MetaFlow[]; paging?: { next?: string } } =
        await metaRes.json()
      if (metaBody.data) metaFlows.push(...metaBody.data)
      nextUrl = metaBody.paging?.next ?? null
    }

    let inserted = 0
    let updated = 0
    const errors: { name: string; message: string }[] = []

    for (const mf of metaFlows) {
      const status = mapStatus(mf.status)
      const description = mf.categories?.length
        ? `Categories: ${mf.categories.join(', ')}`
        : null

      // Download the latest screens JSON from Meta (non-fatal if it fails)
      const screens = await fetchFlowScreens(mf.id, accessToken)
      const triggerConfig: Record<string, unknown> = {
        meta_flow_id: mf.id,
        ...(screens ? { version: '7.1', screens } : {}),
      }

      try {
        const existing = await prisma.flow.findFirst({
          where: { account_id: accountId, name: mf.name, flow_type: 'whatsapp_flow' },
          select: { id: true },
        })

        if (existing) {
          // Only update status/description — never overwrite trigger_config.
          // The CRM stores custom fields (_source_table_id, _save_field_key, etc.)
          // inside trigger_config that must survive syncs from Meta.
          await prisma.flow.update({
            where: { id: existing.id },
            data: { status, description },
          })
          updated++
        } else {
          await prisma.flow.create({
            data: {
              account_id: accountId,
              user_id: session.user.id,
              name: mf.name,
              description,
              flow_type: 'whatsapp_flow',
              status,
              trigger_type: 'manual',
              trigger_config: triggerConfig as Prisma.InputJsonValue,
            },
          })
          inserted++
        }
      } catch (err) {
        errors.push({
          name: mf.name,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      total: metaFlows.length,
      inserted,
      updated,
      errors,
      truncated: pageCount >= PAGE_CAP && nextUrl !== null,
    })
  } catch (err) {
    console.error('[POST /api/flows/sync]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    )
  }
}
