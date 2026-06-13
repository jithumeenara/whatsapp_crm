/**
 * Client-side Meta WhatsApp Flow JSON validator.
 * Mirrors Meta's official validation rules (v7.1) so errors surface before uploading.
 *
 * Reference: https://developers.facebook.com/docs/whatsapp/flows/reference/flowjson
 */

import type { MetaFlowDefinition } from './meta-flow-types'

export interface FlowValidationError {
  path: string
  message: string
  severity: 'error' | 'warning'
  line: number
  column: number
}

// ── Mirrors transformScreensForMeta from the upload route ─────────

function sanitizeScreenId(raw: string): string {
  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  return cleaned || 'SCREEN'
}

const OPTIONAL_STRING_FIELDS = new Set([
  'helper-text', 'alt-text', 'left-caption', 'center-caption', 'min-date', 'max-date',
])

function cleanComp(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(raw)) {
    // Strip CRM-internal underscore-prefixed fields — never sent to Meta
    if (key.startsWith('_')) continue
    if (OPTIONAL_STRING_FIELDS.has(key)) {
      if (val === '' || val === null || val === undefined) continue
      if (key === 'helper-text' && typeof val === 'string') { out[key] = { text: val }; continue }
    }
    out[key] = val
  }
  return out
}

const TEXT_ONLY_TYPES = new Set(['TextHeading', 'TextSubheading', 'TextBody', 'TextCaption', 'Image'])

function toMetaScreens(def: MetaFlowDefinition): Record<string, unknown>[] {
  const idMap: Record<string, string> = {}
  for (const s of def.screens) {
    idMap[s.id] = sanitizeScreenId(s.id)
  }
  return def.screens.map((screen) => {
    const cleanedComps = screen.components.map((comp) => {
      const { id: _id, ...raw } = comp as unknown as Record<string, unknown> & { id: string }
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
        }
      }
      return cleanComp(raw)
    })

    // Mirror the upload route: wrap form elements in a Form component for v7.3
    const isTerminal = screen.terminal === true || screen.id === 'SUCCESS'
    const hasFormElements = cleanedComps.some((c) => !TEXT_ONLY_TYPES.has(String(c.type)))

    // Meta v7.3 requires a Footer on all screens; auto-add to terminal screens
    if (isTerminal && !cleanedComps.some((c) => c.type === 'Footer')) {
      cleanedComps.push({ type: 'Footer', label: 'Done', 'on-click-action': { name: 'complete', payload: {} } })
    }

    const layoutChildren = (!isTerminal && hasFormElements)
      ? [{ type: 'Form', name: 'flow_path', children: cleanedComps }]
      : cleanedComps

    return {
      id: idMap[screen.id],
      title: screen.title,
      terminal: screen.terminal,
      layout: { type: 'SingleColumnLayout', children: layoutChildren },
    }
  })
}

// ── Per-component allowed property sets (Meta v7.3 spec) ─────────

const COMMON_PROPS = new Set(['type', 'visible', 'enabled'])

const ALLOWED_PROPS: Record<string, Set<string>> = {
  // v7.3 Form wrapper
  Form:              new Set(['type', 'name', 'children', 'error-messages', 'init-values']),
  TextHeading:       new Set([...COMMON_PROPS, 'text']),
  TextSubheading:    new Set([...COMMON_PROPS, 'text']),
  TextBody:          new Set([...COMMON_PROPS, 'text', 'font-weight', 'strikethrough']),
  TextCaption:       new Set([...COMMON_PROPS, 'text', 'font-weight', 'strikethrough']),
  TextInput:         new Set([...COMMON_PROPS, 'name', 'label', 'input-type', 'required', 'min-chars', 'max-chars', 'helper-text', 'init-value', 'pattern', 'error-message']),
  TextArea:          new Set([...COMMON_PROPS, 'name', 'label', 'required', 'max-length', 'helper-text', 'init-value']),
  RadioButtonsGroup: new Set([...COMMON_PROPS, 'name', 'label', 'data-source', 'required', 'init-value', 'on-select-action']),
  CheckboxGroup:     new Set([...COMMON_PROPS, 'name', 'label', 'data-source', 'required', 'min-selected-items', 'max-selected-items', 'init-values', 'on-select-action']),
  Dropdown:          new Set([...COMMON_PROPS, 'name', 'label', 'data-source', 'required', 'helper-text', 'init-value', 'on-select-action']),
  DatePicker:        new Set([...COMMON_PROPS, 'name', 'label', 'min-date', 'max-date', 'unavailable-dates', 'helper-text', 'required', 'init-value', 'error-message']),
  Footer:            new Set([...COMMON_PROPS, 'label', 'left-caption', 'center-caption', 'right-caption', 'on-click-action']),
  Image:             new Set([...COMMON_PROPS, 'src', 'width', 'height', 'scale-type', 'aspect-ratio', 'alt-text']),
}

