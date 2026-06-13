import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'

/**
 * GET /api/data-tables/[id]/field-values?field_key=xxx
 *
 * Returns sorted unique non-empty values for a specific field across all records
 * in a table. Purpose-built for populating dropdown option lists.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: tableId } = await params
    const url = new URL(req.url)
    const fieldKey = url.searchParams.get('field_key')?.trim() ?? ''

    if (!fieldKey) {
      return NextResponse.json({ error: 'field_key query parameter is required.' }, { status: 400 })
    }

    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const profile = await prisma.profile.findUnique({
      where: { user_id: session.user.id },
      select: { account_id: true },
    })
    if (!profile?.account_id) return NextResponse.json({ error: 'No account.' }, { status: 403 })

    // Verify table belongs to this account
    const table = await prisma.dataTable.findFirst({
      where: { id: tableId, account_id: profile.account_id },
      select: { id: true },
    })
    if (!table) return NextResponse.json({ error: 'Table not found.' }, { status: 404 })

    // Fetch all records (up to 2000) — server-side extraction
    const records = await prisma.dataRecord.findMany({
      where: { table_id: tableId, account_id: profile.account_id },
      select: { data: true },
      orderBy: { created_at: 'asc' },
      take: 2000,
    })

    const seen = new Set<string>()
    const values: string[] = []

    for (const r of records) {
      let dataObj: Record<string, unknown>
      if (typeof r.data === 'string') {
        try { dataObj = JSON.parse(r.data) as Record<string, unknown> } catch { continue }
      } else if (r.data && typeof r.data === 'object' && !Array.isArray(r.data)) {
        dataObj = r.data as Record<string, unknown>
      } else {
        continue
      }

      const raw = dataObj[fieldKey]
      if (raw == null) continue

      // Handle array values (multiselect)
      const rawVals = Array.isArray(raw) ? raw : [raw]
      for (const rv of rawVals) {
        const val = String(rv).trim()
        if (val && !seen.has(val)) {
          seen.add(val)
          values.push(val)
        }
      }
    }

    return NextResponse.json({ values, total: values.length })
  } catch (err) {
    console.error('[GET /api/data-tables/[id]/field-values]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
