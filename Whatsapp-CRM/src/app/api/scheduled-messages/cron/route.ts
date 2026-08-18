import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { sweepScheduledMessages } from '@/lib/scheduled-messages/sweep'

// See chatbot/cron/route.ts for why this is needed -- reading
// `request.headers` directly doesn't count as a Next.js "dynamic" signal,
// so this route could otherwise get statically cached and freeze on its
// first response.
export const dynamic = 'force-dynamic'

/**
 * Manual-trigger / debug entry point for the scheduled-message sweep.
 *
 * NOT required for scheduled messages to actually send -- the primary
 * trigger is an internal setInterval in server.ts that runs the same
 * sweepScheduledMessages() every minute for as long as the Node process
 * is alive, so this feature works without any external cron setup. This
 * route exists for manual testing and for parity with the other cron
 * endpoints on deployments that prefer hitting everything via HTTP.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await sweepScheduledMessages()
    return NextResponse.json(result)
  } catch (err) {
    console.error('[scheduled-messages/cron]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
