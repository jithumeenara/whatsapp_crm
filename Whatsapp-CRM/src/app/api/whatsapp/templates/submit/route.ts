import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { submitMessageTemplate } from '@/lib/whatsapp/meta-api'
import {
  validateTemplatePayload,
  type TemplatePayload,
} from '@/lib/whatsapp/template-validators'
import { buildMetaTemplatePayload } from '@/lib/whatsapp/template-components'
import { normalizeStatus } from '@/lib/whatsapp/template-status-normalize'
import { resolveWhatsAppConfig } from '@/lib/whatsapp/resolve-config'

// Unverified WABAs are capped at 250 total templates (verified ones go up
// to 6,000). Meta doesn't expose verification tier anywhere this app reads
// today, so this is a conservative, always-safe warning threshold — never
// a hard block, since a verified account legitimately has room to keep
// creating past it.
const TEMPLATE_CEILING_WARNING = 250

/**
 * Shared upsert payload builder — both the Meta-failure path and the
 * Meta-success path write nearly identical rows; dropping the shared
 * fields here means adding a column later only touches one spot.
 */
function buildUpsertData(
  accountId: string,
  userId: string,
  payload: TemplatePayload,
  extras: {
    status: 'DRAFT' | string
    metaTemplateId: string | null
    submissionError: string | null
    wabaId: string | null
  },
) {
  return {
    // Account tenancy — required NOT NULL on message_templates.
    account_id: accountId,
    // Original author — kept as audit only.
    user_id: userId,
    // Which WABA this template belongs to (Finding #14) — null only for
    // the dry-run path, where there's no real Meta connection at all.
    waba_id: extras.wabaId,
    name: payload.name,
    category: payload.category,
    language: payload.language,
    header_type: payload.header_type ?? null,
    header_content: payload.header_content ?? null,
    header_media_url: payload.header_media_url ?? null,
    header_handle: payload.header_handle ?? null,
    body_text: payload.body_text,
    footer_text: payload.footer_text ?? null,
    buttons: payload.buttons != null ? (payload.buttons as Prisma.InputJsonValue) : Prisma.JsonNull,
    sample_values: payload.sample_values != null ? (payload.sample_values as Prisma.InputJsonValue) : Prisma.JsonNull,
    status: extras.status,
    meta_template_id: extras.metaTemplateId,
    submission_error: extras.submissionError,
    // Clear stale rejection_reason whenever we re-submit
    rejection_reason: null,
    last_submitted_at: new Date(),
  }
}

async function upsertTemplateRow(
  accountId: string,
  userId: string,
  payload: TemplatePayload,
  extras: {
    status: 'DRAFT' | string
    metaTemplateId: string | null
    submissionError: string | null
    wabaId: string | null
  },
) {
  const data = buildUpsertData(accountId, userId, payload, extras)

  // Manual find-then-create/update rather than Prisma's typed .upsert()
  // — the compound unique key (account_id, waba_id, name, language) as
  // of Finding #14 requires a non-null waba_id in its typed where-input
  // even though the column itself is nullable (the dry-run path has no
  // real WABA at all), so a plain findFirst sidesteps that mismatch.
  const existingRow = await prisma.messageTemplate.findFirst({
    where: { account_id: accountId, waba_id: extras.wabaId, name: payload.name, language: payload.language ?? 'en_US' },
    select: { id: true },
  })
  if (existingRow) {
    return prisma.messageTemplate.update({ where: { id: existingRow.id }, data })
  }
  return prisma.messageTemplate.create({ data })
}

/**
 * Submit a template to Meta for approval AND persist it locally.
 *
 * Auth → fetch whatsapp_config → validate → (DRY_RUN short-circuit) →
 * POST to Meta → upsert local row by (account_id, name, language) with
 * status, meta_template_id, sample_values, last_submitted_at.
 *
 * When WHATSAPP_TEMPLATES_DRY_RUN=true, we skip the network call and
 * insert a row with a synthetic `dry-run-<uuid>` meta_template_id so
 * CI / local dev can exercise the full UI without a real Meta App.
 */
