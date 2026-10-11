import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { DriveError, importDriveFile } from '@/lib/google/drive'
import { GoogleNotConnectedError, isGoogleServiceEnabled, loadGoogleConnection } from '@/lib/google/oauth'

/** Whether "Google Drive" is offered when attaching — for any team member. */
export async function GET() {
  try {
    const ctx = await requireRole('agent')
    const conn = await loadGoogleConnection(ctx.accountId).catch(() => null)
    const usable = Boolean(conn?.status === 'connected' && conn.api_key) && (await isGoogleServiceEnabled(ctx.accountId, 'drive'))
    return NextResponse.json({ usable })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * A file picked in Google Drive, copied into the account's files and
 * returned in the File Manager's shape, so the composer sends it like
 * any other file.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole('agent')
    const body = (await req.json().catch(() => ({}))) as { fileId?: unknown }
    if (typeof body.fileId !== 'string') return NextResponse.json({ error: 'fileId is required.' }, { status: 400 })
    const f = await importDriveFile(ctx.accountId, body.fileId)
    return NextResponse.json({
      file: {
        id: f.id,
        original_name: f.original_name,
        url: f.url,
        mime_type: f.mime_type,
        size: f.size,
        file_category: f.file_category,
        created_at: f.created_at,
      },
    })
  } catch (err) {
    if (err instanceof DriveError) return NextResponse.json({ error: err.message }, { status: err.status })
    if (err instanceof GoogleNotConnectedError) return NextResponse.json({ error: err.message }, { status: 400 })
    return toErrorResponse(err)
  }
}
