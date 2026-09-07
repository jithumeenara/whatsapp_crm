import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { normalizeStatus } from '@/lib/whatsapp/template-status-normalize'
import type { TemplateButton, TemplateSampleValues } from '@/types'

/**
 * Sync message templates from Meta → local message_templates table.
 *
 * The local catalog stores Meta's status enum verbatim (APPROVED /
 * PENDING / REJECTED / PAUSED / DISABLED / IN_APPEAL / PENDING_DELETION)
 * so the edit / resubmit / delete flows can distinguish recoverable
 * states (PAUSED) from terminal ones (DISABLED) and so webhook events
 * land 1:1 without a translation table.
 *
 * Locally-created templates (no Meta counterpart) are NOT deleted —
 * they remain visible so the user can notice drift and clean up.
 */

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

interface MetaButton {
  type: string
  text: string
  url?: string
  phone_number?: string
  example?: string[] | string
  flow_id?: string
  navigate_screen?: string
  flow_action?: string
}

interface MetaTemplateComponent {
  type: string
  text?: string
  format?: string
  buttons?: MetaButton[]
  example?: {
    header_text?: string[]
    header_handle?: string[]
    body_text?: string[][]
  }
}

interface MetaTemplate {
  id: string
  name: string
  language: string
  status: string
  category: string
  components?: MetaTemplateComponent[]
  quality_score?: { score?: string } | string
}

function normalizeCategory(
  meta: string,
): 'Marketing' | 'Utility' | 'Authentication' {
  const upper = meta.toUpperCase()
  if (upper === 'UTILITY') return 'Utility'
  if (upper === 'AUTHENTICATION') return 'Authentication'
  return 'Marketing'
}

function normalizeQualityScore(
  raw: MetaTemplate['quality_score'],
): 'GREEN' | 'YELLOW' | 'RED' | null {
  const score =
    typeof raw === 'string' ? raw : raw?.score ? String(raw.score) : null
  if (!score) return null
  const upper = score.toUpperCase()
  return upper === 'GREEN' || upper === 'YELLOW' || upper === 'RED'
    ? (upper as 'GREEN' | 'YELLOW' | 'RED')
    : null
}

function parseButtons(metaButtons: MetaButton[] | undefined): TemplateButton[] {
  if (!metaButtons?.length) return []
  const out: TemplateButton[] = []
  for (const b of metaButtons) {
    switch (b.type?.toUpperCase()) {
      case 'QUICK_REPLY':
        out.push({ type: 'QUICK_REPLY', text: b.text })
        break
      case 'URL':
        out.push({
          type: 'URL',
          text: b.text,
          url: b.url ?? '',
          example: Array.isArray(b.example) ? b.example[0] : b.example,
        })
        break
      case 'PHONE_NUMBER':
        out.push({
          type: 'PHONE_NUMBER',
          text: b.text,
          phone_number: b.phone_number ?? '',
        })
        break
      case 'COPY_CODE':
        out.push({
          type: 'COPY_CODE',
          text: b.text,
          example: Array.isArray(b.example) ? b.example[0] ?? '' : b.example ?? '',
        })
        break
      case 'FLOW':
        out.push({
          type: 'FLOW',
          text: b.text,
          flow_id: b.flow_id ?? '',
          navigate_screen: b.navigate_screen,
          flow_action: (b.flow_action as 'navigate' | 'data_exchange') ?? 'navigate',
        })
        break
      // OTP, etc — drop silently.
    }
  }
  return out
}

function extractSampleValues(
  body: MetaTemplateComponent | undefined,
  header: MetaTemplateComponent | undefined,
): TemplateSampleValues | null {
  const bodySample = body?.example?.body_text?.[0]
  const headerSample = header?.example?.header_text
  if (!bodySample?.length && !headerSample?.length) return null
  const sv: TemplateSampleValues = {}
  if (bodySample?.length) sv.body = bodySample
  if (headerSample?.length) sv.header = headerSample
  return sv
}

