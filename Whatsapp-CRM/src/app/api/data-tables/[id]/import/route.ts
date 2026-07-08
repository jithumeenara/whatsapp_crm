import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import ExcelJS from 'exceljs'

async function requireTable(tableId: string) {
  const session = await auth()
  if (!session?.user?.id) return { ok: false as const, status: 401, body: { error: 'Unauthorized' } }
  const profile = await prisma.profile.findUnique({
    where: { user_id: session.user.id },
    select: { account_id: true },
  })
  if (!profile?.account_id) return { ok: false as const, status: 403, body: { error: 'No account.' } }
  const table = await prisma.dataTable.findFirst({
    where: { id: tableId, account_id: profile.account_id },
    include: { fields: { orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }] } },
  })
  if (!table) return { ok: false as const, status: 404, body: { error: 'Table not found.' } }
  return { ok: true as const, accountId: profile.account_id, table }
}

// GET /api/data-tables/[id]/import/template — download demo Excel template
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: tableId } = await params
    const guard = await requireTable(tableId)
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

    const { table } = guard
    const dataFields = table.fields.filter(
      (f) => !['section_header', 'html_block', 'hidden', 'signature', 'file', 'image'].includes(f.field_type),
    )

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Records')

    // Header row with field labels
    ws.columns = dataFields.map((f) => ({
      header: f.label,
      key: f.field_key,
      width: Math.max(f.label.length + 4, 18),
    }))

    // Style header row
    const headerRow = ws.getRow(1)
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } }
      cell.alignment = { vertical: 'middle', horizontal: 'left' }
    })
    headerRow.height = 24

    // Two demo rows
    const demoValues: Record<string, string> = {
      text: 'Sample text',
      textarea: 'Sample description',
      number: '42',
      email: 'user@example.com',
      phone: '+1 555 000 0000',
      url: 'https://example.com',
      date: '2025-01-01',
      time: '09:00',
      datetime: '2025-01-01T09:00',
      boolean: 'Yes',
      select: 'Option 1',
      multiselect: 'Option 1',
      radio: 'Option 1',
      country: 'India',
      state: 'Kerala',
      district: 'Ernakulam',
      address: '123 Main St, City',
    }

    for (let i = 0; i < 2; i++) {
      const row: Record<string, string> = {}
      for (const f of dataFields) {
        row[f.field_key] = demoValues[f.field_type] ?? ''
      }
      ws.addRow(row)
    }

    const buf = await wb.xlsx.writeBuffer()
    return new NextResponse(buf, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(table.name)}.xlsx"`,
      },
    })
  } catch (err) {
    console.error('[GET /api/data-tables/[id]/import/template]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/data-tables/[id]/import — import records from uploaded Excel/CSV
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: tableId } = await params
    const guard = await requireTable(tableId)
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

    const { table, accountId } = guard
    const dataFields = table.fields.filter(
      (f) => !['section_header', 'html_block', 'hidden', 'signature', 'file', 'image'].includes(f.field_type),
    )

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 })

    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    const arrayBuffer = await file.arrayBuffer()

    const wb = new ExcelJS.Workbook()

    if (ext === 'csv') {
      const { Readable } = await import('stream')
      const csvStream = new Readable()
      csvStream.push(Buffer.from(arrayBuffer))
      csvStream.push(null)
      await wb.csv.read(csvStream)
    } else {
      await wb.xlsx.load(arrayBuffer)
    }

    const ws = wb.worksheets[0]
    if (!ws) return NextResponse.json({ error: 'No worksheet found in file.' }, { status: 400 })

    // Build label → field_key map (case-insensitive)
    const labelMap = new Map<string, string>()
    for (const f of dataFields) {
      labelMap.set(f.label.toLowerCase().trim(), f.field_key)
      labelMap.set(f.field_key.toLowerCase().trim(), f.field_key)
    }

    // Read header row
    const headerRow = ws.getRow(1)
    const colToKey: Record<number, string> = {}
    headerRow.eachCell((cell, colNum) => {
      const label = String(cell.value ?? '').toLowerCase().trim()
      const key = labelMap.get(label)
      if (key) colToKey[colNum] = key
    })

    if (Object.keys(colToKey).length === 0) {
      return NextResponse.json(
        { error: 'No matching column headers found. Use the demo template to see the expected format.' },
        { status: 400 },
      )
    }

    const rowsData: Record<string, unknown>[] = []
    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) return // skip header
      const data: Record<string, unknown> = {}
      let hasValue = false
      row.eachCell((cell, colNum) => {
        const key = colToKey[colNum]
        if (!key) return
        const raw = cell.value
        if (raw === null || raw === undefined || raw === '') return
        // ExcelJS may return rich text objects
        const val = typeof raw === 'object' && raw !== null && 'richText' in raw
          ? (raw as { richText: Array<{ text: string }> }).richText.map((r) => r.text).join('')
          : String(raw)
        if (val.trim()) { data[key] = val.trim(); hasValue = true }
      })
      if (hasValue) rowsData.push(data)
    })

    if (rowsData.length === 0) {
      return NextResponse.json({ error: 'No data rows found in file.' }, { status: 400 })
    }

    // Bulk create
    await prisma.dataRecord.createMany({
      data: rowsData.map((data) => ({
        table_id: tableId,
        account_id: accountId,
        data: data as never,
      })),
    })

    return NextResponse.json({ count: rowsData.length }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/data-tables/[id]/import]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
