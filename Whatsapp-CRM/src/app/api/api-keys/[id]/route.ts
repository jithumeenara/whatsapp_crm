import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params

    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
    const profile = await prisma.profile.findUnique({
      where: { user_id: session.user.id },
      select: { account_id: true },
    })
    if (!profile?.account_id) return NextResponse.json({ error: 'No account.' }, { status: 403 })

    const deleted = await prisma.apiKey.deleteMany({
      where: { id, account_id: profile.account_id },
    })
    if (deleted.count === 0) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/api-keys/[id]]', err)
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}