export async function POST() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    // Resolve the caller's account_id — both whatsapp_config and
    // the message_templates we sync into are account-scoped.
    const profile = await prisma.profile.findUnique({
      where: { user_id: userId },
      select: { account_id: true },
    })
    const accountId = profile?.account_id
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const configs = await prisma.whatsAppConfig.findMany({
      where: { account_id: accountId },
    })

    if (configs.length === 0) {
      return NextResponse.json(
        {
          error:
            'WhatsApp not configured. Connect your WhatsApp Business account in Settings first.',
        },
        { status: 400 },
      )
    }

    // Templates are approved per-WABA (Finding #14) — a tenant with
    // several numbers can have several WABAs, or the same WABA shared
    // across numbers. Sync every DISTINCT WABA once, not once per number.
    const wabaEntries = new Map<string, { wabaId: string; accessToken: string }>()
    for (const c of configs) {
      if (c.waba_id && !wabaEntries.has(c.waba_id)) {
        wabaEntries.set(c.waba_id, { wabaId: c.waba_id, accessToken: decrypt(c.access_token) })
      }
    }

    if (wabaEntries.size === 0) {
      return NextResponse.json(
        {
          error:
            'WABA (WhatsApp Business Account) ID missing on every connected number. Re-connect your account(s) in Settings.',
        },
        { status: 400 },
      )
    }

    const metaTemplates: (MetaTemplate & { _waba_id: string })[] = []
    const PAGE_CAP = 20
    let truncatedAny = false

    for (const { wabaId, accessToken } of wabaEntries.values()) {
      let nextUrl: string | null = `${META_API_BASE}/${wabaId}/message_templates?limit=100&fields=id,name,language,status,category,components,quality_score`
      let pageCount = 0

      while (nextUrl && pageCount < PAGE_CAP) {
        pageCount++
        const metaRes: Response = await fetch(nextUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })

        if (!metaRes.ok) {
          let metaErr = `Meta API error: ${metaRes.status}`
          try {
            const body = await metaRes.json()
            if (body?.error?.message) metaErr = body.error.message
          } catch {
            // response wasn't JSON — keep the fallback
          }
          return NextResponse.json({ error: `WABA ${wabaId}: ${metaErr}` }, { status: 502 })
        }

        const metaBody: {
          data?: MetaTemplate[]
          paging?: { next?: string }
        } = await metaRes.json()
        if (metaBody.data) metaTemplates.push(...metaBody.data.map((t) => ({ ...t, _waba_id: wabaId })))
        nextUrl = metaBody.paging?.next ?? null
      }
      if (pageCount >= PAGE_CAP && nextUrl !== null) truncatedAny = true
    }

    let inserted = 0
    let updated = 0
    const errors: { name: string; language: string; message: string }[] = []

    for (const t of metaTemplates) {
      const body = (t.components ?? []).find((c) => c.type === 'BODY')
      const header = (t.components ?? []).find((c) => c.type === 'HEADER')
      const footer = (t.components ?? []).find((c) => c.type === 'FOOTER')
      const buttons = (t.components ?? []).find((c) => c.type === 'BUTTONS')

      const parsedButtons = parseButtons(buttons?.buttons)
      const sampleValues = extractSampleValues(body, header)

      const headerFormat = header?.format?.toUpperCase()
      const headerType =
        headerFormat === 'TEXT' ||
        headerFormat === 'IMAGE' ||
        headerFormat === 'VIDEO' ||
        headerFormat === 'DOCUMENT'
          ? headerFormat.toLowerCase()
          : null

      const sharedData = {
        account_id: accountId,
        user_id: userId,
        waba_id: t._waba_id,
        name: t.name,
        category: normalizeCategory(t.category),
        language: t.language,
        header_type: headerType,
        header_content: header?.text ?? null,
        header_handle: header?.example?.header_handle?.[0] ?? null,
        body_text: body?.text ?? '',
        footer_text: footer?.text ?? null,
        buttons: parsedButtons.length ? (parsedButtons as Prisma.InputJsonValue) : Prisma.JsonNull,
        sample_values: sampleValues != null ? (sampleValues as Prisma.InputJsonValue) : Prisma.JsonNull,
        status: normalizeStatus(t.status),
        meta_template_id: t.id,
        quality_score: normalizeQualityScore(t.quality_score),
      }

      try {
        const existingRow = await prisma.messageTemplate.findFirst({
          where: {
            account_id: accountId,
            waba_id: t._waba_id,
            name: t.name,
            language: t.language,
          },
          select: { id: true },
        })

        if (existingRow?.id) {
          await prisma.messageTemplate.update({
            where: { id: existingRow.id },
            data: sharedData,
          })
          updated++
        } else {
          await prisma.messageTemplate.create({
            data: sharedData,
          })
          inserted++
        }
      } catch (err) {
        errors.push({
          name: t.name,
          language: t.language,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      total: metaTemplates.length,
      inserted,
      updated,
      errors,
      truncated: truncatedAny,
    })
  } catch (error) {
    console.error('Error syncing WhatsApp templates:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to sync templates',
      },
      { status: 500 },
    )
  }
}
