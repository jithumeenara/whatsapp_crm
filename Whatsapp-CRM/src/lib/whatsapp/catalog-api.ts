/**
 * Meta Product Catalog API helpers — separate from meta-api.ts (which is
 * WhatsApp Cloud API messaging only) because this talks to a different
 * Graph API surface (Commerce/Catalog, business-scoped rather than
 * phone-number-scoped) with its own field shapes. Same conventions as
 * meta-api.ts: named-args, raw fetch, throw on !response.ok.
 */

const GRAPH_API_VERSION = 'v21.0'
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`

interface MetaErrorResponse {
  error?: {
    message?: string
    code?: number
    error_subcode?: number
    error_user_msg?: string
  }
}

async function throwCatalogError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data = (await response.json()) as MetaErrorResponse
    const e = data.error
    if (e) {
      const detail = e.error_user_msg || e.message || fallback
      const code = e.code ? ` (code ${e.code}${e.error_subcode ? `.${e.error_subcode}` : ''})` : ''
      message = `${detail}${code}`
    }
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  throw new Error(message)
}

export interface OwnedCatalog {
  id: string
  name: string
}

/**
 * List the product catalogs owned by a Meta Business — used by Quick
 * Connect (auto-picks the only catalog when there's just one) and by
 * Manual Connect's catalog picker (when there are several).
 */
export async function listOwnedCatalogs(args: {
  businessId: string
  accessToken: string
}): Promise<OwnedCatalog[]> {
  const { businessId, accessToken } = args
  const url = `${GRAPH_API_BASE}/${businessId}/owned_product_catalogs?fields=id,name`
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' })
  if (!response.ok) await throwCatalogError(response, `Failed to list catalogs: ${response.status}`)
  const data = await response.json()
  return (data.data ?? []) as OwnedCatalog[]
}

export interface MetaCatalogProduct {
  id: string
  retailer_id?: string
  name?: string
  description?: string
  price?: string // Meta returns "499.00 INR" style strings
  currency?: string
  image_url?: string
  availability?: string
  category?: string
  brand?: string
}

/**
 * Pull a page of products already in a Meta catalog — used by "Sync
 * products from Meta" to reconcile the local Product cache, including
 * products added directly in Commerce Manager rather than through this
 * app.
 */
export async function fetchCatalogProducts(args: {
  catalogId: string
  accessToken: string
  after?: string
}): Promise<{ products: MetaCatalogProduct[]; nextAfter: string | null }> {
  const { catalogId, accessToken, after } = args
  const params = new URLSearchParams({
    fields: 'id,retailer_id,name,description,price,currency,availability,image_url,category,brand',
    limit: '100',
  })
  if (after) params.set('after', after)
  const url = `${GRAPH_API_BASE}/${catalogId}/products?${params.toString()}`
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' })
  if (!response.ok) await throwCatalogError(response, `Failed to fetch catalog products: ${response.status}`)
  const data = await response.json()
  return {
    products: (data.data ?? []) as MetaCatalogProduct[],
    nextAfter: data.paging?.cursors?.after ?? null,
  }
}

export interface CatalogBatchItem {
  method: 'CREATE' | 'UPDATE' | 'DELETE'
  retailer_id: string
  data?: {
    name?: string
    description?: string
    availability?: string
    price?: string // e.g. "499.00" — currency is a separate field
    currency?: string
    image_url?: string
    category?: string
    brand?: string
    url?: string
  }
}

export interface CatalogBatchResult {
  handles: string[]
}

/**
 * Create/update/delete products via the Catalog Batch API
 * (`POST /{catalog_id}/batch`). This is ASYNCHRONOUS — Meta returns a
 * request handle, not immediate confirmation the write applied. Callers
 * mark the local row `pending` and rely on a later "Sync products from
 * Meta" pull to reconcile it to `synced` — there is no cheap synchronous
 * status check worth building for a CRM at this scale.
 */
export async function batchUpsertProducts(args: {
  catalogId: string
  accessToken: string
  items: CatalogBatchItem[]
}): Promise<CatalogBatchResult> {
  const { catalogId, accessToken, items } = args
  if (items.length === 0) throw new Error('batchUpsertProducts requires at least one item.')
  if (items.length > 5000) throw new Error('batchUpsertProducts supports at most 5000 items per call.')

  const url = `${GRAPH_API_BASE}/${catalogId}/batch`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ requests: items }),
  })
  if (!response.ok) await throwCatalogError(response, `Catalog batch request failed: ${response.status}`)
  const data = await response.json()
  const handles: string[] = Array.isArray(data.handles) ? data.handles : data.handle_id ? [data.handle_id] : []
  return { handles }
}
