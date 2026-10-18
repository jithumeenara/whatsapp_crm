/**
 * The chatbot's "Tag Contact" step: which tag, and add or remove.
 *
 * - No mode saved means "add" — that is what the builder shows. It used
 *   to mean "remove".
 * - The tag is normally its id (the builder's drop-down saves the id). A
 *   name typed in the old text box — "Interested" — is accepted too,
 *   matched without regard to case or spaces.
 * - When there is no such tag, `problem` says so in words for the run log.
 */

export interface TagLite { id: string; name: string }

export function resolveTagStep(
  cfg: { mode?: string; tag_id?: string },
  tags: readonly TagLite[],
): { action: 'add' | 'remove'; tagId: string | null; problem: string | null } {
  const action = cfg.mode === 'remove' ? 'remove' : 'add'
  const raw = (cfg.tag_id ?? '').trim()
  if (!raw) return { action, tagId: null, problem: 'No tag chosen in this step.' }
  const byId = tags.find((t) => t.id === raw)
  if (byId) return { action, tagId: byId.id, problem: null }
  const byName = tags.find((t) => t.name.trim().toLowerCase() === raw.toLowerCase())
  if (byName) return { action, tagId: byName.id, problem: null }
  return { action, tagId: null, problem: `“${raw.slice(0, 60)}” — there is no tag with that name or id. Choose one from the list.` }
}
