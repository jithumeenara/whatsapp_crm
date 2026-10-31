/**
 * How a "check your details" page looks: the same logo, colour, tagline
 * and contact card as the business's own public form, so a person who
 * registered on that form recognises the page. Taken from the account's
 * switched-on form whose look was set most recently; with no such form,
 * the page keeps the plain default look.
 */

import { prisma } from '@/lib/db'
import { BRAND_COLORS, DEFAULT_BRAND, parseBrand, type FormBrand } from '@/lib/data-store/form-logic'
import { decrypt } from '@/lib/whatsapp/encryption'
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api'
import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'

/** A chosen WhatsApp number must be one of this account's own (or none). */
export async function ownsWhatsAppNumber(accountId: string, configId: string | null): Promise<boolean> {
  if (!configId) return true
  const n = await prisma.whatsAppConfig.count({ where: { id: configId, account_id: accountId } })
  return n > 0
}

export interface HelpButtons {
  /** tel: target, digits with an optional leading +. */
  call: string | null
  callLabel: string | null
  /** wa.me link with the business's text already typed. */
  whatsapp: string | null
}

export const NO_HELP: HelpButtons = { call: null, callLabel: null, whatsapp: null }

/** Display numbers change almost never; Meta is asked once an hour per number. */
const waNumberCache = new Map<string, { at: number; digits: string | null }>()
const WA_CACHE_MS = 60 * 60_000

async function waDigits(accountId: string, configId: string): Promise<string | null> {
  const hit = waNumberCache.get(configId)
  if (hit && Date.now() - hit.at < WA_CACHE_MS) return hit.digits
  let digits: string | null = null
  try {
    const config = await prisma.whatsAppConfig.findFirst({ where: { id: configId, account_id: accountId }, select: { phone_number_id: true, access_token: true } })
    if (config) {
      const info = await verifyPhoneNumber({ phoneNumberId: config.phone_number_id, accessToken: decrypt(config.access_token) })
      digits = sanitizePhoneForMeta(info.display_phone_number) || null
    }
  } catch (err) {
    console.error('[verify-brand] WhatsApp number not read:', err instanceof Error ? err.message : err)
    // Keep the last good number through a short Meta outage.
    if (hit) return hit.digits
  }
  waNumberCache.set(configId, { at: Date.now(), digits })
  return digits
}

/** The Call and WhatsApp buttons a list's page shows; none when not set up. */
export async function helpButtons(v: {
  account_id: string
  help_whatsapp_config_id: string | null
  help_whatsapp_text: string | null
  help_call_phone: string | null
}): Promise<HelpButtons> {
  let callLabel = v.help_call_phone?.trim() || null
  if (!callLabel) {
    const company = await prisma.companyProfile.findUnique({ where: { account_id: v.account_id }, select: { phone: true } }).catch(() => null)
    callLabel = company?.phone?.trim() || null
  }
  const call = callLabel ? callLabel.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '') || null : null
  let whatsapp: string | null = null
  if (v.help_whatsapp_config_id) {
    const digits = await waDigits(v.account_id, v.help_whatsapp_config_id)
    if (digits) {
      const text = v.help_whatsapp_text?.trim()
      whatsapp = `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`
    }
  }
  return { call, callLabel: call ? callLabel : null, whatsapp }
}

export interface VerifyBrand {
  color: string | null
  tagline: string | null
  logoUrl: string | null
  contact: { phone: string | null; email: string | null; website: string | null; address: string | null } | null
}

export const PLAIN_BRAND: VerifyBrand = { color: null, tagline: null, logoUrl: null, contact: null }

interface FormRow {
  form_token: string | null
  form_config: unknown
  updated_at: Date
}

/** A form whose look was chosen (a logo, a colour or a tagline), not left as it came. */
function styled(b: FormBrand): boolean {
  return !!b.logo_file_id || !!b.tagline || b.color !== DEFAULT_BRAND.color
}

/** The switched-on form to borrow the look from: styled ones first, then the latest. Pure, for tests. */
export function pickBrandForm(rows: FormRow[]): { token: string; brand: FormBrand } | null {
  const live = rows
    .map((r) => {
      const c = r.form_config && typeof r.form_config === 'object' ? (r.form_config as Record<string, unknown>) : null
      return c?.enabled === true && r.form_token ? { token: r.form_token, brand: parseBrand(c.brand), at: r.updated_at.getTime() } : null
    })
    .filter((x): x is { token: string; brand: FormBrand; at: number } => !!x)
    .sort((a, b) => Number(styled(b.brand)) - Number(styled(a.brand)) || b.at - a.at)
  return live[0] ? { token: live[0].token, brand: live[0].brand } : null
}

export async function verifyBrand(accountId: string): Promise<VerifyBrand> {
  const rows = await prisma.dataTable
    .findMany({
      where: { account_id: accountId, form_token: { not: null } },
      select: { form_token: true, form_config: true, updated_at: true },
      orderBy: { updated_at: 'desc' },
      take: 50,
    })
    .catch(() => [] as FormRow[])
  const pick = pickBrandForm(rows)
  if (!pick) return PLAIN_BRAND

  let contact: VerifyBrand['contact'] = null
  if (pick.brand.show_contact) {
    const company = await prisma.companyProfile
      .findUnique({ where: { account_id: accountId }, select: { phone: true, email: true, website: true, address: true, city: true } })
      .catch(() => null)
    const website = company?.website?.trim()
    const c = {
      phone: company?.phone?.trim() || null,
      email: company?.email?.trim() || null,
      // Only a web address becomes a link on the page.
      website: website ? (/^https?:\/\//i.test(website) ? website : `https://${website}`) : null,
      address: [company?.address?.trim(), company?.city?.trim()].filter(Boolean).join(', ') || null,
    }
    contact = Object.values(c).some(Boolean) ? c : null
  }

  return {
    color: BRAND_COLORS[pick.brand.color].hex,
    tagline: pick.brand.tagline,
    // The form's own logo route serves only the image its settings name.
    logoUrl: pick.brand.logo_file_id ? `/api/forms/${pick.token}/logo` : null,
    contact,
  }
}
