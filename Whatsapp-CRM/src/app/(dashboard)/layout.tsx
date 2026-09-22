import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DashboardShellV2 } from "@/components/layout-v2/dashboard-shell-v2";
import { getCurrentAccount } from "@/lib/auth/account";
import { canOpenPath, firstAllowedPage } from "@/lib/auth/page-access";

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The one place a withheld page is actually refused.
 *
 * ── Why here and not in the menu ────────────────────────────────────
 *
 * Hiding a link is not a permission. Before this, `agentAllowed` in
 * navigation/sections.ts kept Reports, Pipelines, Broadcasts and Flows
 * out of an agent's sidebar, and its own comment claimed that "every
 * page enforces its own access" — which was true of none of them.
 * Typing the address opened the page, and the data loaded, because the
 * APIs behind it asked only for the `viewer` rank or for nothing beyond
 * being signed in.
 *
 * A permission a user can walk around is worse than none: it is a
 * promise the screen makes and the server does not keep, and an admin
 * who switches a page off has no way to tell the difference.
 *
 * ── Why the layout ──────────────────────────────────────────────────
 *
 * It wraps every dashboard page, runs on the server, and runs again on
 * each navigation — so an admin's change takes effect without anybody
 * signing out, which a value baked into a session token could not do.
 *
 * The proxy would be the other candidate and cannot be: it runs in the
 * edge runtime, where this app's Prisma client does not, so it has no
 * way to read who this member is. What it does instead is hand over the
 * address, which a layout is otherwise not given — see `x-pathname` in
 * src/proxy.ts.
 *
 * ── What this does not do ───────────────────────────────────────────
 *
 * It refuses pages, not data. An API is reachable without ever loading
 * a page, so each one still has to enforce its own minimum role; this
 * closes the door, it does not replace the locks behind it.
 */
export default async function V2DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = (await headers()).get("x-pathname") ?? "";

  // No address means the proxy did not run — a direct render, a
  // prefetch, something unusual. Refusing on a guess would lock people
  // out of pages nobody restricted, so an unknown address is left to
  // the checks behind it rather than blocked here.
  if (pathname) {
    // Unauthenticated is the proxy's job, and it has already run. If
    // there is no account here the page itself will deal with it —
    // failing closed would turn a sign-in redirect into a dead end.
    const ctx = await getCurrentAccount().catch(() => null);

    if (ctx && !canOpenPath(ctx.role, ctx.pageAccess, pathname)) {
      const somewhere = firstAllowedPage(ctx.role, ctx.pageAccess);
      // Somewhere they can actually go, not a fixed address: sending
      // everybody to /dashboard is wrong for the one person whose
      // dashboard was taken away, and would loop. With nothing allowed
      // at all there is nowhere to send them, and /no-access says so
      // plainly instead of bouncing them forever.
      redirect(somewhere ?? "/no-access");
    }
  }

  return <DashboardShellV2>{children}</DashboardShellV2>;
}
