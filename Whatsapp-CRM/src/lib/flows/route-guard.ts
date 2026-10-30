import type { NextResponse } from 'next/server'
import { requirePageAccess, requireRole, toErrorResponse } from '@/lib/auth/account'
import type { AccountRole } from '@/lib/auth/roles'

/**
 * Who may change a flow or a chatbot.
 *
 * These routes used to ask only "is somebody signed in", so a viewer —
 * the read-only rank — could rewrite an automation that messages every
 * customer, publish it to Meta, switch it on, or add an HTTP step. The
 * floor is agent, the rank that may write operational data at all, and
 * the person must also have been given the page: page access decides
 * who sees the editor, and a screen nobody granted is not one they may
 * write through by calling the API.
 *
 * Returns the error response to send, or null to carry on — so each
 * route adds one line and keeps the rest of its handler as it was.
 */
export async function denyUnlessFlowEditor(page: '/flows' | '/chatbot'): Promise<NextResponse | null> {
  try {
    await requirePageAccess(page, 'agent')
    return null
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * A rank floor with no page: for account-level Flows settings (the
 * encryption key pair: admin, like the rest of the WhatsApp connection),
 * and for importing Flows from Meta, which the chatbot editor and the
 * templates screen both do as well as the Flows page.
 */
export async function denyUnlessRole(min: AccountRole): Promise<NextResponse | null> {
  try {
    await requireRole(min)
    return null
  } catch (err) {
    return toErrorResponse(err)
  }
}
