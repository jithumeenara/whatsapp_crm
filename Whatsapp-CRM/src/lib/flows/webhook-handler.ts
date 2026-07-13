import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'
import crypto from 'crypto'

// ── In-memory debug log (last 10 decrypted payloads per flow) ────────
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
export const debugLog = new Map<string, DebugEntry[]>()
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

function makeLabelVarName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') + '_label'
}

function slugify(val: string): string {
  return val.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

async function fetchOptions(
  tableId: string,
  fieldKey: string,
  filterField?: string,
  filterValue?: string,
): Promise<Array<{ id: string; title: string }>> {
  let resolvedFilterField = filterField
  if (filterField) {
    try {
      const dbFields = await prisma.dataField.findMany({
        where: { table_id: tableId },
        select: { field_key: true, label: true },
      })
      const exact = dbFields.find((f) => f.field_key === filterField)
      if (!exact) {
        const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
        const byLabel = dbFields.find(
          (f) => norm(f.label) === norm(filterField) || norm(f.field_key) === norm(filterField)
        )
        if (byLabel) {
          console.log('[fetchOptions:filter] resolved', filterField, '→', byLabel.field_key)
          resolvedFilterField = byLabel.field_key
        } else {
          console.warn('[fetchOptions:filter] field not found for filterField:', filterField, '| available:', dbFields.map(f => f.field_key))
        }
      }
    } catch (e) {
      console.warn('[fetchOptions:filter] field lookup failed:', e)
    }
  }

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

    if (resolvedFilterField && filterValue) {
      const filterRaw = dataObj[resolvedFilterField]
      if (options.length === 0 && seen.size === 0) {
        console.log('[fetchOptions:filter] keys in record:', Object.keys(dataObj))
        console.log('[fetchOptions:filter] resolvedFilterField:', resolvedFilterField, '| raw value:', filterRaw, '| looking for:', filterValue)
      }
      if (filterRaw == null) continue
      const filterVals = (Array.isArray(filterRaw) ? filterRaw : [filterRaw])
        .map((v) => slugify(String(v).trim()))
      if (!filterVals.includes(filterValue)) continue
    }

    const raw = dataObj[fieldKey]
    if (raw == null) continue

    const rawVals = Array.isArray(raw) ? raw : [raw]
    for (const rv of rawVals) {
      const val = String(rv).trim()
      if (val && !seen.has(val)) {
        seen.add(val)
        options.push({ id: slugify(val) || `opt_${seen.size}`, title: val })
      }
    }
  }

  return options
}

/** Fetches a single text value from a DataStore table for TextLabel components. */
async function fetchLabelValue(
  tableId: string, fieldKey: string, filterField?: string, filterValue?: string,
): Promise<string> {
  let resolvedFilterField = filterField
  if (filterField) {
    try {
      const dbFields = await prisma.dataField.findMany({
        where: { table_id: tableId },
        select: { field_key: true, label: true },
      })
      const exact = dbFields.find((f) => f.field_key === filterField)
      if (!exact) {
        const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
        const byLabel = dbFields.find(
          (f) => norm(f.label) === norm(filterField) || norm(f.field_key) === norm(filterField)
        )
        if (byLabel) resolvedFilterField = byLabel.field_key
      }
    } catch { /* ignore */ }
  }

  const records = await prisma.dataRecord.findMany({
    where: { table_id: tableId },
    select: { data: true },
    orderBy: { created_at: 'asc' },
    take: 2000,
  })

  for (const r of records) {
    let dataObj: Record<string, unknown>
    if (typeof r.data === 'string') {
      try { dataObj = JSON.parse(r.data) as Record<string, unknown> } catch { continue }
    } else if (r.data && typeof r.data === 'object' && !Array.isArray(r.data)) {
      dataObj = r.data as Record<string, unknown>
    } else {
      continue
    }

    if (resolvedFilterField && filterValue) {
      const filterRaw = dataObj[resolvedFilterField]
      if (filterRaw == null) continue
      const filterVals = (Array.isArray(filterRaw) ? filterRaw : [filterRaw])
        .map((v) => slugify(String(v).trim()))
      if (!filterVals.includes(filterValue)) continue
    }

    const raw = dataObj[fieldKey]
    if (raw != null) {
      const val = Array.isArray(raw) ? raw[0] : raw
      // A boolean-type DataStore field mistakenly wired to a TextLabel would
      // otherwise render the literal word "true"/"false" — format it as
      // Yes/No instead so a misconfigured field reads sensibly rather than
      // looking like a JS internal leaking into the UI.
      if (typeof val === 'boolean') return val ? 'Yes' : 'No'
      return String(val).trim()
    }
  }
  return ''
}

