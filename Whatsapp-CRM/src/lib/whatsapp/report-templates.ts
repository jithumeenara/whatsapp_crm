/**
 * The ready-made report template (phase F5): what the morning brief,
 * scheduled reports and red alerts send outside WhatsApp's 24-hour window
 * (Admin Chat's sendToAdmin fills {{1}} with the person's first name and
 * {{2}} with one line). Purely informational on purpose: Meta re-files
 * templates that read like marketing, and charges utility ones even inside
 * the window since 1 Oct 2026 — so it is used only when a plain message
 * cannot go. Added from Templates → Ready-made, then submitted as usual.
 */

import type { KitDraft } from './template-kit'

export const READY_REPORT_TEMPLATES: KitDraft[] = [
  {
    purpose: 'report_update',
    name: 'team_report_update',
    category: 'Utility',
    language: 'en',
    body: 'Hello {{1}}, here is an update from your CRM: {{2}}. Open the app to see the full report.',
    samples: ['Asha', 'your weekly Lead report for 9 Nov to 15 Nov: 32 leads, 5 won'],
    why: 'Lets scheduled reports, red alerts and the morning brief reach your team when they have not messaged in the last 24 hours.',
    problems: [],
    warnings: [],
  },
  {
    purpose: 'report_update',
    name: 'team_report_update',
    category: 'Utility',
    language: 'ml',
    body: 'നമസ്കാരം {{1}}, നിങ്ങളുടെ CRM-ൽ നിന്നുള്ള വിവരം: {{2}}. മുഴുവൻ റിപ്പോർട്ട് കാണാൻ ആപ്പ് തുറക്കുക.',
    samples: ['ആശ', 'കഴിഞ്ഞ ആഴ്ചയിലെ ലീഡ് റിപ്പോർട്ട്: 32 ലീഡുകൾ, 5 വിജയം'],
    why: 'Scheduled reports, red alerts and the morning brief in Malayalam, outside the 24-hour window.',
    problems: [],
    warnings: [],
  },
]
