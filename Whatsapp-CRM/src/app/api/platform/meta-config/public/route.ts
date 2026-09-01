import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { loadMetaPlatformConfig } from "@/lib/whatsapp/meta-platform-config"

/**
 * GET /api/platform/meta-config/public
 *
 * Returns only the non-secret half (app_id, config_id) — what the Facebook
 * JS SDK needs client-side to open the Embedded Signup popup. App Secret
 * never leaves the server; this route can't return it even if asked.
 * Requires a logged-in session (not fully public) even though neither
 * value is truly sensitive, matching this app's usual "authed by default"
 * posture.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const config = await loadMetaPlatformConfig()
  if (!config) return NextResponse.json({ configured: false })

  return NextResponse.json({ configured: true, appId: config.appId, configId: config.configId })
}
