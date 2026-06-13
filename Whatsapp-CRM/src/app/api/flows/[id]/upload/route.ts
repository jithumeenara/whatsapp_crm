import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

// ── Meta Flow JSON transformer ────────────────────────────────────
// Converts CRM's internal screen structure to Meta-compliant Flow JSON.
// Meta requires:
//   - screen.id: only uppercase letters and underscores (no digits)
//   - screen.layout: { type: "SingleColumnLayout", children: [...] }
//   - no internal "id" field on components (CRM-only React key)
//   - optional string fields must be omitted when empty (never send "")
//   - helper-text must be an object { text: "..." } not a plain string (v7.1)

function sanitizeScreenId(raw: string): string {
  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  return cleaned || 'SCREEN'
}

// Fields that are optional strings — must be omitted entirely when blank.
// Meta rejects empty strings; some (like helper-text) also require object form.
const OPTIONAL_STRING_FIELDS = new Set([
  'helper-text',
  'alt-text',
  'left-caption',
  'center-caption',
  'min-date',
  'max-date',
])

function cleanComponent(comp: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(comp)) {
    // Strip CRM-internal fields (underscore-prefixed) — never sent to Meta
    if (key.startsWith('_')) continue
    // Strip optional fields that are empty/null/undefined
    if (OPTIONAL_STRING_FIELDS.has(key)) {
      if (val === '' || val === null || val === undefined) continue
      // helper-text must be an object in v7.1: { text: "..." }
      if (key === 'helper-text' && typeof val === 'string') {
        out[key] = { text: val }
        continue
      }
    }
    out[key] = val
  }

  // Footer caption exclusivity (Meta v7.1 rule):
  //   Option A: center-caption only
  //   Option B: left-caption + right-caption together
  //   Mixing them is a validation error.
  if (out.type === 'Footer') {
    const hasCenter = out['center-caption'] != null && out['center-caption'] !== ''
    const hasLeft   = out['left-caption']   != null && out['left-caption']   !== ''
    const hasRight  = out['right-caption']  != null && out['right-caption']  !== ''

    if (hasCenter && (hasLeft || hasRight)) {
      // center-caption wins; drop the left/right pair
      delete out['left-caption']
      delete out['right-caption']
    } else if (hasLeft && !hasRight) {
      // left-caption without right-caption is invalid; drop both
      delete out['left-caption']
    } else if (hasRight && !hasLeft) {
      // right-caption without left-caption is invalid; drop both
      delete out['right-caption']
    }
  }

  return out
}

function makeVarName(fieldKey: string): string {
  return fieldKey.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') + '_options'
}

// If the flow uses data_exchange (endpoint submit) but has no terminal screen,
// auto-append a SUCCESS screen so Meta's "Terminal screen is required" error is avoided.
function ensureTerminalScreen(
  screens: Record<string, unknown>[],
  routingModel: Record<string, string[]>,
): void {
  // Treat a screen as terminal if it's explicitly marked OR has id 'SUCCESS'.
  // Mutate terminal: true onto SUCCESS screens that are missing the flag —
  // trigger_config may lose it via auto-save if the builder doesn't round-trip it.
  const terminalIds: string[] = []
  for (const s of screens) {
    const rec = s as Record<string, unknown>
    const isTerminal = rec.terminal === true || rec.id === 'SUCCESS'
    if (isTerminal) {
      if (!rec.terminal) rec.terminal = true  // ensure the flag is in the JSON sent to Meta
      terminalIds.push(rec.id as string)
    }
  }

  if (terminalIds.length > 0) {
    // Terminal screens found — wire up routing_model so Meta's connectivity check passes.
    // (data_exchange actions navigate to SUCCESS at runtime, but routing_model only
    //  knows about static 'navigate' actions, so we add the link explicitly here.)
    for (const termId of terminalIds) {
      if (!routingModel[termId]) routingModel[termId] = []
      for (const [sid, targets] of Object.entries(routingModel)) {
        if (!terminalIds.includes(sid) && !targets.includes(termId)) {
          routingModel[sid] = [...targets, termId]
        }
      }
    }
    return
  }

  // No terminal screen at all — auto-add SUCCESS if any screen uses data_exchange.
  const hasDataExchange = screens.some((s) => {
    const children = (((s as Record<string, unknown>).layout as Record<string, unknown>)?.children ?? []) as Record<string, unknown>[]
    return children.some((c) => (c['on-click-action'] as Record<string, unknown>)?.name === 'data_exchange')
  })
  if (!hasDataExchange) return

  screens.push({
    id: 'SUCCESS',
    title: 'Success',
    terminal: true,
    layout: {
      type: 'SingleColumnLayout',
      children: [
        { type: 'TextHeading', text: 'Submitted Successfully' },
        { type: 'TextBody', text: 'Your information has been saved.' },
        { type: 'Footer', label: 'Done', 'on-click-action': { name: 'complete', payload: {} } },
      ],
    },
  })
  routingModel['SUCCESS'] = []
  for (const sid of Object.keys(routingModel)) {
    if (sid !== 'SUCCESS' && !routingModel[sid].includes('SUCCESS')) {
      routingModel[sid] = [...routingModel[sid], 'SUCCESS']
    }
  }
}

