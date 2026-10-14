/**
 * The signed-in person's profile, as the browser keeps it, built from the
 * `/api/me` response.
 *
 * Pure (no React), so what survives the trip from the server to the menu
 * is tested — see profile-from-me.test.ts.
 */

import { isAccountRole } from "@/lib/auth/roles";
import type { Profile } from "./use-auth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function profileFromMe(raw: any): Profile {
  const accountRole = isAccountRole(raw.account_role) ? raw.account_role : null;
  return {
    id: raw.id,
    full_name: raw.full_name,
    email: raw.email,
    avatar_url: raw.avatar_url,
    phone: raw.phone ?? null,
    phone_verified: !!raw.phone_verified,
    email_verified: !!raw.email_verified,
    account_id: raw.account_id,
    account_role: accountRole,
    preferred_language: raw.preferred_language ?? null,
    quick_links: Array.isArray(raw.quick_links) ? raw.quick_links : [],
    quick_links_enabled: raw.quick_links_enabled !== false,
    // The pages this person may open, as the server resolved them. It was
    // left out here, so the menu always fell back to the role's default
    // pages and never showed what an admin chose in Settings → Members.
    // An empty list is a real answer (every page taken away) and is kept;
    // no list at all stays undefined, and the menu waits for one.
    allowed_pages: Array.isArray(raw.allowed_pages)
      ? raw.allowed_pages.filter((p: unknown): p is string => typeof p === "string")
      : undefined,
  };
}
