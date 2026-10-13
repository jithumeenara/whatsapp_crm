/**
 * The fixed lists a status column may hold.
 *
 * Every writer checks against these, and the database refuses anything
 * else (migration 133) — so "Done", "done " and "completed" can never
 * appear beside "done" and quietly drop out of a count.
 */

export const TASK_STATUSES = ['todo', 'in_progress', 'done', 'cancelled'] as const
export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
export const CONVERSATION_STATUSES = ['open', 'pending', 'closed'] as const

export function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value)
}

/** A value from a flow's configuration, or the default when it is not on the list. */
export function oneOfOr<T extends string>(list: readonly T[], value: unknown, fallback: T): T {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return isOneOf(list, v) ? v : fallback
}
