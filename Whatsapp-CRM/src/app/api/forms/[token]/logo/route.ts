import { prisma } from '@/lib/db'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { clientIpKey } from '@/lib/net/client-ip'
import { contentMatchesType, readAccountFile } from '@/lib/files/account-files'
import { FORM_TOKEN } from '@/lib/data-store/public-form-server'
import { parseBrand } from '@/lib/data-store/form-logic'
import { ensureDataStoreColumns } from '@/lib/data-store/schema'

/**
 * The logo on a public form — the one image the form's settings name,
 * and nothing else.
 *
 * Account files are served only to signed-in members; a stranger opening
 * the form is neither. So the form serves its own logo here: the file
 * must belong to the form's account, be a real PNG, JPEG, WebP or GIF
 * (checked from its bytes — never SVG, which can carry script), be under
 * 2 MB and not flagged by the scanner. GET only.
 */

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const MAX_BYTES = 2 * 1024 * 1024
const LIMIT = { limit: 120, windowMs: 60_000 }

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!FORM_TOKEN.test(token)) return new Response(null, { status: 404 })
  const limited = checkRateLimit(`form-logo:${clientIpKey(req.headers)}`, LIMIT)
  if (!limited.success) return rateLimitResponse(limited)

  await ensureDataStoreColumns().catch(() => {})
  const table = await prisma.dataTable.findUnique({
    where: { form_token: token },
    select: { account_id: true, form_config: true },
  })
  const config = table?.form_config && typeof table.form_config === 'object' ? (table.form_config as Record<string, unknown>) : null
  if (!table || config?.enabled !== true) return new Response(null, { status: 404 })
  const brand = parseBrand(config.brand)
  if (!brand.logo_file_id) return new Response(null, { status: 404 })

  const file = await readAccountFile(table.account_id, brand.logo_file_id, MAX_BYTES).catch(() => null)
  if (!file || !IMAGE_TYPES.has(file.mime) || !contentMatchesType(file.mime, file.bytes)) {
    return new Response(null, { status: 404 })
  }

  return new Response(new Uint8Array(file.bytes), {
    headers: {
      'Content-Type': file.mime,
      'Content-Length': String(file.bytes.length),
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  })
}