interface InternalScreen {
  id: string
  title: string
  terminal?: boolean
  components: (Record<string, unknown> & { id?: string })[]
}

interface TransformResult {
  screens: Record<string, unknown>[]
  hasDynamicData: boolean
}

/** Flatten layout.children, unwrapping any Form wrapper — needed for action detection. */
function flattenLayoutChildren(layoutChildren: Record<string, unknown>[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const child of layoutChildren) {
    if ((child as Record<string, unknown>).type === 'Form') {
      const inner = ((child as Record<string, unknown>).children ?? []) as Record<string, unknown>[]
      out.push(...inner)
    } else {
      out.push(child as Record<string, unknown>)
    }
  }
  return out
}

/** Ensure every on-click-action has payload: {} (required by Meta). Handles Form wrapper. */
function patchPayloads(screens: Record<string, unknown>[]): Record<string, unknown>[] {
  const patchComp = (c: Record<string, unknown>) => {
    const action = c['on-click-action'] as Record<string, unknown> | undefined
    return action && !action.payload ? { ...c, 'on-click-action': { ...action, payload: {} } } : c
  }
  return screens.map((screen) => {
    const s = { ...screen }
    const layout = s.layout as Record<string, unknown>
    if (!layout?.children) return s
    const children = (layout.children as Record<string, unknown>[]).map((child) => {
      if ((child as Record<string, unknown>).type === 'Form') {
        // Patch inside Form children
        const formChildren = ((child as Record<string, unknown>).children as Record<string, unknown>[]) ?? []
        return { ...(child as Record<string, unknown>), children: formChildren.map(patchComp) }
      }
      return patchComp(child as Record<string, unknown>)
    })
    s.layout = { ...layout, children }
    return s
  })
}

