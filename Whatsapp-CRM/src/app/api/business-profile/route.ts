import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { auditCtx } from '@/lib/audit'
import { auditConfigChange } from '@/lib/audit/config-change'
import { isValidCountryIso, isValidCurrency, isValidReportLanguage } from '@/lib/countries'
import { repriceUnpricedCosts } from '@/lib/whatsapp/message-cost'

/**
 * The business's country, currency, tax number and report language: what
 * the Spending report and the report PDF's header print.
 *
 * Any member may read it (it is the business's own header). Only an admin
 * changes it. Every value is checked against a list the server holds, never
 * trusted because it looks right; the logo has its own route, and nothing
 * else in the body is copied.
 */

/** A GST / tax number: letters, digits, space . / - and nothing a page could run. */
const TAX_ID = /^[A-Za-z0-9][A-Za-z0-9 ./-]{0,39}$/

export async function GET() {
  try {
    const ctx = await requireRole('viewer')
    const [account, profile] = await Promise.all([
      prisma.account.findUnique({ where: { id: ctx.accountId }, select: { default_currency: true } }),
      prisma.accountReportProfile.findUnique({ where: { account_id: ctx.accountId } }),
    ])
    return NextResponse.json({
      country_iso: profile?.country_iso ?? null,
      currency: account?.default_currency ?? null,
      currency_effective_from: profile?.currency_effective_from ?? null,
      tax_id: profile?.tax_id ?? null,
      report_language: profile?.report_language ?? 'en',
      // The file itself is served by /api/business-profile/logo; its id stays here.
      has_logo: Boolean(profile?.logo_file_id),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Send the details to save.' }, { status: 400 })
    }

    const update: Record<string, unknown> = {}
    let newCurrency: string | null = null

    if ('country_iso' in body) {
      const v = body.country_iso
      if (v === null || v === '') update.country_iso = null
      else if (isValidCountryIso(v)) update.country_iso = v.trim().toUpperCase()
      else return NextResponse.json({ error: 'Choose a country from the list.' }, { status: 400 })
    }
    if ('report_language' in body) {
      const v = body.report_language
      if (v === null || v === '') update.report_language = 'en'
      else if (isValidReportLanguage(v)) update.report_language = v
      else return NextResponse.json({ error: 'Choose a report language from the list.' }, { status: 400 })
    }
    if ('tax_id' in body) {
      const v = body.tax_id
      if (v === null || (typeof v === 'string' && !v.trim())) update.tax_id = null
      else if (typeof v === 'string' && TAX_ID.test(v.trim())) update.tax_id = v.trim()
      else {
        return NextResponse.json(
          { error: 'The tax number can have letters, digits, spaces and . / - only, up to 40 characters.' },
          { status: 400 },
        )
      }
    }
    if ('currency' in body) {
      if (!isValidCurrency(body.currency)) {
        return NextResponse.json({ error: 'Choose a currency from the list.' }, { status: 400 })
      }
      newCurrency = body.currency.trim().toUpperCase()
    }

    const fields = Object.keys(update)
    let currencyChanged = false
    if (newCurrency) {
      const account = await prisma.account.findUnique({ where: { id: ctx.accountId }, select: { default_currency: true } })
      if ((account?.default_currency ?? '').toUpperCase() !== newCurrency) {
        await prisma.account.update({ where: { id: ctx.accountId }, data: { default_currency: newCurrency } })
        // History keeps the currency it was made in; reports say from when the new one applies.
        update.currency_effective_from = new Date()
        currencyChanged = true
        fields.push('currency')
      }
    }

    if (Object.keys(update).length === 0) {
      if (newCurrency) return NextResponse.json({ ok: true, currency_changed: false })
      return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 })
    }

    await prisma.accountReportProfile.upsert({
      where: { account_id: ctx.accountId },
      update: { ...update, updated_at: new Date() },
      create: { account_id: ctx.accountId, ...update },
    })

    if (currencyChanged) {
      // Costs that had no rate card for the old currency can be priced now. A
      // failure here never undoes the save.
      await repriceUnpricedCosts(ctx.accountId).catch((err) =>
        console.error('[business-profile] repricing failed:', err instanceof Error ? err.message : err),
      )
    }

    // Which details changed, never their values.
    await auditConfigChange(auditCtx(req, ctx), 'config.other_changed', { area: 'business_profile', fields })

    return NextResponse.json({ ok: true, currency_changed: currencyChanged })
  } catch (err) {
    return toErrorResponse(err)
  }
}
