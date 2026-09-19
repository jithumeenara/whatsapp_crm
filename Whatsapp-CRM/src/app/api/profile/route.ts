import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { sanitizeQuickLinks } from "@/lib/navigation/sections"
import { isValidE164 } from "@/lib/whatsapp/phone-utils"
import { NextRequest, NextResponse } from "next/server"

/**
 * PATCH /api/profile
 * Update display name, avatar URL, and/or WhatsApp phone for the current
 * user's profile. Avatar upload itself goes through /api/upload; this
 * endpoint just saves the resulting URL (or null to remove). Changing
 * `phone` always clears phone_verified_at — an edited number can't inherit
 * the old number's verified status.
 */
export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireRole("viewer")
    const body = (await req.json()) as {
      full_name?: string
      avatar_url?: string | null
      phone?: string | null
      preferred_language?: string | null
      /** Ordered hrefs; validated against the app's own navigation. */
      quick_links?: unknown
      quick_links_enabled?: boolean
    }

    const data: Record<string, unknown> = {}
    if (typeof body.full_name === "string") {
      const name = body.full_name.trim()
      if (!name) {
        return NextResponse.json(
          { error: "full_name cannot be empty" },
          { status: 400 },
        )
      }
      data.full_name = name
    }
    if ("avatar_url" in body) {
      data.avatar_url = body.avatar_url ?? null
    }
    if ("phone" in body) {
      const trimmed = typeof body.phone === "string" ? body.phone.trim() : ""
      if (trimmed && !isValidE164(trimmed)) {
        return NextResponse.json({ error: "Enter a valid WhatsApp number for the selected country" }, { status: 400 })
      }
      data.phone = trimmed || null
      data.phone_verified_at = null
    }
    if ("preferred_language" in body) {
      const lang = typeof body.preferred_language === "string" ? body.preferred_language.trim() : ""
      data.preferred_language = lang || null
    }
    if ("quick_links" in body) {
      // Sanitised rather than trusted: an href for a page that no longer
      // exists would render as a row that goes nowhere, and this comes
      // from a request body.
      data.quick_links = sanitizeQuickLinks(body.quick_links)
    }
    if (typeof body.quick_links_enabled === "boolean") {
      data.quick_links_enabled = body.quick_links_enabled
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
    }

    const profile = await prisma.profile.update({
      where: { user_id: ctx.userId },
      data,
      select: {
        id: true,
        full_name: true,
        email: true,
        avatar_url: true,
        phone: true,
        phone_verified_at: true,
        account_id: true,
        account_role: true,
        preferred_language: true,
        quick_links: true,
        quick_links_enabled: true,
      },
    })

    return NextResponse.json({ profile })
  } catch (err) {
    return toErrorResponse(err)
  }
}
