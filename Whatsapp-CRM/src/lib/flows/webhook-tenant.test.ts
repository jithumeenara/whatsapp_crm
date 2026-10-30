import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import crypto from 'node:crypto'

const db = vi.hoisted(() => ({
  flow: { findUnique: vi.fn(), findFirst: vi.fn() },
  dataField: { findMany: vi.fn() },
  dataRecord: { findMany: vi.fn() },
}))
vi.mock('@/lib/db', () => ({ prisma: db }))
vi.mock('@/lib/whatsapp/resolve-config', () => ({ resolveWhatsAppConfig: vi.fn(async () => null) }))
vi.mock('@/lib/data-store/record-events', () => ({ afterRecordCreated: vi.fn() }))

import { handleFlowWebhookPost } from './webhook-handler'

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })

function encryptedRequest(payload: unknown) {
  const aesKey = crypto.randomBytes(16)
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-128-gcm', aesKey, iv)
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final(), cipher.getAuthTag()])
  const body = {
    encrypted_aes_key: crypto
      .publicEncrypt({ key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, aesKey)
      .toString('base64'),
    encrypted_flow_data: data.toString('base64'),
    initial_vector: iv.toString('base64'),
  }
  return { request: new Request('https://x.test/api/flows/flow-1/webhook', { method: 'POST', body: JSON.stringify(body) }), aesKey, iv }
}

function decryptResponse(text: string, aesKey: Buffer, iv: Buffer) {
  const buf = Buffer.from(text, 'base64')
  const flipped = Buffer.from(iv.map((b) => ~b & 0xff))
  const d = crypto.createDecipheriv('aes-128-gcm', aesKey, flipped)
  d.setAuthTag(buf.subarray(-16))
  return JSON.parse(Buffer.concat([d.update(buf.subarray(0, -16)), d.final()]).toString('utf8'))
}

beforeAll(() => {
  process.env.FLOWS_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
})

beforeEach(() => {
  vi.clearAllMocks()
  db.flow.findUnique.mockResolvedValue({ account_id: 'acc-A' })
  db.dataField.findMany.mockResolvedValue([])
})

// Security audit A9-05: a Flow's dropdowns read DataStore rows by table id
// alone. The table id comes from the Flow's own saved configuration, which
// its owner edits freely, so a Flow naming another account's table served
// that account's rows.
describe('Flow data exchange — tenant scope', () => {
  it("reads a dropdown's rows only from the Flow's own account", async () => {
    db.flow.findFirst.mockResolvedValue({
      account_id: 'acc-A',
      trigger_config: {
        screens: [{ id: 'START', components: [{ type: 'Dropdown', name: 'pick', _source_table_id: 'table-of-acc-B', _source_field_key: 'name' }] }],
      },
    })
    db.dataRecord.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
      where.account_id === 'acc-A' ? [] : [{ data: { name: 'B customer secret' } }],
    )
    const { request, aesKey, iv } = encryptedRequest({ action: 'INIT', flow_token: 't' })
    const res = await handleFlowWebhookPost(request, 'flow-1')
    expect(res.status).toBe(200)
    const out = decryptResponse(await res.text(), aesKey, iv)
    expect(JSON.stringify(out)).not.toContain('B customer secret')
    for (const call of db.dataRecord.findMany.mock.calls) {
      expect(call[0].where).toMatchObject({ account_id: 'acc-A' })
    }
  })
})

describe('Flow data exchange — decryption failures', () => {
  it('answers 421 without saying how decryption failed', async () => {
    const req = new Request('https://x.test/api/flows/flow-1/webhook', {
      method: 'POST',
      body: JSON.stringify({ encrypted_aes_key: Buffer.alloc(300).toString('base64'), encrypted_flow_data: 'AAAA', initial_vector: 'AAAA' }),
    })
    const res = await handleFlowWebhookPost(req, 'flow-1')
    expect(res.status).toBe(421)
    const text = await res.text()
    expect(text).not.toMatch(/bits|bytes|sha1|sha256|modulus|OAEP|private key/i)
  })
})
