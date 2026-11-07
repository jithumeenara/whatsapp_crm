/**
 * The reasons a lead can be closed with: the business's own list
 * (Settings → Leads → Close reasons), or these defaults until it sets one.
 * Shared by the settings API, which shows them, and the lead PATCH, which
 * accepts only a reason from the list (security review L3), so the Lost
 * reasons report holds the business's reasons and nothing typed in.
 */

export type ReasonItem = { icon: string; label: string }

export const DEFAULT_CLOSE_REASONS: ReasonItem[] = [
  { icon: '🎉', label: 'Converted / Enrolled' }, { icon: '👎', label: 'Not Interested' },
  { icon: '💰', label: 'Budget Issue' }, { icon: '❓', label: 'Wrong Enquiry' },
  { icon: '📋', label: 'Duplicate' }, { icon: '📝', label: 'Other' },
]

/** The labels the close dialog offers for what is stored. */
export function closeReasonLabels(stored: unknown): string[] {
  if (!Array.isArray(stored)) return DEFAULT_CLOSE_REASONS.map((r) => r.label)
  return stored
    .map((v) => (typeof v === 'string' ? v : v && typeof v === 'object' && 'label' in v ? String((v as { label: unknown }).label) : ''))
    .filter(Boolean)
}
