/**
 * "What to work on" for one person's Agent report card, written by code
 * from their own numbers (plan §4.2). The AI layer comes later and is
 * labelled when it does; nothing here guesses.
 *
 * Thresholds keep small numbers quiet: an answer rate from five calls or
 * an on-time share from two follow-ups says little, so it is not judged.
 */

import type { Finding } from '../types'
import type { CallSlot } from '../activity'

export interface CardFacts {
  calls: number
  connected: number
  byHour: CallSlot[]
  onTimePct: number | null
  /** Follow-ups that counted toward onTimePct (due, not skipped). */
  followUpsCounted: number
  firstCallMedian: number | null
  /** Leads that had a first call (the median's sample). */
  firstCallLeads: number
  idle: number
  overdueOpen: number
}

const MIN_CALLS = 20
const MIN_HOUR_CALLS = 5
const MIN_FOLLOW_UPS = 5
const MIN_FIRST_CALLS = 5

const hourText = (h: number) => `${String(h).padStart(2, '0')}:00`
const minutesText = (m: number) => (m < 60 ? `${Math.round(m)} minutes` : m < 1440 ? `${Math.round(m / 6) / 10} hours` : `${Math.round(m / 144) / 10} days`)

/** The hour with the highest answer rate, among hours with enough calls. */
export function bestHour(byHour: CallSlot[]): { hour: number; pct: number; calls: number } | null {
  let best: { hour: number; pct: number; calls: number } | null = null
  byHour.forEach((s, hour) => {
    if (s.calls < MIN_HOUR_CALLS) return
    const pct = Math.round((s.connected / s.calls) * 100)
    if (!best || pct > best.pct || (pct === best.pct && s.calls > best.calls)) best = { hour, pct, calls: s.calls }
  })
  return best
}

export function cardFindings(f: CardFacts): Finding[] {
  const out: Finding[] = []

  if (f.overdueOpen > 0) {
    out.push({
      severity: f.overdueOpen >= 5 ? 'high' : 'medium',
      title: `${f.overdueOpen} follow-up${f.overdueOpen === 1 ? ' is' : 's are'} overdue`,
      evidence: 'Promised call-backs whose time has passed and are still open.',
      suggestion: 'Clear these first: a customer waiting on a promised call cools fastest.',
    })
  }

  if (f.calls >= MIN_CALLS) {
    const rate = Math.round((f.connected / f.calls) * 100)
    if (rate < 40) {
      const best = bestHour(f.byHour)
      out.push({
        severity: 'medium',
        title: `Only ${rate}% of calls were answered`,
        evidence: `${f.connected} of ${f.calls} calls connected.`,
        suggestion: best && best.pct > rate
          ? `Most people picked up around ${hourText(best.hour)} (${best.pct}% of ${best.calls} calls). Move more calls to that hour.`
          : 'Try calling at a different time of day, and send a WhatsApp message before calling.',
      })
    }
  }

  if (f.onTimePct != null && f.followUpsCounted >= MIN_FOLLOW_UPS && f.onTimePct < 70) {
    out.push({
      severity: f.onTimePct < 50 ? 'high' : 'medium',
      title: `${f.onTimePct}% of follow-ups were on time`,
      evidence: `Of ${f.followUpsCounted} follow-ups that were due.`,
      suggestion: 'Start the day from the follow-up list, and set times you can keep.',
    })
  }

  if (f.firstCallMedian != null && f.firstCallLeads >= MIN_FIRST_CALLS && f.firstCallMedian > 60) {
    out.push({
      severity: f.firstCallMedian > 1440 ? 'high' : 'medium',
      title: `New leads waited ${minutesText(f.firstCallMedian)} for a first call`,
      evidence: `The middle value across ${f.firstCallLeads} new leads.`,
      suggestion: 'Call new leads within the hour: the sooner the first call, the more of them are won.',
    })
  }

  if (f.idle > 0) {
    out.push({
      severity: f.idle >= 10 ? 'medium' : 'low',
      title: `${f.idle} open lead${f.idle === 1 ? '' : 's'} not touched for 3 days or more`,
      evidence: 'No call, note, stage change or customer message since.',
      suggestion: 'Call them, or close the ones that are no longer interested so the list stays true.',
    })
  }

  if (!out.length) {
    out.push({ severity: 'good', title: 'Nothing needs attention', evidence: 'No overdue follow-ups, slow first calls or idle leads.', suggestion: 'Keep the same rhythm.' })
  }
  return out
}