// ── Meta Flows AES-128-GCM encryption protocol ────────────────────

interface DecryptedRequest {
  payload: Record<string, unknown>
  aesKey: Buffer
  initialVector: Buffer
}

function normalizePem(raw: string): string {
  let pem = raw
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()

  const m = pem.match(/^(-----BEGIN [^-]+-----)\s*([\s\S]+?)\s*(-----END [^-]+-----)$/)
  if (m) {
    const body = m[2].replace(/\s+/g, '')
    const wrapped = body.match(/.{1,64}/g)!.join('\n')
    pem = `${m[1]}\n${wrapped}\n${m[3]}`
  }

  return pem
}

async function resolvePrivateKeyPem(flowId: string): Promise<string> {
  try {
    const flow = await prisma.flow.findUnique({ where: { id: flowId }, select: { account_id: true } })
    if (flow?.account_id) {
      const config = await prisma.whatsAppConfig.findUnique({
        where: { account_id: flow.account_id },
        select: { flows_private_key: true },
      })
      if (config?.flows_private_key) {
        const { decrypt } = await import('@/lib/whatsapp/encryption')
        const pem = normalizePem(decrypt(config.flows_private_key))
        console.log('[webhook] using private key from DB for flow', flowId)
        return pem
      }
      console.warn('[webhook] no flows_private_key in DB for account', flow.account_id, '— falling back to env var')
    }
  } catch (err) {
    console.error('[webhook] DB key lookup failed:', err instanceof Error ? err.message : err, '— falling back to env var')
  }
  const rawEnv = process.env.FLOWS_PRIVATE_KEY
  if (!rawEnv) {
    throw new Error(
      'No Flows private key found. Generate a key pair in Settings → WhatsApp → Flows Encryption.',
    )
  }
  const fromEnv = normalizePem(rawEnv)
  console.log('[webhook] using private key from env var for flow', flowId)
  return fromEnv
}

