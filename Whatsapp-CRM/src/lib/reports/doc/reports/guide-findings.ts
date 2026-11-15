/**
 * Performance guide, layer 1 (plan §10): code looks at the numbers and
 * writes "problem → evidence → what to do" cards. No AI here; small
 * numbers never make a trend.
 */

import type { Finding } from '../types'

export interface GuideFacts {
  /** Team guide (supervisors) or someone's own. People cards: team only. */
  team: boolean
  links: { leads: string; agents: string }
  leads: { now: number; before: number | null }
  wonPct: { now: number | null; before: number | null; base: number; prevBase: number }
  sources: Array<{ key: string; label: string; now: number; before: number }>
  /** Stage to stage, with how many leads were at the first stage. */
  steps: Array<{ from: string; to: string; rate: number | null; previousRate: number | null; base: number; prevBase: number }>
  reply: { median: number | null; answered: number; slots: Array<{ label: string; median: number; leads: number }> }
  agents: Array<{ userId: string; name: string; calls: number; connected: number }>
  followUps: { lateNow: number; lateBefore: number | null; overdueOpen: number }
  idle: number
  neverContacted: number
  leakHours: number
}

const MIN_BASE = 10
const MIN_CALLS = 20
const MIN_SLOT = 5
const ORDER: Record<Finding['severity'], number> = { high: 0, medium: 1, low: 2, good: 3 }

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
/** "Saturday evening" from a weekday (0 = Sunday) and an hour, business time. */
export function slotLabel(dow: number, hour: number): string {
  const part = hour >= 6 && hour < 12 ? 'morning' : hour >= 12 && hour < 17 ? 'afternoon' : hour >= 17 && hour < 22 ? 'evening' : 'night'
  return `${DAYS[dow] ?? 'Some day'} ${part}`
}

