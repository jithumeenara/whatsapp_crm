import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { auth } from '@/auth'

/**
 * POST /api/flows/keys
 *
 * Generates a fresh RSA-2048 key pair for Meta WhatsApp Flows encryption.
 * Returns:
 *   privateKey  — PEM (PKCS#1) — set as FLOWS_PRIVATE_KEY in .env.local
 *   publicKey   — PEM (SPKI)   — upload to Meta via the upload endpoint
 *   envValue    — private key with literal \n for pasting into .env.local
 */
export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  })

  // Format private key for .env.local — replace real newlines with \n literal
  const envValue = `FLOWS_PRIVATE_KEY="${privateKey.replace(/\n/g, '\\n')}"`

  return NextResponse.json({ privateKey, publicKey, envValue })
}