async function decryptMetaRequest(rawBody: Record<string, unknown>, flowId: string): Promise<DecryptedRequest> {
  const privateKeyPem = await resolvePrivateKeyPem(flowId)

  const { encrypted_aes_key, encrypted_flow_data, initial_vector } = rawBody as {
    encrypted_aes_key: string
    encrypted_flow_data: string
    initial_vector: string
  }

  if (!encrypted_aes_key || !encrypted_flow_data || !initial_vector) {
    throw new Error('Request is missing encryption fields (encrypted_aes_key / encrypted_flow_data / initial_vector).')
  }

  const encryptedKey = Buffer.from(encrypted_aes_key.trim(), 'base64')
  const keyObj = crypto.createPrivateKey(privateKeyPem)
  const keyBits = (keyObj.asymmetricKeyDetails?.modulusLength ?? 0)
  if (keyBits > 0 && encryptedKey.length > keyBits / 8) {
    throw new Error(
      `encrypted_aes_key is ${encryptedKey.length} bytes but the private key modulus is only ${keyBits / 8} bytes. ` +
      `The public key uploaded to Meta does not match the private key configured here.`,
    )
  }

  let aesKey: Buffer
  try {
    aesKey = crypto.privateDecrypt(
      { key: privateKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      encryptedKey,
    )
  } catch {
    try {
      aesKey = crypto.privateDecrypt(
        { key: privateKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' },
        encryptedKey,
      )
    } catch (err2) {
      const origMsg = err2 instanceof Error ? err2.message : String(err2)
      const isTooLarge = origMsg.includes('data too large') || encryptedKey.length > (keyBits > 0 ? keyBits / 8 : 999)
      const hint = isTooLarge
        ? `\n\nLikely cause: Meta encrypted the AES key using your uploaded PUBLIC key (${encryptedKey.length} bytes encrypted = ${encryptedKey.length * 8}-bit key space), but your PRIVATE key is ${keyBits || 'unknown'} bits — too small to decrypt it.\n→ Go to Settings → WhatsApp Flows → generate a NEW 2048-bit RSA key pair → copy the private key into settings → upload the new public key to Meta Business Manager → re-publish the flow.`
        : ''
      throw new Error(
        `RSA decryption failed (tried sha256 and sha1). ` +
        `Key size: ${keyBits} bits, encrypted data: ${encryptedKey.length} bytes. ` +
        `Original error: ${origMsg}${hint}`,
      )
    }
  }

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
  const flippedIv = Buffer.from(initialVector.map((b) => ~b & 0xff))

  const cipher = crypto.createCipheriv('aes-128-gcm', aesKey, flippedIv)
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(data), 'utf-8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  return Buffer.concat([encrypted, authTag]).toString('base64')
}

// ── Core handler — shared by webhook and data-exchange routes ─────

export async function handleFlowWebhookPost(request: Request, flowId: string): Promise<Response> {
  try {

  let rawBody: Record<string, unknown>
  try {
    const text = await request.text()
    rawBody = JSON.parse(text) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  let payload: Record<string, unknown>
  let aesKey: Buffer
  let initialVector: Buffer

  try {
    const decrypted = await decryptMetaRequest(rawBody, flowId)
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

  if (action === 'ping') {
    const encrypted = encryptMetaResponse({ data: { status: 'active' } }, aesKey, initialVector)
    return new Response(encrypted, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

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

  if (action === 'data_exchange') {
    const currentScreenId = payload.screen as string | undefined
    const flowToken = payload.flow_token as string | undefined

    let rawData = (payload.data ?? {}) as Record<string, unknown>
    if (Object.keys(rawData).length === 1) {
      const onlyVal = rawData[Object.keys(rawData)[0]]
      if (onlyVal && typeof onlyVal === 'object' && !Array.isArray(onlyVal)) {
        rawData = onlyVal as Record<string, unknown>
      }
    }
    const formData = rawData

    console.log('[data_exchange] screen:', currentScreenId, '| formData:', JSON.stringify(formData))

    const submittedScreen = screens.find((s) => sanitizeId(s.id) === currentScreenId) ?? screens[0]
    const submittedComps = flatComps(submittedScreen?.components ?? [])
    const hasSaveFields = submittedComps.some((c) => c._save_field_key)

    const filterTrigger = submittedComps.find(
      (c) => c._filter_trigger === true && c.name && (c.name as string) in formData,
    )
    const isFooterNavigation = !!formData.__target_screen
    if (filterTrigger && !hasSaveFields && !isFooterNavigation) {
      const triggerName = filterTrigger.name as string
      const triggerValue = slugify(String(formData[triggerName] ?? ''))
      console.log('[data_exchange:filter] trigger:', triggerName, '=', triggerValue)

      const freshData: Record<string, unknown> = {}
      await Promise.all(
        submittedComps
          .filter((c) => c._source_table_id && c._source_field_key)
          .map(async (c) => {
            const tableId = c._source_table_id as string
            const fieldKey = c._source_field_key as string
            const filterByField = c._filter_by_field as string | undefined
            const filterFormName = c._filter_form_name as string | undefined
            const isLabel = c.type === 'TextLabel' && !!c.name
            // Same rule as the "load" branch below: a component filtered by
            // a field OTHER than the one that just changed must still resolve
            // against formData (its own parent may already have a value from
            // earlier on this screen) rather than only matching the current
            // trigger — and if its parent has no value yet, show empty, not
            // an arbitrary unfiltered fallback.
            const isFiltered = !!(filterByField && filterFormName)

            if (isLabel) {
              const varName = makeLabelVarName(String(c.name))
              if (isFiltered && filterFormName! in formData) {
                const ownTriggerValue = filterFormName === triggerName ? triggerValue : slugify(String(formData[filterFormName!] ?? ''))
                freshData[varName] = await fetchLabelValue(tableId, fieldKey, filterByField, ownTriggerValue)
                console.log('[data_exchange:filter]', varName, '→ label:', freshData[varName])
              } else if (isFiltered) {
                freshData[varName] = ''
              } else {
                freshData[varName] = await fetchLabelValue(tableId, fieldKey)
              }
            } else {
              const varName = makeVarName(fieldKey)
              if (isFiltered && filterFormName! in formData) {
                const ownTriggerValue = filterFormName === triggerName ? triggerValue : slugify(String(formData[filterFormName!] ?? ''))
                freshData[varName] = await fetchOptions(tableId, fieldKey, filterByField, ownTriggerValue)
                console.log('[data_exchange:filter]', varName, '→', (freshData[varName] as unknown[]).length, 'filtered options')
              } else if (isFiltered) {
                freshData[varName] = []
              } else {
                freshData[varName] = await fetchOptions(tableId, fieldKey)
              }
            }
          }),
      )

      return sendEncrypted({
        version: '3.0',
        screen: currentScreenId ?? sanitizeId(submittedScreen?.id ?? 'SCREEN'),
        data: freshData,
      })
    }

    if (!hasSaveFields) {
      const requestedScreenId = formData.__target_screen as string | undefined

      const formScreen = requestedScreenId
        ? screens.find((s) => sanitizeId(s.id) === requestedScreenId)
        : screens.find((s) => {
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

      const freshData: Record<string, unknown> = {}
      await Promise.all(
        flatComps(formScreen.components ?? [])
          .filter((c) => c._source_table_id && c._source_field_key)
          .map(async (c) => {
            const tableId = c._source_table_id as string
            const fieldKey = c._source_field_key as string
            const filterByField = c._filter_by_field as string | undefined
            const filterFormName = c._filter_form_name as string | undefined
            const isLabel = c.type === 'TextLabel' && !!c.name

            // A field with filterByField+filterFormName is *designed* to be
            // filtered — if the parent's value isn't in formData yet (parent
            // not selected), it must show empty/waiting, never an unfiltered
            // fallback (which would surface an arbitrary record's value, as
            // if that field weren't filtered at all). Unfiltered fetches are
            // only correct for fields that have no filter config at all.
            const isFiltered = !!(filterByField && filterFormName)
            if (isLabel) {
              const varName = makeLabelVarName(String(c.name))
              if (isFiltered && filterFormName! in formData) {
                const triggerValue = slugify(String(formData[filterFormName!] ?? ''))
                freshData[varName] = await fetchLabelValue(tableId, fieldKey, filterByField, triggerValue)
                console.log('[data_exchange:load] filtered label', varName, '=', freshData[varName])
              } else if (isFiltered) {
                freshData[varName] = ''
                console.log('[data_exchange:load]', varName, "→ '' (empty until parent selected)")
              } else {
                freshData[varName] = await fetchLabelValue(tableId, fieldKey)
                console.log('[data_exchange:load] label', varName, '=', freshData[varName])
              }
            } else {
              const varName = makeVarName(fieldKey)
              if (isFiltered && filterFormName! in formData) {
                const triggerValue = slugify(String(formData[filterFormName!] ?? ''))
                const opts = await fetchOptions(tableId, fieldKey, filterByField, triggerValue)
                freshData[varName] = opts
                console.log('[data_exchange:load] filtered', varName, 'by', filterFormName, '=', triggerValue, '→', opts.length, 'options')
              } else if (isFiltered) {
                freshData[varName] = []
                console.log('[data_exchange:load]', varName, '→ [] (empty until parent selected)')
              } else {
                const opts = await fetchOptions(tableId, fieldKey)
                freshData[varName] = opts
                console.log('[data_exchange:load]', varName, '→', opts.length, 'options')
              }
            }
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

  type SourceEntry = { tableId: string; fieldKey: string; varName: string; isFiltered: boolean; isLabel?: boolean }
  const sources = new Map<string, SourceEntry>()

  function collectSources(comps: Array<Record<string, unknown>>) {
    for (const comp of comps) {
      const tableId = comp._source_table_id as string | undefined
      const fieldKey = comp._source_field_key as string | undefined
      if (tableId && fieldKey) {
        const isLabel = comp.type === 'TextLabel' && !!comp.name
        // Use a unique key that includes the label name so multiple labels on same
        // table+field get separate entries
        const key = isLabel ? `label::${tableId}::${fieldKey}::${comp.name}` : `${tableId}::${fieldKey}`
        if (!sources.has(key)) {
          sources.set(key, {
            tableId,
            fieldKey,
            varName: isLabel ? makeLabelVarName(String(comp.name)) : makeVarName(fieldKey),
            isFiltered: !!(comp._filter_form_name),
            isLabel,
          })
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
    Array.from(sources.values()).map(async ({ tableId, fieldKey, varName, isFiltered, isLabel }) => {
      if (isLabel) {
        if (isFiltered) {
          console.log(`[webhook] ${varName}: filtered label → '' (empty until parent selected)`)
          responseData[varName] = ''
        } else {
          const val = await fetchLabelValue(tableId, fieldKey)
          console.log(`[webhook] ${varName}: label value = "${val}"`)
          responseData[varName] = val
        }
      } else {
        if (isFiltered) {
          console.log(`[webhook] ${varName}: filtered child → [] (empty until parent selected)`)
          responseData[varName] = []
        } else {
          const opts = await fetchOptions(tableId, fieldKey)
          console.log(`[webhook] ${varName}: ${opts.length} options`)
          responseData[varName] = opts
        }
      }
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
