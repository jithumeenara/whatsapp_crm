import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { isPublicKeyShape } from '@/lib/webchat/tokens'
import { loadEnabledWidget } from '@/lib/webchat/session'
import { hostOf, isHostAllowed } from '@/lib/webchat/domains'
import { publicWidgetConfig } from '@/lib/webchat/widget-config'
import { WEBCHAT_LIMITS, ipKey, jsonError, limit } from '@/lib/webchat/http'

/**
 * GET /api/webchat/config/:key — public.
 *
 * Read by the install script on the business's own website, so it is the
 * one website-chat route that answers cross-origin. It returns only what
 * the launcher button needs to look right; nothing here is private.
 *
 * A site that is not on the widget's list gets a 403 and no button. That
 * is a courtesy, not the boundary — anything can claim any Origin — the
 * boundary is the chat frame's frame-ancestors, which browsers enforce.
 * It is also where "installed and last seen on" in Settings comes from.
 */

export const dynamic = 'force-dynamic'

function cors(origin: string | null): Record<string, string> {
  return origin
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET' }
    : {}
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: cors(req.headers.get('origin')) })
}

export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const origin = req.headers.get('origin')
  const limited = limit(`config:${ipKey(req)}`, WEBCHAT_LIMITS.configPerIp)
  if (limited) return limited

  const { key } = await params
  if (!isPublicKeyShape(key)) return jsonError(404, 'Chat not found.', cors(origin))
  const widget = await loadEnabledWidget(key)
  if (!widget) return jsonError(404, 'Chat not found.', cors(origin))

  const host = hostOf(origin) ?? hostOf(req.headers.get('referer'))
  if (!isHostAllowed(host, widget.allowed_domains)) {
    return jsonError(403, 'This chat is not enabled for this website.', cors(origin))
  }

  // "Installed" in Settings: at most one write a minute per widget.
  if (host && (!widget.last_seen_at || Date.now() - widget.last_seen_at.getTime() > 60_000)) {
    void prisma.webChatWidget
      .update({ where: { id: widget.id }, data: { last_seen_at: new Date(), last_seen_origin: host.slice(0, 255) } })
      .catch(() => {})
  }

  return NextResponse.json(publicWidgetConfig(widget), {
    headers: { ...cors(origin), 'Cache-Control': 'public, max-age=60' },
  })
}
