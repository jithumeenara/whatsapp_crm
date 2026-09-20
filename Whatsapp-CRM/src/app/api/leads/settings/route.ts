import { NextRequest, NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { DEFAULT_SIGNALS, normalizeMode, normalizeThreshold, sanitizeSignals } from "@/lib/leads/ai-signals"

const VALID_SCORING_MODES = ["score", "quality", "both"] as const

type ListItem = { icon: string; label: string }

const DEFAULT_SCORE_OPTIONS: ListItem[] = [
  { icon: "🔥", label: "Hot" }, { icon: "🌡️", label: "Warm" }, { icon: "❄️", label: "Cold" },
]
const DEFAULT_NOT_CONNECTED: ListItem[] = [
  { icon: "📵", label: "Out of Coverage" }, { icon: "📳", label: "Busy" },
  { icon: "🔇", label: "Switched Off" }, { icon: "❌", label: "Invalid Number" },
]
const DEFAULT_CONNECTED: ListItem[] = [
  { icon: "🏢", label: "Visited" }, { icon: "📅", label: "Appointment Fixed" }, { icon: "🔄", label: "Follow-up" },
]
const DEFAULT_CLOSE_REASONS: ListItem[] = [
  { icon: "🎉", label: "Converted / Enrolled" }, { icon: "👎", label: "Not Interested" },
  { icon: "💰", label: "Budget Issue" }, { icon: "❓", label: "Wrong Enquiry" },
  { icon: "📋", label: "Duplicate" }, { icon: "📝", label: "Other" },
]
const DEFAULT_LEAD_SOURCES: ListItem[] = [
  { icon: "", label: "WhatsApp" }, { icon: "", label: "Instagram" },
  { icon: "🌐", label: "Website" }, { icon: "📣", label: "Campaign" },
  { icon: "🔗", label: "Referral" }, { icon: "👤", label: "Manual" },
  { icon: "📝", label: "Other" },
]

function normalise(raw: unknown, defaults: ListItem[]): ListItem[] {
  if (!Array.isArray(raw)) return defaults
  return raw.map((v) => {
    if (typeof v === "string") return { icon: "", label: v }
    if (v && typeof v === "object" && "label" in v) {
      return { icon: (v as { icon?: string }).icon ?? "", label: String((v as { label: unknown }).label) }
    }
    return { icon: "", label: String(v) }
  })
}

type RawRow = {
  auto_lead_creation: boolean
  scoring_mode: string
  sla_warn_hours: number | null
  sla_breach_hours: number | null
  score_options: unknown
  call_not_connected_labels: unknown
  call_connected_labels: unknown
  close_enquiry_reasons: unknown
  lead_sources: unknown
  ai_lead_enabled: boolean | null
  ai_lead_signals: unknown
  ai_lead_rules: string | null
  ai_lead_exclusions: string | null
  ai_lead_threshold: string | null
  ai_lead_mode: string | null
  ai_lead_min_messages: number | null
  ai_lead_recheck_hours: number | null
}

async function ensureColumns(accountId: string) {
  await prisma.$executeRaw`
    ALTER TABLE lead_settings ADD COLUMN IF NOT EXISTS close_enquiry_reasons JSONB
  `
  await prisma.$executeRaw`
    ALTER TABLE lead_settings ADD COLUMN IF NOT EXISTS score_options JSONB
  `
  await prisma.$executeRaw`
    ALTER TABLE lead_settings ADD COLUMN IF NOT EXISTS lead_sources JSONB
  `
  // Same belt-and-braces as the columns above: the raw SELECT below
  // names these, so a deployment that has not run migration 095 yet
  // would fail the whole settings read rather than default them.
  await prisma.$executeRaw`
    ALTER TABLE lead_settings ADD COLUMN IF NOT EXISTS sla_warn_hours INTEGER NOT NULL DEFAULT 24
  `
  await prisma.$executeRaw`
    ALTER TABLE lead_settings ADD COLUMN IF NOT EXISTS sla_breach_hours INTEGER NOT NULL DEFAULT 72
  `
  // Migration 097's columns, defended the same way. This route reads
  // them by name, so a VPS that has pulled the code but not yet run the
  // migration would 500 on the whole settings screen rather than on the
  // one section that is genuinely missing.
  await prisma.$executeRaw`
    ALTER TABLE lead_settings ADD COLUMN IF NOT EXISTS ai_lead_enabled BOOLEAN NOT NULL DEFAULT false
  `
  await prisma.$executeRaw`ALTER TABLE lead_settings ADD COLUMN IF NOT EXISTS ai_lead_signals JSONB`
  await prisma.$executeRaw`ALTER TABLE lead_settings ADD COLUMN IF NOT EXISTS ai_lead_rules TEXT`
  await prisma.$executeRaw`ALTER TABLE lead_settings ADD COLUMN IF NOT EXISTS ai_lead_exclusions TEXT`
  await prisma.$executeRaw`
    ALTER TABLE lead_settings ADD COLUMN IF NOT EXISTS ai_lead_threshold TEXT NOT NULL DEFAULT 'balanced'
  `
  await prisma.$executeRaw`
    ALTER TABLE lead_settings ADD COLUMN IF NOT EXISTS ai_lead_mode TEXT NOT NULL DEFAULT 'suggest'
  `
  await prisma.$executeRaw`
    ALTER TABLE lead_settings ADD COLUMN IF NOT EXISTS ai_lead_min_messages INTEGER NOT NULL DEFAULT 2
  `
  await prisma.$executeRaw`
    ALTER TABLE lead_settings ADD COLUMN IF NOT EXISTS ai_lead_recheck_hours INTEGER NOT NULL DEFAULT 6
  `
  await prisma.leadSettings.upsert({
    where:  { account_id: accountId },
    update: {},
    create: { account_id: accountId },
  })
}

/** The AI half of the payload, shaped the same on both GET and PATCH so
 *  the settings screen can trust one response to be the whole truth. */
function aiLeadPayload(row: RawRow | undefined) {
  return {
    ai_lead_enabled:       row?.ai_lead_enabled === true,
    // No stored list means never configured, not "none ticked" — a
    // fresh account should see the four that are a signal everywhere,
    // not an empty checklist that detects nothing.
    ai_lead_signals:       Array.isArray(row?.ai_lead_signals)
                             ? sanitizeSignals(row?.ai_lead_signals)
                             : DEFAULT_SIGNALS,
    ai_lead_rules:         row?.ai_lead_rules ?? "",
    ai_lead_exclusions:    row?.ai_lead_exclusions ?? "",
    ai_lead_threshold:     normalizeThreshold(row?.ai_lead_threshold),
    ai_lead_mode:          normalizeMode(row?.ai_lead_mode),
    ai_lead_min_messages:  row?.ai_lead_min_messages ?? 2,
    ai_lead_recheck_hours: row?.ai_lead_recheck_hours ?? 6,
  }
}

export async function GET() {
  try {
    const ctx = await requireRole("agent")
    await ensureColumns(ctx.accountId)

    const rows = await prisma.$queryRaw<RawRow[]>`
      SELECT auto_lead_creation,
             scoring_mode,
             sla_warn_hours,
             sla_breach_hours,
             score_options,
             call_not_connected_labels,
             call_connected_labels,
             close_enquiry_reasons,
             lead_sources,
             ai_lead_enabled,
             ai_lead_signals,
             ai_lead_rules,
             ai_lead_exclusions,
             ai_lead_threshold,
             ai_lead_mode,
             ai_lead_min_messages,
             ai_lead_recheck_hours
      FROM   lead_settings
      WHERE  account_id = ${ctx.accountId}::uuid
      LIMIT  1
    `
    const row = rows[0]

    return NextResponse.json({
      auto_lead_creation:        row?.auto_lead_creation   ?? false,
      scoring_mode:              row?.scoring_mode         ?? "score",
      sla_warn_hours:            row?.sla_warn_hours       ?? 24,
      sla_breach_hours:          row?.sla_breach_hours     ?? 72,
      score_options:             normalise(row?.score_options,             DEFAULT_SCORE_OPTIONS),
      call_not_connected_labels: normalise(row?.call_not_connected_labels, DEFAULT_NOT_CONNECTED),
      call_connected_labels:     normalise(row?.call_connected_labels,     DEFAULT_CONNECTED),
      close_enquiry_reasons:     normalise(row?.close_enquiry_reasons,     DEFAULT_CLOSE_REASONS),
      lead_sources:              normalise(row?.lead_sources,              DEFAULT_LEAD_SOURCES),
      ...aiLeadPayload(row),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireRole("supervisor")
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })

    await ensureColumns(ctx.accountId)

    // ── ORM fields ─────────────────────────────────────────────────────────────
    const ormData: {
      auto_lead_creation?: boolean
      scoring_mode?: string
      sla_warn_hours?: number
      sla_breach_hours?: number
    } = {}

    // Clamped rather than rejected. These come from a slider, and a
    // value outside the range is a mis-drag, not an attack; the useful
    // response is the nearest sane number. 0 is meaningful — it is how
    // an account turns the marking off — so the floor is 0, not 1.
    const hours = (v: unknown): number | undefined =>
      typeof v === "number" && Number.isFinite(v)
        ? Math.min(24 * 30, Math.max(0, Math.round(v)))
        : undefined

    const warn = hours(body.sla_warn_hours)
    if (warn !== undefined) ormData.sla_warn_hours = warn
    const breach = hours(body.sla_breach_hours)
    if (breach !== undefined) ormData.sla_breach_hours = breach

    // A breach that fires before the warning is a warning nobody sees.
    if (
      ormData.sla_warn_hours !== undefined &&
      ormData.sla_breach_hours !== undefined &&
      ormData.sla_breach_hours > 0 &&
      ormData.sla_breach_hours < ormData.sla_warn_hours
    ) {
      return NextResponse.json(
        { error: "The overdue threshold has to be at least as long as the warning one." },
        { status: 400 },
      )
    }

    if (typeof body.auto_lead_creation === "boolean") {
      ormData.auto_lead_creation = body.auto_lead_creation
    }
    if (body.scoring_mode !== undefined) {
      if (!VALID_SCORING_MODES.includes(body.scoring_mode)) {
        return NextResponse.json({ error: "Invalid scoring_mode" }, { status: 400 })
      }
      ormData.scoring_mode = body.scoring_mode
    }

    await prisma.leadSettings.upsert({
      where:  { account_id: ctx.accountId },
      update: ormData,
      create: { account_id: ctx.accountId, ...ormData },
    })

    // ── JSON columns via raw SQL ────────────────────────────────────────────────
    function toListItems(raw: unknown[]): ListItem[] {
      return raw
        .map((v) => {
          if (typeof v === "string" && v.trim()) return { icon: "", label: v.trim() }
          if (v && typeof v === "object" && "label" in v) {
            const label = String((v as { label: unknown }).label).trim()
            if (!label) return null
            return { icon: String((v as { icon?: unknown }).icon ?? ""), label }
          }
          return null
        })
        .filter((v): v is ListItem => v !== null)
    }

    if (Array.isArray(body.score_options)) {
      const opts = toListItems(body.score_options as unknown[])
      if (opts.length > 0) {
        await prisma.$executeRaw`
          UPDATE lead_settings
          SET    score_options = ${JSON.stringify(opts)}::jsonb
          WHERE  account_id = ${ctx.accountId}::uuid
        `
      }
    }

    if (Array.isArray(body.call_not_connected_labels)) {
      const labels = toListItems(body.call_not_connected_labels as unknown[])
      if (labels.length > 0) {
        await prisma.$executeRaw`
          UPDATE lead_settings
          SET    call_not_connected_labels = ${JSON.stringify(labels)}::jsonb
          WHERE  account_id = ${ctx.accountId}::uuid
        `
      }
    }

    if (Array.isArray(body.call_connected_labels)) {
      const labels = toListItems(body.call_connected_labels as unknown[])
      if (labels.length > 0) {
        await prisma.$executeRaw`
          UPDATE lead_settings
          SET    call_connected_labels = ${JSON.stringify(labels)}::jsonb
          WHERE  account_id = ${ctx.accountId}::uuid
        `
      }
    }

    if (Array.isArray(body.close_enquiry_reasons)) {
      const reasons = toListItems(body.close_enquiry_reasons as unknown[])
      await prisma.$executeRaw`
        UPDATE lead_settings
        SET    close_enquiry_reasons = ${JSON.stringify(reasons)}::jsonb
        WHERE  account_id = ${ctx.accountId}::uuid
      `
    }

    if (Array.isArray(body.lead_sources)) {
      const sources = toListItems(body.lead_sources as unknown[])
      await prisma.$executeRaw`
        UPDATE lead_settings
        SET    lead_sources = ${JSON.stringify(sources)}::jsonb
        WHERE  account_id = ${ctx.accountId}::uuid
      `
    }

    // ── What counts as a lead, in this account's words ──────────────────────────
    //
    // Raw SQL for the same reason the lists above use it: these columns
    // are added by ensureColumns at runtime, so a client generated
    // before migration 097 still writes them correctly.

    if (typeof body.ai_lead_enabled === "boolean") {
      await prisma.$executeRaw`
        UPDATE lead_settings SET ai_lead_enabled = ${body.ai_lead_enabled}
        WHERE account_id = ${ctx.accountId}::uuid
      `
    }

    if (Array.isArray(body.ai_lead_signals)) {
      // Filtered to keys this build knows. A stored key nothing defines
      // would become an instruction with no text behind it.
      const signals = sanitizeSignals(body.ai_lead_signals)
      await prisma.$executeRaw`
        UPDATE lead_settings SET ai_lead_signals = ${JSON.stringify(signals)}::jsonb
        WHERE account_id = ${ctx.accountId}::uuid
      `
    }

    // Free text, and long enough for a real paragraph — this is where an
    // account says what its own business counts, and a cramped box is
    // how that ends up being one word.
    if (typeof body.ai_lead_rules === "string") {
      await prisma.$executeRaw`
        UPDATE lead_settings SET ai_lead_rules = ${body.ai_lead_rules.slice(0, 4000)}
        WHERE account_id = ${ctx.accountId}::uuid
      `
    }
    if (typeof body.ai_lead_exclusions === "string") {
      await prisma.$executeRaw`
        UPDATE lead_settings SET ai_lead_exclusions = ${body.ai_lead_exclusions.slice(0, 4000)}
        WHERE account_id = ${ctx.accountId}::uuid
      `
    }

    if (body.ai_lead_threshold !== undefined) {
      await prisma.$executeRaw`
        UPDATE lead_settings SET ai_lead_threshold = ${normalizeThreshold(body.ai_lead_threshold)}
        WHERE account_id = ${ctx.accountId}::uuid
      `
    }
    if (body.ai_lead_mode !== undefined) {
      await prisma.$executeRaw`
        UPDATE lead_settings SET ai_lead_mode = ${normalizeMode(body.ai_lead_mode)}
        WHERE account_id = ${ctx.accountId}::uuid
      `
    }

    // Clamped, not rejected, same as the SLA hours above: these come
    // from number inputs and a value outside the range is a typo.
    const clamp = (v: unknown, lo: number, hi: number): number | null =>
      typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : null

    const minMessages = clamp(body.ai_lead_min_messages, 1, 20)
    if (minMessages !== null) {
      await prisma.$executeRaw`
        UPDATE lead_settings SET ai_lead_min_messages = ${minMessages}
        WHERE account_id = ${ctx.accountId}::uuid
      `
    }
    // 0 means "check every time", which is a real choice for a low
    // volume account, so the floor is 0 rather than 1.
    const recheck = clamp(body.ai_lead_recheck_hours, 0, 24 * 30)
    if (recheck !== null) {
      await prisma.$executeRaw`
        UPDATE lead_settings SET ai_lead_recheck_hours = ${recheck}
        WHERE account_id = ${ctx.accountId}::uuid
      `
    }

    // ── Return persisted state ──────────────────────────────────────────────────
    const rows = await prisma.$queryRaw<RawRow[]>`
      SELECT auto_lead_creation,
             scoring_mode,
             score_options,
             call_not_connected_labels,
             call_connected_labels,
             close_enquiry_reasons,
             lead_sources,
             ai_lead_enabled,
             ai_lead_signals,
             ai_lead_rules,
             ai_lead_exclusions,
             ai_lead_threshold,
             ai_lead_mode,
             ai_lead_min_messages,
             ai_lead_recheck_hours
      FROM   lead_settings
      WHERE  account_id = ${ctx.accountId}::uuid
      LIMIT  1
    `
    const row = rows[0]

    return NextResponse.json({
      auto_lead_creation:        row?.auto_lead_creation   ?? false,
      scoring_mode:              row?.scoring_mode         ?? "score",
      score_options:             normalise(row?.score_options,             DEFAULT_SCORE_OPTIONS),
      call_not_connected_labels: normalise(row?.call_not_connected_labels, DEFAULT_NOT_CONNECTED),
      call_connected_labels:     normalise(row?.call_connected_labels,     DEFAULT_CONNECTED),
      close_enquiry_reasons:     normalise(row?.close_enquiry_reasons,     DEFAULT_CLOSE_REASONS),
      lead_sources:              normalise(row?.lead_sources,              DEFAULT_LEAD_SOURCES),
      ...aiLeadPayload(row),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
