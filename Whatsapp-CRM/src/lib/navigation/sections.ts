/**
 * Every place in this app somebody can go, in one list.
 *
 * It was the sidebar's private array, which was fine while the sidebar
 * was the only thing that needed it. It no longer is: the dashboard's
 * quick links offer a subset of these, and the Profile screen lets
 * somebody choose which. Three copies of "what pages exist" would drift
 * the first time a page was added, and the one that drifted would be a
 * menu offering a page that no longer exists.
 *
 * `agentAllowed` is presentation, not security. Every page enforces its
 * own access; this only decides what is worth showing an agent so they
 * are not offered doors that will not open.
 */

import {
  LayoutDashboard,
  TrendingUp,
  Kanban,
  Users,
  BarChart2,
  Megaphone,
  ShoppingBag,
  MessageSquare,
  Phone,
  Radio,
  FileText,
  Zap,
  Bot,
  Gauge,
  Workflow,
  LayoutGrid,
  HardDrive,
  Plug,
  Globe,
} from 'lucide-react'

export interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  agentAllowed?: boolean
}

export interface NavSection {
  label: string
  items: NavItem[]
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'CRM',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, agentAllowed: true },
      { href: '/leads', label: 'Leads', icon: TrendingUp, agentAllowed: true },
      { href: '/pipelines', label: 'Pipelines', icon: Kanban, agentAllowed: false },
      { href: '/contacts', label: 'Contacts', icon: Users, agentAllowed: true },
      { href: '/reports', label: 'Reports', icon: BarChart2, agentAllowed: false },
      { href: '/ads', label: 'Ads', icon: Megaphone, agentAllowed: false },
      { href: '/catalog', label: 'Catalog', icon: ShoppingBag, agentAllowed: true },
    ],
  },
  {
    label: 'Messaging',
    items: [
      { href: '/inbox', label: 'Inbox', icon: MessageSquare, agentAllowed: true },
      { href: '/calls', label: 'Calls', icon: Phone, agentAllowed: true },
      { href: '/broadcasts', label: 'Broadcasts', icon: Radio, agentAllowed: false },
      { href: '/templates', label: 'Templates', icon: FileText, agentAllowed: false },
    ],
  },
  {
    label: 'Automation',
    items: [
      { href: '/automations', label: 'Automations', icon: Zap, agentAllowed: false },
      { href: '/chatbot', label: 'Chatbot', icon: Bot, agentAllowed: false },
      { href: '/ai-quality', label: 'AI Quality', icon: Gauge, agentAllowed: true },
      { href: '/flows', label: 'Flows', icon: Workflow, agentAllowed: false },
    ],
  },
  {
    label: 'Tools',
    items: [
      { href: '/data', label: 'Data Store', icon: LayoutGrid, agentAllowed: false },
      { href: '/files', label: 'File Manager', icon: HardDrive, agentAllowed: false },
      { href: '/integrations', label: 'Integrations', icon: Plug, agentAllowed: false },
      { href: '/social', label: 'Social Media', icon: Globe, agentAllowed: false },
    ],
  },
]

/** Flattened, for anything that needs to resolve an href back to a
 *  label and icon — a stored quick link, for instance. */
export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items)

export function navItemFor(href: string): NavItem | undefined {
  return NAV_ITEMS.find((i) => i.href === href)
}

/**
 * What somebody sees before they have chosen anything.
 *
 * The four a working day is actually spent in. A default of "nothing"
 * would make the feature look broken to everybody who never opens
 * Settings, which is most people.
 */
export const DEFAULT_QUICK_LINKS = ['/inbox', '/leads', '/contacts', '/broadcasts']

/** Six is the point at which a shortcut list stops being quicker than
 *  the sidebar it shortcuts. */
export const MAX_QUICK_LINKS = 6

/**
 * A link to one Data Store table — "/data/<uuid>".
 *
 * These are not in the catalogue above and cannot be: the tables belong
 * to the account, not to the app, and a different account has different
 * ones. They are what somebody actually wants on a dashboard, though —
 * "Training Registration", not "Data Store" — so the shape is accepted
 * here and the table's existence is checked where it is rendered, by
 * whoever already knows which tables there are.
 *
 * Shape only. A stale id cannot reach another account's data: /data/[id]
 * scopes every read to the caller's account, as it must regardless of
 * what a quick link says.
 */
const DATA_TABLE_HREF = /^\/data\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isDataTableHref(href: string): boolean {
  return DATA_TABLE_HREF.test(href)
}

export function dataTableIdOf(href: string): string | null {
  return isDataTableHref(href) ? href.slice('/data/'.length) : null
}

/** A table as a nav item, so it renders exactly like every other quick
 *  link. Data Store's own icon: it is one drawer of that cupboard. */
export function dataTableNavItem(id: string, name: string): NavItem {
  return { href: `/data/${id}`, label: name, icon: LayoutGrid, agentAllowed: false }
}

/** Keeps only hrefs this app actually has, in the order given, without
 *  duplicates and within the cap. Applied on the way in and on the way
 *  out: a link saved before a page was removed must not render as a
 *  dead row, and a hand-edited request must not store one. */
export function sanitizeQuickLinks(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : []
  const seen = new Set<string>()
  const out: string[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    if (seen.has(entry)) continue
    if (!navItemFor(entry) && !isDataTableHref(entry)) continue
    seen.add(entry)
    out.push(entry)
    if (out.length >= MAX_QUICK_LINKS) break
  }
  return out
}