// ── Column finder ─────────────────────────────────────────────────

function findColumn(json: string, pathParts: string[]): number {
  let pos = 0
  let slice = json

  for (const part of pathParts) {
    const arrIdx = parseInt(part, 10)
    if (!isNaN(arrIdx)) {
      let count = -1
      let depth = 0
      let found = -1
      for (let i = 0; i < slice.length; i++) {
        const ch = slice[i]
        if (ch === '[') depth++
        else if (ch === ']') depth--
        else if (ch === '{' && depth === 1) {
          count++
          if (count === arrIdx) { found = i; break }
        }
      }
      if (found < 0) return pos + 1
      pos += found
      slice = slice.slice(found)
    } else {
      const key = `"${part}":`
      const idx = slice.indexOf(key)
      if (idx < 0) return pos + 1
      pos += idx + key.length
      slice = slice.slice(idx + key.length)
    }
  }
  return pos + 1
}

function pathParts(path: string): string[] {
  return path.split(/[.[\]]/).filter(Boolean)
}

// ── Validator ─────────────────────────────────────────────────────

export function validateMetaFlow(def: MetaFlowDefinition): FlowValidationError[] {
  const errors: FlowValidationError[] = []

  if (!def.screens || def.screens.length === 0) {
    errors.push({ path: 'screens', message: 'At least one screen is required.', severity: 'error', line: 1, column: 1 })
    return errors
  }

  const metaScreens = toMetaScreens(def)
  const json = JSON.stringify({ version: '7.3', screens: metaScreens })

  function err(path: string, message: string, severity: FlowValidationError['severity'] = 'error') {
    errors.push({ path, message, severity, line: 1, column: findColumn(json, pathParts(path)) })
  }

  const allScreenIds = new Set(metaScreens.map((s) => (s as Record<string, unknown>).id as string))
  const seenScreenIds = new Set<string>()

  metaScreens.forEach((screen, i) => {
    const s = screen as Record<string, unknown>
    const prefix = `screens[${i}]`

    // ── Screen ID ──────────────────────────────────────────────────
    if (!s.id) {
      err(`${prefix}.id`, "Required property 'id' is missing.")
    } else {
      const sid = s.id as string
      if (!/^[A-Z_]+$/.test(sid)) {
        err(`${prefix}.id`, "Property 'id' should only consist of uppercase letters and underscores.")
      }
      if (seenScreenIds.has(sid)) {
        err(`${prefix}.id`, `Duplicate screen ID '${sid}'.`)
      }
      seenScreenIds.add(sid)
    }

    if (!s.title) err(`${prefix}.title`, "Required property 'title' is missing.")

    // ── Layout ─────────────────────────────────────────────────────
    if (!s.layout) { err(prefix, "Required property 'layout' is missing."); return }

    const layout = s.layout as Record<string, unknown>
    if (layout.type !== 'SingleColumnLayout') {
      err(`${prefix}.layout.type`, "layout.type must be 'SingleColumnLayout'.")
    }
    if (!Array.isArray(layout.children)) {
      err(`${prefix}.layout`, "Required property 'children' is missing from layout."); return
    }

    const rawChildren = layout.children as Record<string, unknown>[]
    if (rawChildren.length === 0) err(`${prefix}.layout.children`, 'Screen must have at least one component.')

    // Unwrap Form wrapper to get the actual components for validation
    // (Form is injected by the upload transformer, not stored in trigger_config)
    const firstChild = rawChildren[0] as Record<string, unknown>
    const children: Record<string, unknown>[] = (firstChild?.type === 'Form')
      ? (firstChild.children as Record<string, unknown>[]) ?? []
      : rawChildren

    // Meta v7.3 requires a Footer on ALL screens (including terminal).
    // Terminal screens auto-get a 'complete' Footer during upload transform.
    const footerCount = children.filter((c) => c.type === 'Footer').length
    const isTerminal = s.terminal === true || (s.id as string) === 'SUCCESS'
    if (footerCount === 0 && !isTerminal) {
      // Only warn for non-terminal screens in the builder — terminal screens
      // get a Footer auto-injected at upload time.
      err(`${prefix}.layout.children`, 'Screen is missing a Footer (button) component.')
    } else if (footerCount > 1) {
      err(`${prefix}.layout.children`, 'Screen has more than one Footer component.', 'warning')
    }

    const fieldNames = new Set<string>()

    children.forEach((comp, j) => {
      const cPrefix = `${prefix}.layout.children[${j}]`
      const compType = comp.type as string | undefined

      if (!compType) { err(`${cPrefix}.type`, "Required property 'type' is missing."); return }

      // ── Unknown property check ────────────────────────────────
      const allowed = ALLOWED_PROPS[compType]
      if (allowed) {
        for (const key of Object.keys(comp)) {
          if (!allowed.has(key)) {
            err(`${cPrefix}.${key}`, `Property '${key}' is not allowed in '${compType}' component.`)
          }
        }
      } else {
        err(`${cPrefix}.type`, `Unknown component type '${compType}'.`, 'warning')
      }

      // ── Per-type required fields ──────────────────────────────
      switch (compType) {
        case 'TextInput':
        case 'TextArea':
        case 'DatePicker':
          if (!comp.label) err(`${cPrefix}.label`, `'label' is required for ${compType}.`)
          if (!comp.name) {
            err(`${cPrefix}.name`, `'name' is required for ${compType}.`)
          } else {
            if (fieldNames.has(comp.name as string)) err(`${cPrefix}.name`, `Duplicate field name '${comp.name}'.`)
            fieldNames.add(comp.name as string)
          }
          break

        case 'RadioButtonsGroup':
        case 'CheckboxGroup':
        case 'Dropdown': {
          if (!comp.label) err(`${cPrefix}.label`, `'label' is required for ${compType}.`)
          if (!comp.name) {
            err(`${cPrefix}.name`, `'name' is required for ${compType}.`)
          } else {
            if (fieldNames.has(comp.name as string)) err(`${cPrefix}.name`, `Duplicate field name '${comp.name}'.`)
            fieldNames.add(comp.name as string)
          }
          // Check raw component for dynamic data source (DB-backed via network request)
          const rawComp = def.screens[i]?.components[j] as unknown as Record<string, unknown> | undefined
          const hasDynamicSource = !!(rawComp?._source_table_id && rawComp._source_field_key)
          // Also treat template-string data-source (e.g. "${data.xxx}") as dynamic
          const dsRaw = comp['data-source']
          const isDynamicTemplate = typeof dsRaw === 'string' && dsRaw.startsWith('${data.')
          if (!hasDynamicSource && !isDynamicTemplate) {
            const ds = dsRaw as unknown[] | undefined
            if (!Array.isArray(ds) || ds.length === 0) {
              err(`${cPrefix}.data-source`, `'data-source' must have at least one option for ${compType}.`)
            } else {
              // Validate each data-source item
              ds.forEach((item, k) => {
                const it = item as Record<string, unknown>
                const iPrefix = `${cPrefix}.data-source[${k}]`
                if (!it.id) err(`${iPrefix}.id`, "'id' is required on each data-source item.")
                if (!it.title) err(`${iPrefix}.title`, "'title' is required on each data-source item.")
              })
            }
          }
          // CheckboxGroup item counts
          if (compType === 'CheckboxGroup') {
            const min = comp['min-selected-items'] as number | undefined
            const max = comp['max-selected-items'] as number | undefined
            if (min !== undefined && max !== undefined && min > max) {
              err(`${cPrefix}.min-selected-items`, 'min-selected-items cannot exceed max-selected-items.', 'warning')
            }
          }
          break
        }

        case 'Footer': {
          if (!comp.label) err(`${cPrefix}.label`, "Footer 'label' is required.")
          const action = comp['on-click-action'] as Record<string, unknown> | undefined
          if (!action) {
            err(`${cPrefix}.on-click-action`, "'on-click-action' is required on Footer.")
          } else if (!['navigate', 'complete', 'data_exchange'].includes(action.name as string)) {
            err(`${cPrefix}.on-click-action.name`, `Invalid action '${action.name}'. Must be navigate, complete, or data_exchange.`)
          } else if (action.name === 'navigate') {
            const next = action.next as Record<string, unknown> | undefined
            if (!next?.name) {
              err(`${cPrefix}.on-click-action.next`, "Navigate action requires 'next.name' (target screen ID).")
            } else if (!allScreenIds.has(next.name as string)) {
              err(`${cPrefix}.on-click-action.next.name`, `Navigate target '${next.name}' is not a defined screen.`, 'warning')
            }
          } else if (action.name === 'complete' || action.name === 'data_exchange') {
            if (action.payload === undefined || action.payload === null) {
              err(`${cPrefix}.on-click-action.payload`, `'payload' is required for '${action.name}' action (use {} if no data).`)
            }
          }
          break
        }

        case 'TextHeading':
        case 'TextSubheading':
        case 'TextBody':
        case 'TextCaption':
          if (!comp.text) err(`${cPrefix}.text`, `'text' should not be empty for ${compType}.`, 'warning')
          break

        case 'Image':
          if (!comp.src) err(`${cPrefix}.src`, "'src' is required for Image.", 'warning')
          break
      }
    })
  })

  return errors
}
