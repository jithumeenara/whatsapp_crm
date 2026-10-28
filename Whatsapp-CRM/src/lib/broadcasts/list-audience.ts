/**
 * A "Saved list" audience may name several lists (listIds) — or one, as
 * broadcasts made before that did (listId). Pure, so the count, the send
 * and the stored filter all read the same ids.
 */
export const MAX_LISTS = 20

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The chosen list ids: listIds then listId, uuids only, each once, at most 20. */
export function listIdsOf(a: { listIds?: unknown; listId?: unknown } | null | undefined): string[] {
  const raw = [...(Array.isArray(a?.listIds) ? a.listIds : []), a?.listId]
  const out: string[] = []
  for (const v of raw) {
    if (typeof v !== 'string' || !UUID.test(v)) continue
    const id = v.toLowerCase()
    if (!out.includes(id)) out.push(id)
    if (out.length === MAX_LISTS) break
  }
  return out
}
