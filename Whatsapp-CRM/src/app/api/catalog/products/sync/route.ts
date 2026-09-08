import { NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { decrypt } from "@/lib/whatsapp/encryption"
import { fetchCatalogProducts, type MetaCatalogProduct } from "@/lib/whatsapp/catalog-api"

/**
 * POST /api/catalog/products/sync — pull the full product list from Meta
 * and reconcile the local cache: upserts everything Meta has (by
 * retailer_id, mode: 'synced'), and picks up products added directly in
 * Commerce Manager that never went through this app. This is also the
 * reconciliation step for pending in-app writes — the Batch API is
 * asynchronous, so this pull is what actually flips a product from
 * `pending` to `synced` (or `error` if Meta never applied it).
 */
export async function POST() {
  try {
    const ctx = await requireRole("agent")

    const config = await prisma.catalogConfig.findUnique({ where: { account_id: ctx.accountId } })
    if (!config) return NextResponse.json({ error: "No catalog connected." }, { status: 400 })

    const accessToken = decrypt(config.access_token)

    // Upserting one product at a time, awaited sequentially, meant a large
    // catalog (thousands of SKUs) paid one full DB round-trip per product
    // in series — real risk of hitting a serverless function's execution
    // timeout well before Meta's pagination even finished. Products within
    // a page are independent writes (keyed by the retailer_id unique
    // constraint), so they're safe to run concurrently; capped at
    // CONCURRENCY per page instead of unbounded Promise.all so a huge page
    // doesn't blow through the DB connection pool.
    const CONCURRENCY = 10
    const seenRetailerIds = new Set<string>()
    let after: string | undefined
    let pulled = 0
    do {
      const page = await fetchCatalogProducts({ catalogId: config.catalog_id, accessToken, after })
      const products = (page.products as MetaCatalogProduct[]).filter(
        (p): p is MetaCatalogProduct & { retailer_id: string } => !!p.retailer_id,
      )
      for (let i = 0; i < products.length; i += CONCURRENCY) {
        const batch = products.slice(i, i + CONCURRENCY)
        await Promise.all(
          batch.map((p) => {
            seenRetailerIds.add(p.retailer_id)
            const [priceAmount, priceCurrency] = parsePrice(p.price)
            return prisma.product.upsert({
              where: { account_id_retailer_id: { account_id: ctx.accountId, retailer_id: p.retailer_id } },
              create: {
                account_id: ctx.accountId,
                catalog_id: config.catalog_id,
                retailer_id: p.retailer_id,
                name: p.name || p.retailer_id,
                description: p.description || null,
                price: priceAmount,
                currency: priceCurrency || p.currency || null,
                image_url: p.image_url || null,
                availability: p.availability || "in stock",
                category: p.category || null,
                brand: p.brand || null,
                sync_status: "synced",
                raw_meta_response: p as unknown as object,
              },
              update: {
                name: p.name || p.retailer_id,
                description: p.description || null,
                price: priceAmount,
                currency: priceCurrency || p.currency || null,
                image_url: p.image_url || null,
                availability: p.availability || "in stock",
                category: p.category || null,
                brand: p.brand || null,
                sync_status: "synced",
                raw_meta_response: p as unknown as object,
              },
            })
          }),
        )
        pulled += batch.length
      }
      after = page.nextAfter ?? undefined
    } while (after)

    await prisma.catalogConfig.update({ where: { account_id: ctx.accountId }, data: { last_synced_at: new Date() } })

    return NextResponse.json({ success: true, pulled })
  } catch (err) {
    return toErrorResponse(err)
  }
}

function parsePrice(raw: string | undefined): [number | null, string | null] {
  if (!raw) return [null, null]
  // Meta returns e.g. "499.00 INR"
  const match = raw.match(/^([\d.]+)\s*([A-Z]{3})?$/)
  if (!match) return [null, null]
  return [parseFloat(match[1]), match[2] || null]
}
