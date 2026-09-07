import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { decrypt } from "@/lib/whatsapp/encryption"
import { batchUpsertProducts } from "@/lib/whatsapp/catalog-api"

/** GET /api/catalog/products — list this account's local product cache. */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole("agent")
    const { searchParams } = new URL(request.url)
    const search = searchParams.get("search")?.trim()

    const products = await prisma.product.findMany({
      where: {
        account_id: ctx.accountId,
        ...(search
          ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { retailer_id: { contains: search, mode: "insensitive" } }] }
          : {}),
      },
      orderBy: { updated_at: "desc" },
      take: 200,
    })
    return NextResponse.json({ products })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/catalog/products — create a product: saves the local row
 * (source of truth, immediately usable for sending), then fires a
 * Catalog Batch CREATE at Meta. The batch write is async, so the row is
 * saved `sync_status: 'pending'` — "Sync products from Meta" (§ sync
 * route) reconciles it to `synced` on the next pull, same honesty
 * convention as this session's other AI-accuracy framing applied here to
 * write confirmation instead.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent")

    const config = await prisma.catalogConfig.findUnique({ where: { account_id: ctx.accountId } })
    if (!config) {
      return NextResponse.json({ error: "Connect a catalog in Settings > Catalog before adding products." }, { status: 400 })
    }

    const body = await request.json()
    const { name, description, price, currency, image_url, availability, category, brand, retailer_id } = body as {
      name?: string
      description?: string
      price?: number | string
      currency?: string
      image_url?: string
      availability?: string
      category?: string
      brand?: string
      retailer_id?: string
    }
    if (!name) return NextResponse.json({ error: "Product name is required." }, { status: 400 })

    const sku = retailer_id?.trim() || `prod-${randomUUID()}`

    const product = await prisma.product.create({
      data: {
        account_id: ctx.accountId,
        catalog_id: config.catalog_id,
        retailer_id: sku,
        name,
        description: description || null,
        price: price !== undefined && price !== "" ? price : null,
        currency: currency || "USD",
        image_url: image_url || null,
        availability: availability || "in stock",
        category: category || null,
        brand: brand || null,
        sync_status: "pending",
      },
    })

    try {
      const accessToken = decrypt(config.access_token)
      await batchUpsertProducts({
        catalogId: config.catalog_id,
        accessToken,
        items: [
          {
            method: "CREATE",
            retailer_id: sku,
            data: {
              name,
              description: description || undefined,
              availability: availability || "in stock",
              price: price !== undefined && price !== "" ? String(price) : undefined,
              currency: currency || "USD",
              image_url: image_url || undefined,
              category: category || undefined,
              brand: brand || undefined,
            },
          },
        ],
      })
    } catch (err) {
      // Local row still saved — flag the push failure without losing the
      // product; the owner can retry via "Sync products from Meta" or
      // editing again once the underlying issue (e.g. permissions) is fixed.
      await prisma.product.update({
        where: { id: product.id },
        data: { sync_status: "error", raw_meta_response: { error: err instanceof Error ? err.message : String(err) } },
      })
      return NextResponse.json({
        success: true,
        product,
        warning: `Saved locally, but Meta rejected the push: ${err instanceof Error ? err.message : "unknown error"}`,
      })
    }

    return NextResponse.json({ success: true, product })
  } catch (err) {
    return toErrorResponse(err)
  }
}
