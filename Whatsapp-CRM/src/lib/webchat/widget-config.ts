/**
 * The part of a widget a visitor's browser may know.
 *
 * Named field by field, like the visitor's view of a message: the
 * allowed-domain list, the AI limit and the account it belongs to stay
 * on the server.
 */

import type { WebChatWidgetRow } from './session'
import { isSafeHttpsUrl } from './public-message'

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

export function publicWidgetConfig(widget: WebChatWidgetRow): PublicWidgetConfig {
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
