import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'
import crypto from 'crypto'

/**
 * POST /api/flows/[id]/webhook
 *
 * Meta WhatsApp Flows data exchange endpoint.
 * Meta encrypts every request with your RSA public key.
 * We decrypt it, fetch fresh DB data, and return an AES-GCM encrypted response.
 *
 * Required env var:
 *   FLOWS_PRIVATE_KEY — your RSA-2048 private key (PEM format, use \n for line breaks)
 *
 * Configure in Meta Business Manager:
 *   Flow → Settings → Endpoint URI → https://your-domain.com/api/flows/[id]/webhook
 */

// ── In-memory debug log (last 10 decrypted payloads per flow) ────────
// Accessible via GET /api/flows/[id]/webhook?debug=1
interface DebugEntry {
  ts: string
  action: string
  screen: string
  rawPayloadData: unknown
  dataKeys: string[]
  formData: Record<string, unknown>
  saved: boolean
  error?: string
}
const debugLog = new Map<string, DebugEntry[]>()
function logDebug(flowId: string, entry: DebugEntry) {
  const arr = debugLog.get(flowId) ?? []
  arr.unshift(entry)
  if (arr.length > 10) arr.pop()
  debugLog.set(flowId, arr)
}

// ── Helpers ────────────────────────────────────────────────────────

function makeVarName(fieldKey: string): string {
  return fieldKey.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') + '_options'
}

async function fetchOptions(tableId: string, fieldKey: string): Promise<Array<{ id: string; title: string }>> {
  const records = await prisma.dataRecord.findMany({
    where: { table_id: tableId },
    select: { data: true },
    orderBy: { created_at: 'asc' },
    take: 2000,
  })

  const seen = new Set<string>()
  const options: Array<{ id: string; title: string }> = []

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

    const rawVals = Array.isArray(raw) ? raw : [raw]
    for (const rv of rawVals) {
      const val = String(rv).trim()
      if (val && !seen.has(val)) {
        seen.add(val)
        options.push({
          id: val.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `opt_${seen.size}`,
          title: val,
        })
      }
    }
  }

  return options
}

// ── Meta Flows AES-128-GCM encryption protocol ────────────────────

interface DecryptedRequest {
  payload: Record<string, unknown>
  aesKey: Buffer
  initialVector: Buffer
}

function decryptMetaRequest(rawBody: Record<string, unknown>): DecryptedRequest {
  const privateKeyPem = process.env.FLOWS_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!privateKeyPem) {
    throw new Error(
      'FLOWS_PRIVATE_KEY env variable is not set. Add your RSA private key to .env.local.',
    )
  }

  const { encrypted_aes_key, encrypted_flow_data, initial_vector } = rawBody as {
    encrypted_aes_key: string
    encrypted_flow_data: string
    initial_vector: string
  }

  if (!encrypted_aes_key || !encrypted_flow_data || !initial_vector) {
    throw new Error('Request is missing encryption fields (encrypted_aes_key / encrypted_flow_data / initial_vector).')
  }

  // Step 1 — decrypt the AES-128 key using our RSA-2048 private key (OAEP SHA-256)
  const aesKey = crypto.privateDecrypt(
    {
      key: privateKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    Buffer.from(encrypted_aes_key, 'base64'),
  )

  // Step 2 — decrypt the payload with AES-128-GCM
  const TAG_LENGTH = 16
  const encryptedData = Buffer.from(encrypted_flow_data, 'base64')
  const iv = Buffer.from(initial_vector, 'base64')
  const encryptedBody = encryptedData.subarray(0, -TAG_LENGTH)
  const authTag = encryptedData.subarray(-TAG_LENGTH)

  const decipher = crypto.createDecipheriv('aes-128-gcm', aesKey, iv)
  decipher.setAuthTag(authTag)
  const decrypted = Buffer.concat([decipher.update(encryptedBody), decipher.final()])

  return {
    payload: JSON.parse(decrypted.toString('utf-8')) as Record<string, unknown>,
    aesKey,
    initialVector: iv,
  }
}

function encryptMetaResponse(data: unknown, aesKey: Buffer, initialVector: Buffer): string {
  // Meta requires the response IV to be the bitwise complement of the request IV
  const flippedIv = Buffer.from(initialVector.map((b) => ~b & 0xff))

  const cipher = crypto.createCipheriv('aes-128-gcm', aesKey, flippedIv)
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(data), 'utf-8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  // Return ciphertext + auth tag as a single Base64 string
  return Buffer.concat([encrypted, authTag]).toString('base64')
}

