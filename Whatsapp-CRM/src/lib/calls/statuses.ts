/**
 * Calls that reached nobody. One list, used by the calls page ("Missed"
 * tab, ?status=missed) and by the dashboard's count, so the tile and the
 * list it opens can never disagree.
 *
 *  - 'missed':   it rang and nobody picked up in time.
 *  - 'rejected': we declined it because the line was busy (call-handler.ts);
 *                the caller still got no answer.
 */
export const MISSED_CALL_STATUSES = ['missed', 'rejected'] as const
