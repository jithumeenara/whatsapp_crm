import { NextRequest, NextResponse } from "next/server"
import { requireRoleOrApiKey, toErrorResponse } from "@/lib/auth/account"
import { buildFetchHeaders, fetchExternalRows, detectFieldTypes } from "@/lib/integration-fetch"

/**
 * POST /api/integrations/test
 * Tests an external API connection WITHOUT saving anything.
 * Returns sample records + detected field types.
 */
export async function POST(req: NextRequest) {
  try {
    await requireRoleOrApiKey(req, "admin")

    const body = await req.json() as {
      source_type: string
      base_url: string
      resource: string
      auth_type: string
      auth_config?: Record<string, string>
    }

    if (!body.base_url?.trim()) return NextResponse.json({ error: "base_url is required" }, { status: 400 })
    if (!body.resource?.trim()) return NextResponse.json({ error: "resource is required" }, { status: 400 })

    const headers = buildFetchHeaders(body.auth_type ?? "none", body.auth_config)
    const rows = await fetchExternalRows({
      source_type: body.source_type ?? "rest",
      base_url: body.base_url.trim(),
      resource: body.resource.trim(),
      headers,
      limit: 3,
    })

    if (rows.length === 0) {
      return NextResponse.json({
        success: true,
        records_count: 0,
        sample_fields: [],
        sample_data: [],
        message: "Connected successfully but no records found.",
      })
    }

    const fields = detectFieldTypes(rows[0])
    return NextResponse.json({
      success: true,
      records_count: rows.length,
      sample_fields: fields,
      sample_data: rows.slice(0, 3),
      message: `Connected! Found ${rows.length} sample records with ${fields.length} fields.`,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: msg }, { status: 502 })
  }
}
