import { NextRequest, NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"

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
  score_options: unknown
  call_not_connected_labels: unknown
  call_connected_labels: unknown
  close_enquiry_reasons: unknown
  lead_sources: unknown
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
  await prisma.leadSettings.upsert({
    where:  { account_id: accountId },
    update: {},
    create: { account_id: accountId },
  })
}

export async function GET() {
  try {
    const ctx = await requireRole("agent")
    await ensureColumns(ctx.accountId)

    const rows = await prisma.$queryRaw<RawRow[]>`
      SELECT auto_lead_creation,
             scoring_mode,
             score_options,
             call_not_connected_labels,
             call_connected_labels,
             close_enquiry_reasons,
             lead_sources
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
    const ormData: { auto_lead_creation?: boolean; scoring_mode?: string } = {}

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

    // ── Return persisted state ──────────────────────────────────────────────────
    const rows = await prisma.$queryRaw<RawRow[]>`
      SELECT auto_lead_creation,
             scoring_mode,
             score_options,
             call_not_connected_labels,
             call_connected_labels,
             close_enquiry_reasons,
             lead_sources
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
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