const waitText = (m: number) => (m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${Math.round(m / 6) / 10} h` : `${Math.round(m / 144) / 10} days`)

export function guideFindings(f: GuideFacts): Finding[] {
  const out: Finding[] = []

  // Leads up or down, and where the change came from.
  if (f.leads.before != null && f.leads.before >= MIN_BASE) {
    const ch = Math.round(((f.leads.now - f.leads.before) / f.leads.before) * 100)
    if (ch <= -15) {
      const delta = f.leads.now - f.leads.before
      const worst = [...f.sources].sort((a, b) => (a.now - a.before) - (b.now - b.before))[0]
      const share = worst && worst.now < worst.before ? Math.round(((worst.now - worst.before) / delta) * 100) : null
      out.push({
        severity: ch <= -30 ? 'high' : 'medium',
        title: `Leads fell ${Math.abs(ch)}%`,
        evidence: `${f.leads.now} now against ${f.leads.before} before.${worst && share != null && share > 0 ? ` ${Math.min(share, 100)}% of the drop is from ${worst.label} (${worst.before} → ${worst.now}).` : ''}`,
        suggestion: worst && share != null && share > 0 ? `Check what changed with ${worst.label}: a paused ad, a broken form, a changed number or link.` : 'Check each source in the Lead report to see which one fell.',
        href: f.links.leads,
        action: worst && share != null && share > 0 ? { label: 'Compare sources', href: `${f.links.leads}&tab=compare&cmp=source&items=${encodeURIComponent(worst.key)}` } : undefined,
      })
    } else if (ch >= 15) {
      out.push({ severity: 'good', title: `Leads rose ${ch}%`, evidence: `${f.leads.now} now against ${f.leads.before} before.`, suggestion: 'Make sure the team keeps up: answer the extra leads quickly.', href: f.links.leads })
    }
  }

  // Won share falling.
  if (f.wonPct.now != null && f.wonPct.before != null && f.wonPct.base >= 20 && f.wonPct.prevBase >= 20 && f.wonPct.before - f.wonPct.now >= 5) {
    out.push({
      severity: f.wonPct.before - f.wonPct.now >= 10 ? 'high' : 'medium',
      title: `Won % fell to ${f.wonPct.now}%`,
      evidence: `It was ${f.wonPct.before}% before.`,
      suggestion: 'Look at the stage where most leads now stop, and at the reasons given for lost leads.',
      href: f.links.leads,
    })
  }

  // The stage that leaks most, compared with before.
  const leak = f.steps
    .filter((s) => s.rate != null && s.previousRate != null && s.base >= MIN_BASE && s.prevBase >= MIN_BASE && s.previousRate - s.rate >= 10)
    .sort((a, b) => (b.previousRate! - b.rate!) - (a.previousRate! - a.rate!))[0]
  if (leak) {
    out.push({
      severity: leak.previousRate! - leak.rate! >= 20 ? 'high' : 'medium',
      title: `${leak.from} → ${leak.to} dropped to ${leak.rate}%`,
      evidence: `It was ${leak.previousRate}% before (${leak.base} leads reached ${leak.from}).`,
      suggestion: `Ask the team what is stopping leads after ${leak.from}: reminders, timing, price or follow-up.`,
      href: f.links.leads,
    })
  }

  // First reply speed, overall and the slowest time slot.
  if (f.reply.median != null && f.reply.answered >= MIN_BASE && f.reply.median > 60) {
    out.push({
      severity: f.reply.median > 240 ? 'high' : 'medium',
      title: `New leads wait ${waitText(f.reply.median)} for a first reply`,
      evidence: `The middle wait across ${f.reply.answered} answered leads.`,
      suggestion: 'Reply within 5 minutes where you can: fast answers win more leads.',
      href: f.links.leads,
    })
  }
  const slow = [...f.reply.slots].filter((s) => s.leads >= MIN_SLOT).sort((a, b) => b.median - a.median)[0]
  if (slow && f.reply.median != null && slow.median > 60 && slow.median >= 2 * Math.max(f.reply.median, 1)) {
    out.push({
      severity: slow.median > 480 ? 'high' : 'medium',
      title: `Leads on ${slow.label} wait ${waitText(slow.median)} for a reply`,
      evidence: `${slow.leads} leads came in then; the usual wait is ${waitText(f.reply.median)}.`,
      suggestion: `Put someone on call for ${slow.label}, or set an automatic first reply for those hours.`,
      href: f.links.leads,
    })
  }

  // Team members far below the team's answer rate (team guide only).
  if (f.team) {
    const counted = f.agents.filter((a) => a.calls >= MIN_CALLS)
    const calls = counted.reduce((x, a) => x + a.calls, 0)
    const avg = calls ? Math.round((counted.reduce((x, a) => x + a.connected, 0) / calls) * 100) : null
    if (avg != null && counted.length >= 2) {
      for (const a of counted
        .map((x) => ({ ...x, rate: Math.round((x.connected / x.calls) * 100) }))
        .filter((x) => x.rate <= avg - 15)
        .sort((x, y) => x.rate - y.rate)
        .slice(0, 3)) {
        out.push({
          severity: 'medium',
          title: `${a.name}: ${a.rate}% of calls answered`,
          evidence: `The team average is ${avg}% (${a.calls} calls).`,
          suggestion: 'Open their report card to see the hours when people pick up, and move calls there.',
          href: f.links.agents,
          action: { label: 'Open report card', href: `${f.links.agents}&member=${encodeURIComponent(a.userId)}` },
        })
      }
    }
  }

  // Follow-ups.
  if (f.followUps.lateBefore != null && f.followUps.lateNow >= 5 && f.followUps.lateNow >= f.followUps.lateBefore * 1.5) {
    out.push({
      severity: f.followUps.lateNow >= 15 ? 'high' : 'medium',
      title: `Late follow-ups rose from ${f.followUps.lateBefore} to ${f.followUps.lateNow}`,
      evidence: 'Follow-ups done late or still not done after their time.',
      suggestion: 'Start each day from the follow-up list, and set times the team can keep.',
      action: { label: 'Open follow-ups', href: '/follow-ups' },
    })
  } else if (f.followUps.overdueOpen >= 10) {
    out.push({
      severity: 'high',
      title: `${f.followUps.overdueOpen} follow-ups are overdue`,
      evidence: 'Promised call-backs whose time has passed.',
      suggestion: 'Clear the oldest first today.',
      action: { label: 'Open follow-ups', href: '/follow-ups' },
    })
  }

  if (f.neverContacted > 0) {
    out.push({
      severity: f.neverContacted >= 10 ? 'high' : f.neverContacted >= 3 ? 'medium' : 'low',
      title: `${f.neverContacted} lead${f.neverContacted === 1 ? ' was' : 's were'} never contacted`,
      evidence: `Older than ${f.leakHours} hours with no call, reply or stage change.`,
      suggestion: f.team ? 'Assign them and call today.' : 'Call them today.',
      action: { label: 'Open leads', href: '/leads' },
    })
  }

  if (f.idle >= 3) {
    out.push({
      severity: f.idle >= 20 ? 'medium' : 'low',
      title: `${f.idle} open leads not touched for 3 days or more`,
      evidence: 'No call, note, stage change or customer message since.',
      suggestion: 'Call them, or close the ones that are no longer interested so the list stays true.',
      action: { label: 'Open leads', href: '/leads' },
    })
  }

  if (!out.length) {
    out.push({ severity: 'good', title: 'Nothing has dropped', evidence: 'No fall in leads, stages, reply speed or follow-ups that the numbers can show.', suggestion: 'Keep the same rhythm.' })
  }
  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity])
}
