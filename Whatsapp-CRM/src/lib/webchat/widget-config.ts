/**
 * The part of a widget a visitor's browser may know.
 *
 * Named field by field, like the visitor's view of a message: the
 * allowed-domain list, the AI limit and the account it belongs to stay
 * on the server.
 */

import type { WebChatWidgetRow } from './session'
import { isSafeHttpsUrl } from './public-message'
import { publicContactMenu } from './contact-menu'

export interface PublicWidgetConfig {
  key: string
  title: string
  welcome_message: string
  primary_color: string
  position: 'left' | 'right'
  logo_url: string | null
  allow_handoff: boolean
}

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
}

/** Only the columns the visitor's config is built from. */
type ConfigFields = Pick<
  WebChatWidgetRow,
  'public_key' | 'title' | 'welcome_message' | 'primary_color' | 'position' | 'logo_url' | 'allow_handoff'
>

export function publicWidgetConfig<W extends ConfigFields>(widget: W): PublicWidgetConfig {
  return {
    key: widget.public_key,
    title: widget.title,
    welcome_message: widget.welcome_message,
    primary_color: isHexColor(widget.primary_color) ? widget.primary_color : '#4f46e5',
    position: widget.position === 'left' ? 'left' : 'right',
    logo_url: isSafeHttpsUrl(widget.logo_url) ? widget.logo_url : null,
    allow_handoff: widget.allow_handoff,
  }
}

// ── Brand style and button animation (migration 134) ─────────────────

export const LAUNCHER_ANIMATIONS = ['none', 'pulse', 'bounce', 'wiggle', 'float', 'glow'] as const
export type LauncherAnimation = (typeof LAUNCHER_ANIMATIONS)[number]

export interface PublicWidgetStyle {
  color_style: 'solid' | 'gradient'
  /** The gradient's second colour; null = a darker shade of the primary. */
  secondary_color: string | null
  launcher_animation: LauncherAnimation
}

export function isLauncherAnimation(value: unknown): value is LauncherAnimation {
  return typeof value === 'string' && (LAUNCHER_ANIMATIONS as readonly string[]).includes(value)
}

/** Served beside publicWidgetConfig; every value checked again on the way
 *  out, since it ends up in CSS on somebody else's website. */
export function publicWidgetStyle(
  widget: Pick<WebChatWidgetRow, 'color_style' | 'secondary_color' | 'launcher_animation'>,
): PublicWidgetStyle {
  return {
    color_style: widget.color_style === 'solid' ? 'solid' : 'gradient',
    secondary_color: isHexColor(widget.secondary_color) ? widget.secondary_color : null,
    launcher_animation: isLauncherAnimation(widget.launcher_animation) ? widget.launcher_animation : 'none',
  }
}

/** What a visitor's browser receives: config plus style. */
type MenuFields = Pick<WebChatWidgetRow, 'contact_menu_enabled' | 'whatsapp_links' | 'call_links' | 'whatsapp_prefill'>

export function publicWidget(
  widget: ConfigFields & Pick<WebChatWidgetRow, 'color_style' | 'secondary_color' | 'launcher_animation'> & Partial<MenuFields>,
) {
  return {
    ...publicWidgetConfig(widget),
    ...publicWidgetStyle(widget),
    // WhatsApp / Call / bot on the button; null = the button opens the chat.
    contact_menu: publicContactMenu({
      contact_menu_enabled: widget.contact_menu_enabled ?? false,
      whatsapp_links: widget.whatsapp_links ?? [],
      call_links: widget.call_links ?? [],
      whatsapp_prefill: widget.whatsapp_prefill ?? null,
    }),
  }
}
