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

// One token's RAW resolved value (no surrounding static text) — distinct
// from makeLabelVarName's combined display string, since a label mixing
// "Target Group : {{token}}" needs its own display var for the TextBody
// ("Target Group : ministerial") AND a separate save-able var holding just
// "ministerial" for Field Mapping to target.
function makeMultiLabelVarName(labelName: string, sourceId: string): string {
  const a = labelName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  const b = sourceId.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  return `${a}_${b}_raw`
}

// Mirrors upload/route.ts's copy — must stay in sync so the ${data.X}
// pass-through references Meta sends match the keys read/written here.
function makeSaveCarryVarName(saveFieldKey: string): string {
  return saveFieldKey.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') + '_carried'
}

// Every save-mapped field (Field Mapping in "Save form data to"), across
// ALL screens in the flow — keyed by DataStore field_key, which is stable
// and unique per table regardless of which screen's component collects it.
// A field can be mapped either on a component itself (regular inputs,
// legacy single-source labels) or on one specific token inside a multi-
// source label's _sources — both are scanned here.
function collectAllSaveFields(
  screens: Array<{ components: Array<Record<string, unknown>> }>,
): Array<{ fieldKey: string; carryVar: string }> {
  const seen = new Set<string>()
  const out: Array<{ fieldKey: string; carryVar: string }> = []
  const add = (fk: string | undefined) => {
    if (fk && !seen.has(fk)) {
      seen.add(fk)
      out.push({ fieldKey: fk, carryVar: makeSaveCarryVarName(fk) })
    }
  }
  for (const s of screens) {
    for (const c of flatCompsShallow(s.components ?? [])) {
      add(c._save_field_key as string | undefined)
      const sources = c._sources as Array<{ _save_field_key?: string }> | undefined
      if (Array.isArray(sources)) {
        for (const src of sources) add(src._save_field_key)
      }
    }
  }
  return out
}

// Finds the data-model variable holding a save-mapped field's live value on
// a given set of components — a component-level match (regular input or
// legacy single-source label) returns its own name (plus the component
// itself, so the caller can resolve a static Dropdown/RadioButtonsGroup/
// CheckboxGroup option id back to its title); a match on one token inside
// a multi-source label's _sources returns that token's own raw var
// (makeMultiLabelVarName), NOT the label's combined display var, since the
// combined string includes surrounding static text the saved value must not
// — labels have no option-id concept, so no collector is returned for them.
function findSaveFieldVarKey(
  comps: Array<Record<string, unknown>>,
  fieldKey: string,
): { varKey: string; collector?: Record<string, unknown> } | undefined {
  for (const c of comps) {
    if (c._save_field_key === fieldKey && c.name) return { varKey: String(c.name), collector: c }
    const sources = c._sources as Array<{ id: string; _save_field_key?: string }> | undefined
    if (Array.isArray(sources)) {
      const src = sources.find((s) => s._save_field_key === fieldKey)
      if (src && c.name) return { varKey: makeMultiLabelVarName(String(c.name), src.id) }
    }
  }
  return undefined
}

// WhatsApp submits a Dropdown/RadioButtonsGroup/CheckboxGroup's selected
// option `id`, not its human-readable `title` — fine for filtering (our own
// DB-backed dropdowns resolve titles server-side), but wrong for STATIC
// option lists (e.g. a fixed "Select District" dropdown), where the id is
// often just an arbitrary "opt_1"-style placeholder. Resolves it back to
// the option's title before saving, so the DataStore record shows
// "Alappuzha" instead of "opt_1". DB-backed dropdowns are unaffected —
// their data-source is a "${data.x}" template string at this point, not an
// array, so this is a no-op for them.
function resolveStaticOptionValue(comp: Record<string, unknown>, submittedValue: unknown): unknown {
  const dataSource = comp['data-source']
  if (!Array.isArray(dataSource)) return submittedValue
  const titleFor = (id: unknown) => {
    const match = (dataSource as Array<Record<string, unknown>>).find((opt) => opt?.id === id)
    return match ? match.title : id
  }
  return Array.isArray(submittedValue) ? submittedValue.map(titleFor) : titleFor(submittedValue)
}

