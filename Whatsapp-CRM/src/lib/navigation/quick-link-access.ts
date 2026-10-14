/**
 * Which of somebody's dashboard quick links they may actually see.
 *
 * Pure, so the rule is tested — see quick-link-access.test.ts.
 */

import { pathAllowedBy } from '@/lib/auth/page-access'

export interface QuickLinkLike {
  href: string
  agentAllowed?: boolean
}

export function visibleQuickLinks<T extends QuickLinkLike>(
  items: T[],
  who: { isAgent: boolean; allowedPages?: string[] },
): T[] {
  // The pages chosen for this person, once the server has said. They were
  // ignored here: the role's default decided, so a granted page had no
  // link and a withheld one kept a link the server then refused.
  if (who.allowedPages) {
    const allowed = who.allowedPages
    return items.filter((i) => pathAllowedBy(allowed, i.href))
  }
  // Until then, the same default the server would apply.
  return items.filter((i) => !who.isAgent || i.agentAllowed !== false)
}
