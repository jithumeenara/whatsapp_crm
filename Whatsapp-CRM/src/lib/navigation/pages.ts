/**
 * The pages, as data — no icons, no React.
 *
 * ── Why this is separate from sections.ts ───────────────────────────
 *
 * sections.ts is the menu: the same pages, each carrying a lucide icon,
 * which is a React component. That is exactly right for a sidebar and
 * wrong for everything else, because importing it drags React icons
 * into whatever imports it.
 *
 * The permission layer needs this list — src/lib/auth/page-access.ts
 * decides what somebody may open, and src/lib/auth/account.ts is
 * imported by every API route in the application. Reaching the menu
 * from there would put a set of icon components in the dependency graph
 * of every server route, to answer a question about strings.
 *
 * So the facts live here and sections.ts adds the pictures. One list,
 * still — a page added here appears in the menu and becomes grantable
 * in the same edit, which is the drift this arrangement exists to
 * prevent.
 */

export interface PageMeta {
  href: string
  label: string
  /**
   * Whether somebody below supervisor rank is offered this page when
   * nobody has decided otherwise for them.
   *
   * This is the *default*, and only the default. It used to be the
   * whole of the answer, and it was enforced nowhere: it hid four menu
   * entries and left the addresses open. What an individual may open is
   * now decided per person — see profiles.page_access — and this is
   * what they get until an admin chooses something else.
   */
  agentAllowed?: boolean
}

export interface PageSection {
  label: string
  items: PageMeta[]
}

export const PAGE_SECTIONS: PageSection[] = [
  {
    label: 'CRM',
    items: [
      { href: '/dashboard', label: 'Dashboard', agentAllowed: true },
      { href: '/leads', label: 'Leads', agentAllowed: true },
      { href: '/pipelines', label: 'Pipelines', agentAllowed: false },
      { href: '/contacts', label: 'Contacts', agentAllowed: true },
      { href: '/reports', label: 'Reports', agentAllowed: false },
      { href: '/ads', label: 'Ads', agentAllowed: false },
      { href: '/catalog', label: 'Catalog', agentAllowed: true },
    ],
  },
  {
    label: 'Messaging',
    items: [
      { href: '/inbox', label: 'Inbox', agentAllowed: true },
      { href: '/calls', label: 'Calls', agentAllowed: true },
      { href: '/broadcasts', label: 'Broadcasts', agentAllowed: false },
      { href: '/templates', label: 'Templates', agentAllowed: false },
    ],
  },
  {
    label: 'Automation',
    items: [
      { href: '/automations', label: 'Automations', agentAllowed: false },
      { href: '/chatbot', label: 'Chatbot', agentAllowed: false },
      { href: '/ai-quality', label: 'AI Quality', agentAllowed: true },
      { href: '/flows', label: 'Flows', agentAllowed: false },
    ],
  },
  {
    label: 'Tools',
    items: [
      { href: '/data', label: 'Data Store', agentAllowed: false },
      { href: '/files', label: 'File Manager', agentAllowed: false },
      { href: '/integrations', label: 'Integrations', agentAllowed: false },
      { href: '/social', label: 'Social Media', agentAllowed: false },
    ],
  },
]

/** Every grantable page, flat. */
export const PAGE_ITEMS: PageMeta[] = PAGE_SECTIONS.flatMap((s) => s.items)
