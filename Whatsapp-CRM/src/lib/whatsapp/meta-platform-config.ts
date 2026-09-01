/**
 * Reads the ONE platform-wide Meta App credentials row (Embedded Signup) —
 * shared by /api/platform/meta-config/public (client SDK loader) and
 * /api/whatsapp/embedded-signup (server-side code exchange). Not a route
 * file itself since Next.js route.ts files can only export HTTP method
 * handlers.
 */
import { prisma } from "@/lib/db"
import { decrypt } from "@/lib/whatsapp/encryption"

export async function loadMetaPlatformConfig() {
  const config = await prisma.metaPlatformConfig.findUnique({ where: { id: "singleton" } })
  if (!config) return null
  return { appId: config.app_id, appSecret: decrypt(config.app_secret), configId: config.config_id }
}
