/**
 * Every Google service the CRM can connect, in one list.
 *
 * Settings → Google draws one card per entry; "Connect selected" asks
 * Google for the union of the ticked services' scopes on one consent
 * screen; the callback switches on each service whose scopes were all
 * granted. A new service (Forms, Business Profile…) is a new entry here,
 * plus the feature behind it — nothing else in the connect flow changes.
 *
 * Pure data, no imports: the browser renders the cards from it too.
 */

export type GoogleServiceId =
  | 'sheets'
  | 'drive'
  | 'gmail_send'
  | 'gmail_inbox'
  | 'calendar'
  | 'contacts'
  | 'forms'
  | 'business_profile'

/** How Google classes the permission, said the way the card says it. */
export type ScopeLevel = 'basic' | 'sensitive' | 'restricted'

export interface GoogleService {
  id: GoogleServiceId
  name: string
  /** One line: what connecting it does for the business. */
  summary: string
  /** What it unlocks in the CRM, as short bullets. */
  features: string[]
  scopes: string[]
  level: ScopeLevel
  /** 'available' can be connected now; 'coming' is shown, not connectable. */
  availability: 'available' | 'coming'
  /** Where its features live, for the card's "Open" link. */
  openHref?: string
}

export const BASE_SCOPES = ['openid', 'email'] as const

const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file'

export const GOOGLE_SERVICES: readonly GoogleService[] = [
  {
    id: 'sheets',
    name: 'Google Sheets',
    summary: 'Private sheets as AI knowledge, and Data Store tables in and out of sheets.',
    features: [
      'AI Training → Google Sheet: choose a private sheet, no public link',
      'Data Store table ⋯ → Google Sheet: every new record added as a row',
      'Import a sheet into a table — now or every 15 minutes',
    ],
    scopes: [DRIVE_FILE],
    level: 'basic',
    availability: 'available',
    openHref: '/data',
  },
  {
    id: 'drive',
    name: 'Google Drive',
    summary: 'Choose files from Drive — only the ones you pick, never the whole Drive.',
    features: ['Google Drive file picker in the CRM', 'Attach Drive files to messages (coming next)'],
    scopes: [DRIVE_FILE],
    level: 'basic',
    availability: 'available',
  },
  {
    id: 'gmail_send',
    name: 'Gmail — send only',
    summary: 'Send replies and alerts from the business Gmail address.',
    features: ['Inbox email replies sent from Gmail', 'Lands in Gmail’s Sent folder', 'No access to read mail'],
    scopes: ['https://www.googleapis.com/auth/gmail.send'],
    level: 'sensitive',
    availability: 'coming',
  },
  {
    id: 'gmail_inbox',
    name: 'Gmail — full inbox',
    summary: 'A Gmail mailbox as an Inbox channel: receive, reply, threads and attachments.',
    features: ['New mail arrives in the Inbox', 'Replies keep Gmail’s threads', 'Attachments both ways', 'AI drafts and Improve'],
    scopes: ['https://www.googleapis.com/auth/gmail.modify'],
    level: 'restricted',
    availability: 'coming',
  },
  {
    id: 'calendar',
    name: 'Google Calendar',
    summary: 'The business calendar: AI books appointments, follow-ups appear as events.',
    features: [
      'AI checks free slots and books, with a Google Meet link',
      'Follow-ups and tasks on the calendar with reminders',
      'Changes made in Calendar come back to the CRM',
    ],
    scopes: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.freebusy'],
    level: 'sensitive',
    availability: 'coming',
  },
  {
    id: 'contacts',
    name: 'Google Contacts',
    summary: 'Bring Google contacts into the CRM, matched to the ones already here.',
    features: ['Import with duplicate matching by phone and email', 'Choose which contact groups'],
    scopes: ['https://www.googleapis.com/auth/contacts.readonly'],
    level: 'sensitive',
    availability: 'coming',
  },
  {
    id: 'forms',
    name: 'Google Forms',
    summary: 'Form responses arrive as Data Store records.',
    features: ['Each response becomes a record', 'Alerts and AI see them like any record'],
    scopes: ['https://www.googleapis.com/auth/forms.responses.readonly', DRIVE_FILE],
    level: 'sensitive',
    availability: 'coming',
  },
  {
    id: 'business_profile',
    name: 'Google Business Profile',
    summary: 'Reviews and messages from your Google listing, in the CRM.',
    features: ['New reviews as alerts', 'Reply to reviews from the CRM'],
    scopes: ['https://www.googleapis.com/auth/business.manage'],
    level: 'sensitive',
    availability: 'coming',
  },
]

export const LEVEL_TEXT: Record<ScopeLevel, { label: string; explain: string }> = {
  basic: { label: 'Basic access', explain: 'Only files you pick or the CRM creates.' },
  sensitive: {
    label: 'Sensitive',
    explain: 'Google shows an "unverified app" screen until your Google app is verified. Choose Advanced → Continue.',
  },
  restricted: {
    label: 'Restricted',
    explain:
      'Full mailbox access. Fine for your own business account behind Google’s "unverified app" screen (up to 100 users). A public, verified app would need Google’s paid yearly security assessment.',
  },
}

export function serviceById(id: string): GoogleService | undefined {
  return GOOGLE_SERVICES.find((s) => s.id === id)
}

export function isServiceId(id: unknown): id is GoogleServiceId {
  return typeof id === 'string' && GOOGLE_SERVICES.some((s) => s.id === id)
}

/** Scopes for one consent screen: the base, plus every chosen service's. */
export function scopesFor(ids: readonly GoogleServiceId[]): string[] {
  const out = new Set<string>(BASE_SCOPES)
  for (const id of ids) for (const s of serviceById(id)?.scopes ?? []) out.add(s)
  return [...out]
}

/** Services whose every scope is in the granted list. */
export function servicesGranted(granted: readonly string[]): GoogleServiceId[] {
  const have = new Set(granted)
  return GOOGLE_SERVICES.filter((s) => s.availability === 'available' && s.scopes.every((sc) => have.has(sc))).map((s) => s.id)
}

export type ServiceState = 'connected' | 'missing_permission' | 'off' | 'coming'

/**
 * A card's state: switched on and every scope still granted → connected;
 * switched on but a scope is gone (unticked on consent, or removed in the
 * Google account) → missing permission; otherwise off.
 */
export function serviceState(
  service: GoogleService,
  conn: { connected: boolean; granted_scopes: readonly string[]; enabled_services: readonly string[] } | null,
): ServiceState {
  if (service.availability === 'coming') return 'coming'
  if (!conn?.connected || !conn.enabled_services.includes(service.id)) return 'off'
  const have = new Set(conn.granted_scopes)
  return service.scopes.every((s) => have.has(s)) ? 'connected' : 'missing_permission'
}