// Non-recursive Form-unwrap — same shape as the in-scope flatComps() used
// elsewhere in this file, duplicated here because collectAllSaveFields is
// called before flatComps is defined in some call sites' scope.
function flatCompsShallow(comps: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
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

// A Label component can now bind MULTIPLE named data sources into one text
// template (plain text + several {{token}} placeholders). Each source gets
// its own data-model variable, namespaced by both the label's name and the
// token id so two different labels can reuse the same token name.
interface LabelSourceConfig {
  id: string
  table_id: string
  field_key: string
  filter_form_name?: string
  filter_by_field?: string
  /** DataStore field_key this ONE token's raw value should be saved into. */
  _save_field_key?: string
}

interface ResolvedSource {
  varName: string
  isLabel: boolean
  // Simple shape — legacy single-source labels, and every non-label
  // dynamic component (Dropdown/RadioButtonsGroup/etc. options).
  tableId?: string
  fieldKey?: string
  filterByField?: string
  filterFormName?: string
  // Multi-source label shape — mutually exclusive with the above. Meta only
  // accepts ${data.X} as a component's ENTIRE text value (no interpolating
  // a token mid-string), so a label mixing plain text with several
  // {{token}}s can't be composed client-side by Meta at all — we resolve
  // every token's value here and substitute them into the template
  // ourselves, exposing ONE fully-formatted string as a single variable —
  // plus each token's own raw (unsubstituted) value under its own var, for
  // Field Mapping / save purposes.
  multi?: { name: string; template: string; sources: LabelSourceConfig[] }
}

// Reads a component's data bindings — either the new multi-source `_sources`
// array (Label components with plain text + multiple {{token}} values), or
// the legacy single-source fields every other dynamic component (and older
// Label components saved before multi-source existed) still use. Always
// returns exactly one entry per component (a multi-source label composes
// down to a single variable, not one per token).
function flattenComponentSources(c: Record<string, unknown>): ResolvedSource[] {
  const isLabel = c.type === 'TextLabel' && !!c.name
  const name = c.name as string | undefined

  if (isLabel && name) {
    const sources = c._sources as LabelSourceConfig[] | undefined
    if (Array.isArray(sources) && sources.length > 0) {
      const validSources = sources.filter((s) => s.table_id && s.field_key)
      if (validSources.length === 0) return []
      return [{
        varName: makeLabelVarName(name),
        isLabel: true,
        multi: { name, template: String(c.text ?? ''), sources: validSources },
      }]
    }
  }

  const tableId = c._source_table_id as string | undefined
  const fieldKey = c._source_field_key as string | undefined
  if (!tableId || !fieldKey) return []
  return [{
    varName: isLabel ? makeLabelVarName(String(name)) : makeVarName(fieldKey),
    tableId,
    fieldKey,
    filterByField: c._filter_by_field as string | undefined,
    filterFormName: c._filter_form_name as string | undefined,
    isLabel,
  }]
}

// Substitutes every {{token}} in a multi-source label's template with its
// own DataStore value, respecting each source's independent parent filter.
// A token whose parent hasn't been selected yet (or that has no filter at
// all and simply has no matching record) resolves to an empty string —
// same "stay blank until ready" rule as every other filtered field in this
// file, just applied per-token within one combined string instead of
// gating the whole component.
//
// triggerName/triggerValue are only meaningful for the same-screen filter-
// refresh call (a specific field's on-select just fired) — pass null/null
// from INIT and the screen-navigate "load" branch, where there's no single
// "the field that just changed" to shortcut against.
async function resolveLabelTemplate(
  template: string,
  sources: LabelSourceConfig[],
  formData: Record<string, unknown>,
  triggerName: string | null,
  triggerValue: string | null,
): Promise<{ text: string; tokenValues: Record<string, string> }> {
  let result = template
  const tokenValues: Record<string, string> = {}
  for (const s of sources) {
    const isFiltered = !!(s.filter_by_field && s.filter_form_name)
    let value = ''
    if (isFiltered) {
      if (hasFormValue(formData, s.filter_form_name!)) {
        const ownTriggerValue = (triggerName !== null && s.filter_form_name === triggerName)
          ? (triggerValue ?? '')
          : slugify(String(formData[s.filter_form_name!]))
        value = await fetchLabelValue(s.table_id, s.field_key, s.filter_by_field, ownTriggerValue)
      }
      // else: parent not yet selected — token resolves to '' below.
    } else {
      value = await fetchLabelValue(s.table_id, s.field_key)
    }
    tokenValues[s.id] = value
    const tokenRe = new RegExp(`\\{\\{\\s*${s.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}`, 'g')
    result = result.replace(tokenRe, value)
  }
  return { text: result, tokenValues }
}

function slugify(val: string): string {
  return val.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

// Meta's client includes every declared form field in the data_exchange
// payload, even ones the user hasn't touched yet — as an empty string, not
// an absent key. So `key in formData` is true long before the user actually
// picks a value; only a genuinely non-empty value means the parent is set.
//
// Worse: when a Dropdown's data-source is refreshed dynamically (e.g. a
// filtered child whose options just changed because its own parent changed),
// the WhatsApp client can silently bind that Dropdown's internal form value
// to the FIRST item of the new list — and if that Dropdown also has its own
// on-select-action (because it's itself a filter trigger for something else),
// the action fires for real with this phantom value, with no visible
// selection in the UI and no genuine user tap. UNSELECTED_OPTION_ID is
// prepended to every dynamic options list specifically so this phantom
// default lands on an inert placeholder instead of a real record.
const UNSELECTED_OPTION_ID = '__unselected__'
// Used in place of a bare [] wherever a filtered dropdown has no parent value
// yet — keeps the field a usable, non-empty (but non-selectable) dropdown
// rather than one with zero options.
const EMPTY_FILTERED_OPTIONS = [{ id: UNSELECTED_OPTION_ID, title: 'Select…', enabled: false }]

function hasFormValue(formData: Record<string, unknown>, key: string): boolean {
  const v = formData[key]
  return v != null && String(v).trim() !== '' && v !== UNSELECTED_OPTION_ID
}

async function fetchOptions(
  tableId: string,
  fieldKey: string,
  filterField?: string,
  filterValue?: string,
): Promise<Array<{ id: string; title: string; enabled?: boolean }>> {
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

  return [{ id: UNSELECTED_OPTION_ID, title: 'Select…', enabled: false }, ...options]
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
    const allSaveFields = collectAllSaveFields(screens)

    const filterTrigger = submittedComps.find(
      (c) => c._filter_trigger === true && c.name && (c.name as string) in formData,
    )
    const isFooterNavigation = !!formData.__target_screen
    // __filter_refresh is a marker we set on EVERY filter-trigger's own
    // on-select payload specifically so this request type is unambiguous —
    // it must win over hasSaveFields. Without this, a screen that has BOTH
    // a filter trigger AND "Save form data to" configured (e.g. Month is
    // itself save-mapped for the final submission, but also triggers
    // Programme's filter) would misroute every filter refresh into a
    // premature partial save + terminal SUCCESS, closing the flow the
    // instant the user picks the first field.
    const isFilterRefresh = formData.__filter_refresh === '1'
    if (filterTrigger && isFilterRefresh) {
      const triggerName = filterTrigger.name as string
      const triggerValue = slugify(String(formData[triggerName] ?? ''))
      console.log('[data_exchange:filter] trigger:', triggerName, '=', triggerValue)

      const freshData: Record<string, unknown> = {}
      await Promise.all(
        submittedComps
          // Exclude the trigger itself: when a component is BOTH a filtered
          // child (of e.g. Month) AND a filter trigger (for e.g. Coordinator),
          // its own on-select payload only carries ITS OWN field — not its
          // parent's value. Recomputing its own data-source here would see
          // its parent missing and wrongly collapse it back to the empty
          // placeholder-only list, wiping out the selection the user just
          // made (dropdown resets right after picking a value).
          .filter((c) => c !== filterTrigger)
          .flatMap((c) => flattenComponentSources(c))
          .map(async ({ varName, tableId, fieldKey, filterByField, filterFormName, isLabel, multi }) => {
            if (multi) {
              const { text, tokenValues } = await resolveLabelTemplate(multi.template, multi.sources, formData, triggerName, triggerValue)
              freshData[varName] = text
              for (const [tokenId, val] of Object.entries(tokenValues)) {
                freshData[makeMultiLabelVarName(multi.name, tokenId)] = val
              }
              console.log('[data_exchange:filter]', varName, '→ multi-source label:', text)
              return
            }
            // Same rule as the "load" branch below: a source filtered by a
            // field OTHER than the one that just changed must still resolve
            // against formData (its own parent may already have a value from
            // earlier on this screen) rather than only matching the current
            // trigger — and if its parent has no value yet, show empty, not
            // an arbitrary unfiltered fallback.
            const isFiltered = !!(filterByField && filterFormName)

            if (isLabel) {
              if (isFiltered && hasFormValue(formData, filterFormName!)) {
                const ownTriggerValue = filterFormName === triggerName ? triggerValue : slugify(String(formData[filterFormName!]))
                freshData[varName] = await fetchLabelValue(tableId!, fieldKey!, filterByField, ownTriggerValue)
                console.log('[data_exchange:filter]', varName, '→ label:', freshData[varName])
              } else if (isFiltered) {
                freshData[varName] = ''
              } else {
                freshData[varName] = await fetchLabelValue(tableId!, fieldKey!)
              }
            } else {
              if (isFiltered && hasFormValue(formData, filterFormName!)) {
                const ownTriggerValue = filterFormName === triggerName ? triggerValue : slugify(String(formData[filterFormName!]))
                freshData[varName] = await fetchOptions(tableId!, fieldKey!, filterByField, ownTriggerValue)
                console.log('[data_exchange:filter]', varName, '→', (freshData[varName] as unknown[]).length, 'filtered options')
              } else if (isFiltered) {
                freshData[varName] = EMPTY_FILTERED_OPTIONS
              } else {
                freshData[varName] = await fetchOptions(tableId!, fieldKey!)
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

    // Same priority rule as above: an explicit navigation request
    // (__target_screen, set when a filter-trigger screen's footer is
    // converted to data_exchange) must win over hasSaveFields too — a
    // screen can have both a filter trigger's save-mapped field AND a
    // "Continue" button that needs to actually navigate forward.
    if (isFooterNavigation || !hasSaveFields) {
      const requestedScreenId = formData.__target_screen as string | undefined

      const formScreen = requestedScreenId
        ? screens.find((s) => sanitizeId(s.id) === requestedScreenId)
        : screens.find((s) => {
            if (s.id === submittedScreen?.id) return false
            const comps = flatComps(s.components ?? [])
            return comps.some((c) => c._source_table_id || c._save_field_key || (Array.isArray(c._sources) && (c._sources as unknown[]).length > 0))
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
          .flatMap((c) => flattenComponentSources(c))
          .map(async ({ varName, tableId, fieldKey, filterByField, filterFormName, isLabel, multi }) => {
            if (multi) {
              const { text, tokenValues } = await resolveLabelTemplate(multi.template, multi.sources, formData, null, null)
              freshData[varName] = text
              for (const [tokenId, val] of Object.entries(tokenValues)) {
                freshData[makeMultiLabelVarName(multi.name, tokenId)] = val
              }
              console.log('[data_exchange:load] multi-source label', varName, '=', text)
              return
            }
            // A source with filterByField+filterFormName is *designed* to be
            // filtered — if the parent's value isn't in formData yet (parent
            // not selected), it must show empty/waiting, never an unfiltered
            // fallback (which would surface an arbitrary record's value, as
            // if that field weren't filtered at all). Unfiltered fetches are
            // only correct for fields that have no filter config at all.
            const isFiltered = !!(filterByField && filterFormName)
            if (isLabel) {
              if (isFiltered && hasFormValue(formData, filterFormName!)) {
                const triggerValue = slugify(String(formData[filterFormName!]))
                freshData[varName] = await fetchLabelValue(tableId!, fieldKey!, filterByField, triggerValue)
                console.log('[data_exchange:load] filtered label', varName, '=', freshData[varName])
              } else if (isFiltered) {
                freshData[varName] = ''
                console.log('[data_exchange:load]', varName, "→ '' (empty until parent selected)")
              } else {
                freshData[varName] = await fetchLabelValue(tableId!, fieldKey!)
                console.log('[data_exchange:load] label', varName, '=', freshData[varName])
              }
            } else {
              if (isFiltered && hasFormValue(formData, filterFormName!)) {
                const triggerValue = slugify(String(formData[filterFormName!]))
                const opts = await fetchOptions(tableId!, fieldKey!, filterByField, triggerValue)
                freshData[varName] = opts
                console.log('[data_exchange:load] filtered', varName, 'by', filterFormName, '=', triggerValue, '→', opts.length, 'options')
              } else if (isFiltered) {
                freshData[varName] = EMPTY_FILTERED_OPTIONS
                console.log('[data_exchange:load]', varName, '→ [] (empty until parent selected)')
              } else {
                const opts = await fetchOptions(tableId!, fieldKey!)
                freshData[varName] = opts
                console.log('[data_exchange:load]', varName, '→', opts.length, 'options')
              }
            }
          }),
      )

      // Carry every save-mapped field's value forward into the target
      // screen: if the screen we're navigating AWAY FROM collected it,
      // use its just-submitted live value; otherwise pass through
      // whatever was already carried (from an even earlier screen).
      for (const sf of allSaveFields) {
        const found = findSaveFieldVarKey(submittedComps, sf.fieldKey)
        if (found && found.varKey in formData) {
          const raw = formData[found.varKey]
          freshData[sf.carryVar] = found.collector ? resolveStaticOptionValue(found.collector, raw) : raw
        } else {
          freshData[sf.carryVar] = formData[sf.carryVar] ?? ''
        }
      }

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
      for (const sf of allSaveFields) {
        // Collected on THIS (final) screen — component-level (regular
        // input, legacy single-source label) or one token inside a multi-
        // source label's _sources: read its live value directly.
        const found = findSaveFieldVarKey(submittedComps, sf.fieldKey)
        if (found && found.varKey in formData) {
          const raw = formData[found.varKey]
          record[sf.fieldKey] = found.collector ? resolveStaticOptionValue(found.collector, raw) : raw
          continue
        }
        // Collected on an EARLIER screen: the "load" branch already
        // resolved any static option id to its title before carrying it
        // forward, so this is used as-is.
        if (sf.carryVar in formData) record[sf.fieldKey] = formData[sf.carryVar]
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

  const sources = new Map<string, ResolvedSource>()

  function collectSources(comps: Array<Record<string, unknown>>) {
    for (const comp of comps) {
      for (const src of flattenComponentSources(comp)) {
        // varName is already unique per label (or table+field for
        // options), so it doubles as the dedup key.
        if (!sources.has(src.varName)) {
          sources.set(src.varName, src)
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
    Array.from(sources.values()).map(async ({ tableId, fieldKey, varName, filterFormName, isLabel, multi }) => {
      if (multi) {
        // No formData exists yet at INIT — every filtered token in the
        // template correctly resolves to '' via resolveLabelTemplate's own
        // hasFormValue check, unfiltered tokens still resolve to a real value.
        const { text, tokenValues } = await resolveLabelTemplate(multi.template, multi.sources, {}, null, null)
        responseData[varName] = text
        for (const [tokenId, val] of Object.entries(tokenValues)) {
          responseData[makeMultiLabelVarName(multi.name, tokenId)] = val
        }
        console.log(`[webhook] ${varName}: multi-source label = "${text}"`)
        return
      }
      const isFiltered = !!filterFormName
      if (isLabel) {
        if (isFiltered) {
          console.log(`[webhook] ${varName}: filtered label → '' (empty until parent selected)`)
          responseData[varName] = ''
        } else {
          const val = await fetchLabelValue(tableId!, fieldKey!)
          console.log(`[webhook] ${varName}: label value = "${val}"`)
          responseData[varName] = val
        }
      } else {
        if (isFiltered) {
          console.log(`[webhook] ${varName}: filtered child → [] (empty until parent selected)`)
          responseData[varName] = EMPTY_FILTERED_OPTIONS
        } else {
          const opts = await fetchOptions(tableId!, fieldKey!)
          console.log(`[webhook] ${varName}: ${opts.length} options`)
          responseData[varName] = opts
        }
      }
    }),
  )

  // Every carry-forward save field starts empty — nothing has been
  // collected yet at INIT.
  for (const sf of collectAllSaveFields(screens)) {
    responseData[sf.carryVar] = ''
  }

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
