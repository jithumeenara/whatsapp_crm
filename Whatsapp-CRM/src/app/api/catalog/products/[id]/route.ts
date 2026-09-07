import { NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { decrypt } from "@/lib/whatsapp/encryption"
import { batchUpsertProducts } from "@/lib/whatsapp/catalog-api"

/** PUT /api/catalog/products/[id] — edit a product: local write + fire an UPDATE batch at Meta. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole("agent")
    const { id } = await params

    const existing = await prisma.product.findFirst({ where: { id, account_id: ctx.accountId } })
    if (!existing) return NextResponse.json({ error: "Product not found." }, { status: 404 })

    const config = await prisma.catalogConfig.findUnique({ where: { account_id: ctx.accountId } })
    if (!config) return NextResponse.json({ error: "No catalog connected." }, { status: 400 })

    const body = await request.json()
    const { name, description, price, currency, image_url, availability, category, brand } = body as {
      name?: string
      description?: string
      price?: number | string
      currency?: string
      image_url?: string
      availability?: string
      category?: string
      brand?: string
    }

    const product = await prisma.product.update({
      where: { id },
      data: {
        name: name ?? existing.name,
        description: description !== undefined ? description || null : existing.description,
        price: price !== undefined ? (price === "" ? null : price) : existing.price,
        currency: currency ?? existing.currency,
        image_url: image_url !== undefined ? image_url || null : existing.image_url,
        availability: availability ?? existing.availability,
        category: category !== undefined ? category || null : existing.category,
        brand: brand !== undefined ? brand || null : existing.brand,
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
            method: "UPDATE",
            retailer_id: product.retailer_id,
            data: {
              name: product.name,
              description: product.description || undefined,
              availability: product.availability,
              price: product.price !== null ? String(product.price) : undefined,
              currency: product.currency || undefined,
              image_url: product.image_url || undefined,
              category: product.category || undefined,
              brand: product.brand || undefined,
            },
          },
        ],
      })
    } catch (err) {
      await prisma.product.update({
        where: { id },
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

/** DELETE /api/catalog/products/[id] — remove locally + fire a DELETE batch at Meta. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole("agent")
    const { id } = await params

    const existing = await prisma.product.findFirst({ where: { id, account_id: ctx.accountId } })
    if (!existing) return NextResponse.json({ success: true }) // already gone

    const config = await prisma.catalogConfig.findUnique({ where: { account_id: ctx.accountId } })

    await prisma.product.delete({ where: { id } })

    if (config) {
      try {
        const accessToken = decrypt(config.access_token)
        await batchUpsertProducts({
          catalogId: config.catalog_id,
          accessToken,
          items: [{ method: "DELETE", retailer_id: existing.retailer_id }],
        })
      } catch (err) {
        // Local delete already committed — surface the Meta-side failure
        // as a warning so the owner knows to remove it in Commerce
        // Manager too if the push didn't take.
        console.error("[catalog/products delete] Meta push failed (non-fatal):", err)
        return NextResponse.json({
          success: true,
          warning: `Removed locally, but Meta rejected the deletion: ${err instanceof Error ? err.message : "unknown error"}`,
        })
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
