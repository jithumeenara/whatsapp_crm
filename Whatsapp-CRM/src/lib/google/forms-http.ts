import { NextResponse } from 'next/server'
import { toErrorResponse } from '@/lib/auth/account'
import { FormsError } from './forms'
import { GoogleNotConnectedError } from './oauth'

/** A Forms failure as the response the hub shows. Kept out of forms.ts,
 *  which server.ts loads before Next is ready. */
export function formsFailure(err: unknown) {
  if (err instanceof FormsError) return NextResponse.json({ error: err.message }, { status: err.status })
  if (err instanceof GoogleNotConnectedError) return NextResponse.json({ error: err.message }, { status: 400 })
  return toErrorResponse(err)
}
