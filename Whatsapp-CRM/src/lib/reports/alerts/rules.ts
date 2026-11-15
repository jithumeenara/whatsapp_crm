/**
 * Red alerts, the pure part (phase F3, plan §8: to owners and supervisors):
 * which Performance-guide cards are worth an immediate message, who may
 * get each, and the words. Kept free of next/server (server.ts runs the sweep).
 */

import { hasMinRole, type AccountRole } from '@/lib/auth/roles'
import type { Finding } from '../doc/types'

/** Most alerts one business gets in one sweep. */
export const MAX_ALERTS = 5

/** Red cards with a stable code; the code keys "once per issue per day". */
export function pickAlerts(findings: Finding[]): Array<Finding & { code: string }> {
  return findings.filter((x): x is Finding & { code: string } => x.severity === 'high' && typeof x.code === 'string' && x.code.length > 0).slice(0, MAX_ALERTS)
}

/** Supervisors and above (owners, admins, supervisors); ad money to owners and admins. */
export function mayGetAlert(f: Finding, role: AccountRole | string): boolean {
  return hasMinRole(role as AccountRole, f.money ? 'admin' : 'supervisor')
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export function alertText(f: Finding, link: string): string {
  return [
    `🔴 *Alert: ${clip(f.title, 160)}*`,
    clip(f.evidence, 300),
    `What to do: ${clip(f.suggestion, 300)}`,
    '',
    `Performance guide: ${link}`,
  ].join('\n')
}

/** One line for the utility template, outside WhatsApp's 24-hour window. */
export function alertLine(f: Finding): string {
  return clip(`an alert from your reports: ${f.title}. ${f.suggestion}`.replace(/\s+/g, ' ').trim(), 300)
}