function transformScreensForMeta(screens: InternalScreen[]): TransformResult {
  const idMap: Record<string, string> = {}
  for (const s of screens) {
    idMap[s.id] = sanitizeScreenId(s.id)
  }

  let hasDynamicData = false

  const transformedScreens = screens.map((screen) => {
    const dynamicDecls: Record<string, unknown> = {}

    // Collect names of all named form fields on this screen (for payload refs)
    const namedFields = screen.components
      .map((c) => (c as Record<string, unknown>).name as string | undefined)
      .filter((n): n is string => Boolean(n))

    const cleanedComps = screen.components.map((comp) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, ...raw } = comp

      // Dynamic data source — replace static array with ${data.VARNAME} reference.
      // The webhook endpoint will serve fresh DB values at runtime.
      if (raw._source_table_id && raw._source_field_key) {
        const fieldKey = String(raw._source_field_key)
        const varName = makeVarName(fieldKey)
        hasDynamicData = true
        dynamicDecls[varName] = {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, title: { type: 'string' } },
          },
          '__example__': [{ id: 'example_1', title: 'Example' }],
        }
        raw['data-source'] = `\${data.${varName}}`
      }

      // Fix Footer navigate references to use sanitized screen IDs.
      // For data_exchange Footers, auto-populate payload with ${form.field} refs
      // so Meta includes all form field values in the webhook call.
      if (raw['on-click-action']) {
        const action = raw['on-click-action'] as Record<string, unknown>
        if (action.name === 'navigate' && action.next) {
          const next = action.next as Record<string, unknown>
          if (typeof next.name === 'string') {
            raw['on-click-action'] = {
              ...action,
              next: { ...next, name: idMap[next.name] ?? sanitizeScreenId(next.name) },
            }
          }
        } else if (action.name === 'data_exchange') {
          // Build form field references so Meta sends the filled values to our webhook
          const formRefs: Record<string, string> = {}
          for (const name of namedFields) {
            formRefs[name] = `\${form.${name}}`
          }
          raw['on-click-action'] = {
            ...action,
            payload: { ...formRefs, ...((action.payload as Record<string, unknown>) ?? {}) },
          }
        }
      }

      // Strip empty optional fields + convert helper-text to object
      return cleanComponent(raw)
    })

    // v7.3: Wrap all components inside a Form component (required for data_exchange
    // to receive form field values and for ${form.xxx} references to resolve).
    // Terminal/SUCCESS screens have no form elements — keep flat.
    const isTerminalScreen = screen.terminal === true || screen.id === 'SUCCESS'
    const hasFormElements = cleanedComps.some(
      (c) => !['TextHeading', 'TextSubheading', 'TextBody', 'TextCaption', 'Image'].includes(String(c.type)),
    )

    // Meta v7.3 requires a Footer on ALL screens, including terminal ones.
    // If the terminal screen has no Footer, auto-add one with 'complete' action.
    if (isTerminalScreen && !cleanedComps.some((c) => c.type === 'Footer')) {
      cleanedComps.push({ type: 'Footer', label: 'Done', 'on-click-action': { name: 'complete', payload: {} } })
    }

    let layoutChildren: Record<string, unknown>[]
    if (!isTerminalScreen && hasFormElements) {
      // Wrap everything (including Footer) in a Form component as per v7.3 spec
      layoutChildren = [{
        type: 'Form',
        name: 'flow_path',
        children: cleanedComps,
      }]
    } else {
      layoutChildren = cleanedComps
    }

    const result: Record<string, unknown> = {
      id: idMap[screen.id],
      title: screen.title,
      layout: { type: 'SingleColumnLayout', children: layoutChildren },
    }

    if (screen.terminal || screen.id === 'SUCCESS') result.terminal = true

    if (Object.keys(dynamicDecls).length > 0) {
      result.data = dynamicDecls
    }

    return result
  })

  return { screens: transformedScreens, hasDynamicData }
}