// ── Route handlers ─────────────────────────────────────────────────

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const url = new URL(request.url)
  if (url.searchParams.get('debug') === '1') {
    const { id } = await params
    return NextResponse.json({ log: debugLog.get(id) ?? [] })
  }
  return NextResponse.json({ status: 'active' })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
  const { id: flowId } = await params

  let rawBody: Record<string, unknown>
  try {
    const text = await request.text()
    rawBody = JSON.parse(text) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  // ── Decrypt Meta's request ───────────────────────────────────────
  let payload: Record<string, unknown>
  let aesKey: Buffer
  let initialVector: Buffer

  try {
    const decrypted = decryptMetaRequest(rawBody)
    payload = decrypted.payload
    aesKey = decrypted.aesKey
    initialVector = decrypted.initialVector
  } catch (err) {
    console.error('[webhook] decryption failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Decryption failed' },
      { status: 421 },
    )
  }

  const action = payload.action as string | undefined

  console.log('[webhook] action:', action, '| screen:', payload.screen, '| flowId:', flowId)

  // ── Handle ping (health check) ───────────────────────────────────
  if (action === 'ping') {
    const encrypted = encryptMetaResponse({ data: { status: 'active' } }, aesKey, initialVector)
    return new Response(encrypted, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  // ── Load flow from DB ────────────────────────────────────────────
  const flow = await prisma.flow.findFirst({
    where: { id: flowId },
    select: { trigger_config: true },
  })
  if (!flow) {
    return NextResponse.json({ error: 'Flow not found' }, { status: 404 })
  }

  const cfg = flow.trigger_config as Record<string, unknown>
  const screens = (cfg?.screens ?? []) as Array<{
    id: string
    components: Array<Record<string, unknown>>
  }>

  const sanitizeId = (raw: string) =>
    raw.toUpperCase().replace(/[^A-Z_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'SCREEN'

  const sendEncrypted = (data: unknown) => {
    const enc = encryptMetaResponse(data, aesKey, initialVector)
    return new Response(enc, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }

  // Flatten Form component wrapper to get actual leaf components
  function flatComps(comps: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = []
    for (const c of comps) {
      if (c.type === 'Form' && Array.isArray(c.children)) {
        out.push(...(c.children as Array<Record<string, unknown>>))
      } else {
        out.push(c)
      }
    }
    return out
  }

  // ── data_exchange ─────────────────────────────────────────────────
  // Two cases depending on which screen triggered data_exchange:
  //
  // A) "Load" screen (no _save_field_key on any component):
  //    → fetch fresh DB data now and return the form screen with live options.
  //    Used for Option 2 "Refresh" pattern — add a first screen with only a
  //    Footer (data_exchange) and no form fields.
  //
  // B) "Submit" screen (has components with _save_field_key):
  //    → save form values to DataStore and return SUCCESS.
  if (action === 'data_exchange') {
    const currentScreenId = payload.screen as string | undefined
    const flowToken = payload.flow_token as string | undefined

    // payload.data is normally flat: { componentName: value, ... }
    // Guard against rare nested format: { formName: { componentName: value } }
    let rawData = (payload.data ?? {}) as Record<string, unknown>
    if (Object.keys(rawData).length === 1) {
      const onlyVal = rawData[Object.keys(rawData)[0]]
      if (onlyVal && typeof onlyVal === 'object' && !Array.isArray(onlyVal)) {
        rawData = onlyVal as Record<string, unknown>
      }
    }
    const formData = rawData

    console.log('[data_exchange] screen:', currentScreenId, '| formData:', JSON.stringify(formData))

    // Find the CRM screen that triggered this action
    const submittedScreen = screens.find((s) => sanitizeId(s.id) === currentScreenId) ?? screens[0]
    const submittedComps = flatComps(submittedScreen?.components ?? [])
    const hasSaveFields = submittedComps.some((c) => c._save_field_key)

    // ── Case A: Load screen — fetch fresh data and return next screen ─
    if (!hasSaveFields) {
      // Find the form screen: first screen (other than current) that has
      // dynamic sources or save-field mappings
      const formScreen = screens.find((s) => {
        if (s.id === submittedScreen?.id) return false
        const comps = flatComps(s.components ?? [])
        return comps.some((c) => c._source_table_id || c._save_field_key)
      }) ?? screens.find((s) => s.id !== submittedScreen?.id)

      if (!formScreen) {
        return sendEncrypted({
          version: '3.0', screen: 'SUCCESS',
          data: { extension_message_response: { params: { flow_token: flowToken ?? 'unused' } } },
        })
      }

      // Fetch live options for every dynamic source on the form screen
      const freshData: Record<string, unknown> = {}
      await Promise.all(
        flatComps(formScreen.components ?? [])
          .filter((c) => c._source_table_id && c._source_field_key)
          .map(async (c) => {
            const varName = makeVarName(c._source_field_key as string)
            const opts = await fetchOptions(c._source_table_id as string, c._source_field_key as string)
            freshData[varName] = opts
            console.log('[data_exchange:load]', varName, '→', opts.length, 'options')
          }),
      )

      console.log('[data_exchange:load] → screen:', sanitizeId(formScreen.id))
      logDebug(flowId, {
        ts: new Date().toISOString(),
        action: 'data_exchange:load',
        screen: currentScreenId ?? '',
        rawPayloadData: payload.data,
        dataKeys: Object.keys(formData),
        formData,
        saved: false,
      })
      return sendEncrypted({ version: '3.0', screen: sanitizeId(formScreen.id), data: freshData })
    }

    // ── Case B: Submit screen — save form data to DataStore ───────────
    const saveTableId = cfg._save_table_id as string | undefined
    console.log('[data_exchange:save] saveTableId:', saveTableId)

    let savedOk = false
    let saveError: string | undefined

    if (saveTableId) {
      const record: Record<string, unknown> = {}
      for (const comp of submittedComps) {
        const compName = comp.name as string | undefined
        const saveFieldKey = comp._save_field_key as string | undefined
        if (compName && saveFieldKey && compName in formData) {
          record[saveFieldKey] = formData[compName]
        }
      }

      console.log('[data_exchange:save] record:', JSON.stringify(record))

      if (Object.keys(record).length > 0) {
        const table = await prisma.dataTable.findUnique({
          where: { id: saveTableId },
          select: { account_id: true },
        })
        if (table) {
          await prisma.dataRecord.create({
            data: {
              table_id: saveTableId,
              account_id: table.account_id,
              data: record as Prisma.InputJsonValue,
            },
          })
          console.log('[data_exchange:save] ✓ saved to table', saveTableId)
          savedOk = true
        } else {
          saveError = `DataTable not found: ${saveTableId}`
          console.error('[data_exchange:save] ✗', saveError)
        }
      } else {
        saveError = `record empty — formData keys: [${Object.keys(formData).join(', ')}], comps: [${submittedComps.map((c) => `${String(c.name)}→${String(c._save_field_key)}`).join(', ')}]`
        console.warn('[data_exchange:save]', saveError)
      }
    } else {
      saveError = 'no _save_table_id in trigger_config'
      console.warn('[data_exchange:save]', saveError)
    }

    logDebug(flowId, {
      ts: new Date().toISOString(),
      action: 'data_exchange:save',
      screen: currentScreenId ?? '',
      rawPayloadData: payload.data,
      dataKeys: Object.keys(formData),
      formData,
      saved: savedOk,
      ...(saveError ? { error: saveError } : {}),
    })

    return sendEncrypted({
      version: '3.0',
      screen: 'SUCCESS',
      data: {
        extension_message_response: {
          params: { flow_token: flowToken ?? 'unused' },
        },
      },
    })
  }

  // ── INIT: return first screen with dynamic dropdown options ───────
  type SourceEntry = { tableId: string; fieldKey: string; varName: string }
  const sources = new Map<string, SourceEntry>()

  function collectSources(comps: Array<Record<string, unknown>>) {
    for (const comp of comps) {
      const tableId = comp._source_table_id as string | undefined
      const fieldKey = comp._source_field_key as string | undefined
      if (tableId && fieldKey) {
        const key = `${tableId}::${fieldKey}`
        if (!sources.has(key)) {
          sources.set(key, { tableId, fieldKey, varName: makeVarName(fieldKey) })
        }
      }
      if (comp.type === 'Form' && Array.isArray(comp.children)) {
        collectSources(comp.children as Array<Record<string, unknown>>)
      }
    }
  }
  for (const flowScreen of screens) {
    collectSources(flowScreen.components ?? [])
  }

  const responseData: Record<string, unknown> = {}
  await Promise.all(
    Array.from(sources.values()).map(async ({ tableId, fieldKey, varName }) => {
      const opts = await fetchOptions(tableId, fieldKey)
      console.log(`[webhook] ${varName}: ${opts.length} options`)
      responseData[varName] = opts
    }),
  )

  const targetScreen = sanitizeId(screens[0]?.id ?? 'SCREEN')
  console.log('[webhook] INIT → screen:', targetScreen, '| data keys:', Object.keys(responseData))

  logDebug(flowId, {
    ts: new Date().toISOString(),
    action: 'init',
    screen: targetScreen,
    rawPayloadData: null,
    dataKeys: Object.keys(responseData),
    formData: {},
    saved: false,
  })

  return sendEncrypted({ version: '3.0', screen: targetScreen, data: responseData })
  } catch (err) {
    console.error('[POST /api/flows/[id]/webhook]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