export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    // Resolve the caller's account_id — whatsapp_config + the
    // message_templates row are account-scoped.
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

    let payload: TemplatePayload
    try {
      payload = (await request.json()) as TemplatePayload
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }

    if (payload.category === 'Authentication') {
      return NextResponse.json(
        {
          error:
            'AUTHENTICATION templates are not yet supported here — create them in Meta WhatsApp Manager and use "Sync from Meta".',
        },
        { status: 400 },
      )
    }

    try {
      validateTemplatePayload(payload)
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Validation failed.' },
        { status: 400 },
      )
    }

    const metaPayload = buildMetaTemplatePayload(payload)

    // Proactive heads-up only — never blocks the create. Meta is the real
    // authority on the actual cap (250 unverified / 6,000 verified); this
    // just warns before that call, using the conservative threshold.
    const existingCount = await prisma.messageTemplate.count({ where: { account_id: accountId } })
    const ceilingWarning =
      existingCount >= TEMPLATE_CEILING_WARNING
        ? `You have ${existingCount} templates. Unverified WhatsApp Business Accounts are capped at 250 total — this one may be rejected by Meta unless your business is verified (verified accounts go up to 6,000).`
        : null

    const dryRun =
      process.env.WHATSAPP_TEMPLATES_DRY_RUN === 'true' ||
      process.env.WHATSAPP_TEMPLATES_DRY_RUN === '1'

    let metaTemplateId: string
    let metaStatus: string
    // Which WABA this template gets created under (Finding #14) — the
    // account's default number for this pass; a future WABA picker in
    // the Templates UI can widen this to an explicit choice.
    let targetWabaId: string | null = null

    if (dryRun) {
      metaTemplateId = `dry-run-${crypto.randomUUID()}`
      metaStatus = 'PENDING'
    } else {
      const config = await resolveWhatsAppConfig({ accountId }).catch(() => null)
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
              'WABA (WhatsApp Business Account) ID missing. Re-connect your account in Settings.',
          },
          { status: 400 },
        )
      }
      targetWabaId = config.waba_id

      const accessToken = decrypt(config.access_token)
      try {
        const meta = await submitMessageTemplate({
          wabaId: config.waba_id,
          accessToken,
          payload: metaPayload,
        })
        metaTemplateId = meta.id
        metaStatus = meta.status
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Meta submit failed.'
        // Persist the failure so the user can retry; row stays DRAFT
        // until they fix and re-submit.
        await upsertTemplateRow(accountId, userId, payload, {
          status: 'DRAFT',
          metaTemplateId: null,
          submissionError: message,
          wabaId: targetWabaId,
        }).catch(() => {/* best-effort */})
        const isRateLimit = /\b429\b/.test(message)
        return NextResponse.json(
          {
            error: isRateLimit
              ? 'Meta rate limit hit (100 template creates per hour). Try again later.'
              : message,
          },
          { status: isRateLimit ? 429 : 502 },
        )
      }
    }

    let row: unknown
    try {
      row = await upsertTemplateRow(accountId, userId, payload, {
        status: normalizeStatus(metaStatus),
        metaTemplateId,
        submissionError: null,
        wabaId: targetWabaId,
      })
    } catch (err) {
      // The submit succeeded on Meta's side but we failed to persist
      // locally. Surface the meta_template_id so the user can recover
      // via "Sync from Meta".
      return NextResponse.json(
        {
          error: `Submitted to Meta but failed to save locally: ${err instanceof Error ? err.message : String(err)}. Run "Sync from Meta" to recover.`,
          meta_template_id: metaTemplateId,
        },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      template: row,
      dry_run: dryRun,
      warning: ceilingWarning,
    })
  } catch (error) {
    console.error('Error submitting template:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to submit template.',
      },
      { status: 500 },
    )
  }
}
