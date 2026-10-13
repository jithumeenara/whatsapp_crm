'use client'

/**
 * A Data Store table's fields, for the flow and chatbot builders' pickers.
 * Loading is derived (use-load-for.ts), and the layout-only and file
 * fields a picker cannot use can be left out.
 */

import { useLoadFor } from './use-load-for'

export interface PickerField {
  field_key: string
  label: string
  field_type: string
  [key: string]: unknown
}

const NOT_PICKABLE = ['section_header', 'html_block', 'signature', 'file', 'image']
const NONE: PickerField[] = []

export function useTableFields(tableId: string | null | undefined, opts: { pickableOnly?: boolean } = {}) {
  const pickableOnly = opts.pickableOnly ?? true
  const { data, loading } = useLoadFor<PickerField[]>(
    tableId,
    async (id) => {
      const res = await fetch(`/api/data-tables/${id}`)
      const d = (await res.json()) as { table?: { fields?: PickerField[] } }
      const fields = d.table?.fields ?? []
      return pickableOnly ? fields.filter((f) => !NOT_PICKABLE.includes(f.field_type)) : fields
    },
    NONE,
  )
  return { fields: data, loading }
}
