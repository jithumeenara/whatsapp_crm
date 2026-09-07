import { NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { listOwnedCatalogs } from "@/lib/whatsapp/catalog-api"

/**
 * POST /api/catalog/discover
 * Manual Connect's picker step: given a Business ID + a token with
 * catalog_management permission, list the catalogs that business owns so
 * the owner can pick one instead of hand-typing a catalog_id. Read-only —
 * does not save anything (PUT /api/catalog/config does that once a
 * catalog_id is chosen).
 */
export async function POST(request: Request) {
  try {
    await requireRole("owner")
    const body = await request.json()
    const { business_id, access_token } = body as { business_id?: string; access_token?: string }
    if (!business_id || !access_token) {
      return NextResponse.json({ error: "Business ID and Access Token are required." }, { status: 400 })
    }
    const catalogs = await listOwnedCatalogs({ businessId: business_id, accessToken: access_token })
    return NextResponse.json({ catalogs })
  } catch (err) {
    return toErrorResponse(err)
  }
}