/**
 * POST /api/flows/[id]/upload
 *
 * Uploads a CRM flow to Meta as a WhatsApp Flow.
 *
 * Steps:
 *   1. Create a new flow on Meta: POST /{WABA_ID}/flows → returns meta_flow_id
 *   2. If the local flow has a MetaFlowDefinition (screens array in trigger_config),
 *      upload the JSON asset: POST /{meta_flow_id}/assets
 *   3. Save the meta_flow_id back into trigger_config and set flow_type = whatsapp_flow
 *
 * After uploading, the flow status on Meta is DRAFT. Use the Publish button
 * to push it to PUBLISHED.
 *
 * GET /api/flows/[id]/upload?preview=1
 * Returns the transformed JSON that WOULD be uploaded — use this to verify
 * that data-source template strings are set correctly before uploading.
 */

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const url = new URL(request.url)
  if (url.searchParams.get('preview') !== '1') {
    return NextResponse.json({ error: 'Add ?preview=1' }, { status: 400 })
  }
  try {
    const { id } = await context.params
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const profile = await prisma.profile.findUnique({
      where: { user_id: session.user.id },
      select: { account_id: true },
    })
    const flow = await prisma.flow.findFirst({
      where: { id, account_id: profile?.account_id ?? '' },
    })
    if (!flow) return NextResponse.json({ error: 'Flow not found' }, { status: 404 })

    const cfg = flow.trigger_config as Record<string, unknown>
    if (!Array.isArray(cfg?.screens) || (cfg.screens as unknown[]).length === 0) {
      return NextResponse.json({ error: 'No screens in trigger_config' }, { status: 400 })
    }

    const { screens: metaScreens, hasDynamicData } = transformScreensForMeta(cfg.screens as InternalScreen[])
    const routingModel: Record<string, string[]> = {}
    for (const screen of metaScreens) {
      const sid = (screen as Record<string, unknown>).id as string
      const raw = ((screen as Record<string, unknown>).layout as Record<string, unknown>)?.children as Record<string, unknown>[] ?? []
      const flat = flattenLayoutChildren(raw)
      routingModel[sid] = flat
        .filter((c) => (c['on-click-action'] as Record<string, unknown>)?.name === 'navigate')
        .map((c) => ((c['on-click-action'] as Record<string, unknown>).next as Record<string, unknown>)?.name as string)
        .filter(Boolean)
    }
    const finalScreens = metaScreens.map((screen) => {
      const s = screen as Record<string, unknown>
      const flat = flattenLayoutChildren(((s.layout as Record<string, unknown>)?.children ?? []) as Record<string, unknown>[])
      return flat.some((c) => (c['on-click-action'] as Record<string, unknown>)?.name === 'complete')
        ? { ...s, terminal: true } : s
    })
    ensureTerminalScreen(finalScreens, routingModel)
    const flowJson = {
      version: '7.3',
      ...(hasDynamicData ? { data_api_version: '3.0' } : {}),
      routing_model: routingModel,
      screens: patchPayloads(finalScreens),
    }
    return NextResponse.json({ hasDynamicData, flowJson })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params

    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const profile = await prisma.profile.findUnique({
      where: { user_id: session.user.id },
      select: { account_id: true },
    })
    if (!profile?.account_id) {
      return NextResponse.json({ error: 'Profile not linked to an account.' }, { status: 403 })
    }

    const flow = await prisma.flow.findFirst({
      where: { id, account_id: profile.account_id },
    })
    if (!flow) {
      return NextResponse.json({ error: 'Flow not found' }, { status: 404 })
    }

    const cfg = flow.trigger_config as Record<string, unknown>

    const config = await prisma.whatsAppConfig.findUnique({
      where: { account_id: profile.account_id },
    })
    if (!config?.waba_id) {
      return NextResponse.json(
        { error: 'WhatsApp not configured or WABA ID missing. Connect in Settings first.' },
        { status: 400 },
      )
    }

    const accessToken = decrypt(config.access_token)

    let metaFlowId = cfg?.meta_flow_id as string | undefined

    if (metaFlowId) {
      // ── Already on Meta: update assets only (skip create) ────────
      const hasScreens = Array.isArray(cfg?.screens) && (cfg.screens as unknown[]).length > 0
      if (hasScreens) {
        const { screens: metaScreens, hasDynamicData } = transformScreensForMeta(cfg.screens as InternalScreen[])
        const routingModel: Record<string, string[]> = {}
        for (const screen of metaScreens) {
          const sid = (screen as Record<string, unknown>).id as string
          const raw = ((screen as Record<string, unknown>).layout as Record<string, unknown>)?.children as Record<string, unknown>[] ?? []
          const flat = flattenLayoutChildren(raw)
          routingModel[sid] = flat
            .filter((c) => (c['on-click-action'] as Record<string, unknown>)?.name === 'navigate')
            .map((c) => ((c['on-click-action'] as Record<string, unknown>).next as Record<string, unknown>)?.name as string)
            .filter(Boolean)
        }
        const finalScreens = metaScreens.map((screen) => {
          const s = screen as Record<string, unknown>
          const flat = flattenLayoutChildren(((s.layout as Record<string, unknown>)?.children ?? []) as Record<string, unknown>[])
          return flat.some((c) => (c['on-click-action'] as Record<string, unknown>)?.name === 'complete')
            ? { ...s, terminal: true } : s
        })
        ensureTerminalScreen(finalScreens, routingModel)
        const ensurePayload = patchPayloads
        const flowJson = JSON.stringify({
          version: '7.3',
          ...(hasDynamicData ? { data_api_version: '3.0' } : {}),
          routing_model: routingModel,
          screens: ensurePayload(finalScreens),
        })
        const formData = new FormData()
        formData.append('file', new Blob([flowJson], { type: 'application/json' }), 'flow.json')
        formData.append('name', 'flow.json')
        formData.append('asset_type', 'FLOW_JSON')
        const assetRes = await fetch(`${META_API_BASE}/${metaFlowId}/assets`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
          body: formData,
        })
        if (!assetRes.ok) {
          const errText = await assetRes.text()
          console.warn('[upload] update assets failed:', errText)
          // Try to extract a readable error
          try {
            const errBody = JSON.parse(errText) as { error?: { message?: string } }
            if (errBody?.error?.message) return NextResponse.json({ error: errBody.error.message }, { status: 502 })
          } catch { /* non-JSON */ }
          return NextResponse.json({ error: `Meta API error: ${assetRes.status}` }, { status: 502 })
        }
      }
      return NextResponse.json({ ok: true, meta_flow_id: metaFlowId, updated: true })
    }

    // ── Step 1: Create the flow on Meta ──────────────────────────
    const createRes = await fetch(`${META_API_BASE}/${config.waba_id}/flows`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: flow.name,
        categories: ['OTHER'],
      }),
    })

    if (!createRes.ok) {
      let errMsg = `Meta API error: ${createRes.status}`
      try {
        const body = await createRes.json()
        if (body?.error?.message) errMsg = body.error.message
      } catch { /* non-JSON */ }
      return NextResponse.json({ error: errMsg }, { status: 502 })
    }

    const createBody = await createRes.json() as { id: string }
    metaFlowId = createBody.id

    // ── Step 2: Upload flow JSON if MetaFlowDefinition exists ────
    const hasScreens = Array.isArray(cfg?.screens) && (cfg.screens as unknown[]).length > 0

    if (hasScreens) {
      const { screens: metaScreens, hasDynamicData } = transformScreensForMeta(cfg.screens as InternalScreen[])

      // Build routing_model: screen → list of screens it navigates to
      // Flatten through Form wrapper when looking for navigate actions.
      const routingModel: Record<string, string[]> = {}
      for (const screen of metaScreens) {
        const sid = (screen as Record<string, unknown>).id as string
        const raw = ((screen as Record<string, unknown>).layout as Record<string, unknown>)?.children as Record<string, unknown>[] ?? []
        const flat = flattenLayoutChildren(raw)
        routingModel[sid] = flat
          .filter((c) => (c['on-click-action'] as Record<string, unknown>)?.name === 'navigate')
          .map((c) => ((c['on-click-action'] as Record<string, unknown>).next as Record<string, unknown>)?.name as string)
          .filter(Boolean)
      }

      // Mark terminal screens (those with a complete action footer)
      const finalScreens = metaScreens.map((screen) => {
        const s = screen as Record<string, unknown>
        const flat = flattenLayoutChildren(((s.layout as Record<string, unknown>)?.children ?? []) as Record<string, unknown>[])
        return flat.some((c) => (c['on-click-action'] as Record<string, unknown>)?.name === 'complete')
          ? { ...s, terminal: true } : s
      })
      ensureTerminalScreen(finalScreens, routingModel)

      const flowJson = JSON.stringify({
        version: '7.3',
        ...(hasDynamicData ? { data_api_version: '3.0' } : {}),
        routing_model: routingModel,
        screens: patchPayloads(finalScreens),
      })

      const formData = new FormData()
      formData.append(
        'file',
        new Blob([flowJson], { type: 'application/json' }),
        'flow.json',
      )
      formData.append('name', 'flow.json')
      formData.append('asset_type', 'FLOW_JSON')

      const assetRes = await fetch(`${META_API_BASE}/${metaFlowId}/assets`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: formData,
      })

      if (!assetRes.ok) {
        // Non-fatal — flow was created, JSON upload failed.
        // The user can edit it on Meta.
        console.warn('[upload] flow JSON asset upload failed:', await assetRes.text())
      }
    }

    // ── Step 3: Save meta_flow_id to DB ──────────────────────────
    const newCfg = { ...cfg, meta_flow_id: metaFlowId }
    await prisma.flow.update({
      where: { id },
      data: {
        flow_type: 'whatsapp_flow',
        trigger_config: newCfg as Prisma.InputJsonValue,
        status: 'draft',
      },
    })

    return NextResponse.json({ ok: true, meta_flow_id: metaFlowId })
  } catch (err) {
    console.error('[POST /api/flows/[id]/upload]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    )
  }
}
