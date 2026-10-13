/**
 * The virus scanner's callback carries a signature of the file id, made
 * with the server's own secret. Without it the callback was open to any
 * signed-in user of any workspace — who could mark another account's file
 * "clean" — and closed to the scanner itself, which has no session.
 */

import crypto from 'crypto'

function key(): string | null {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || null
}

export function scanSignature(fileId: string): string | null {
  const k = key()
  return k ? crypto.createHmac('sha256', k).update(`scan-result:${fileId}`).digest('base64url') : null
}

export function scanCallbackUrl(fileId: string): string {
  const sig = scanSignature(fileId) ?? ''
  return `${process.env.NEXT_PUBLIC_APP_URL}/api/file-manager/${fileId}/scan-result?sig=${sig}`
}

export function validScanSignature(fileId: string, sig: string | null): boolean {
  const expected = scanSignature(fileId)
  if (!expected || !sig) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(sig)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
