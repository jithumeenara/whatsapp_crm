/**
 * One icon per report, by its key, so the menu reads at a glance. A key
 * this list doesn't know (a report added later) gets the plain chart.
 */

import { createElement } from "react"
import {
  BarChart3, Bot, CalendarClock, HandCoins, Headset, LayoutDashboard, Lightbulb, Megaphone, MessagesSquare, Send, UserPlus, Wallet,
  type LucideIcon,
} from "lucide-react"

const ICONS: Record<string, LucideIcon> = {
  all: LayoutDashboard,
  leads: UserPlus,
  agents: Headset,
  ads: Megaphone,
  conversations: MessagesSquare,
  sales: HandCoins,
  campaigns: Send,
  automation: Bot,
  spending: Wallet,
  guide: Lightbulb,
  scheduled: CalendarClock,
}

export function reportIcon(key: string | null | undefined): LucideIcon {
  return (key && Object.prototype.hasOwnProperty.call(ICONS, key) ? ICONS[key] : undefined) ?? BarChart3
}

/** The report's icon as an element. A stable component, so a screen never
 *  "creates a component during render" by picking the icon itself. */
export function ReportIcon({ reportKey, className }: { reportKey: string | null | undefined; className?: string }) {
  return createElement(reportIcon(reportKey), { className, "aria-hidden": true })
}
