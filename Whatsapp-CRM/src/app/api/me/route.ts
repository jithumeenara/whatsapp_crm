import { NextResponse } from "next/server";
import { sanitizeQuickLinks } from "@/lib/navigation/sections";
import { auth } from "@/auth";
import { prisma } from "@/lib/db"
import { pagesFor } from "@/lib/auth/page-access";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = await prisma.profile.findUnique({
    where: { user_id: session.user.id },
    include: {
      account: {
        select: { id: true, name: true, default_currency: true, owner_user_id: true },
      },
      user: { select: { email_verified: true } },
    },
  });

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  // ── One owner, and the row that proves it ────────────────────────
  //
  // accounts.owner_user_id is the fact; profiles.account_role is a copy
  // of it, and a copy can drift. Every route that could create a second
  // owner already refuses to — the member editor sends you to
  // transfer-ownership, invitations reject the role outright, and the
  // transfer demotes the outgoing owner in the same transaction — so
  // drift takes something outside the app: a hand-run UPDATE, a restored
  // backup, a migration written in a hurry.
  //
  // Both directions are repaired here rather than only the first,
  // because the two failures are not equally harmless. A real owner
  // whose row says otherwise is locked out of their own account and
  // will say so. A second row saying "owner" is a silent extra
  // administrator, and nobody reports an account that works.
  let accountRole = profile.account_role;
  const ownsIt = profile.account?.owner_user_id === session.user.id;

  if (ownsIt && accountRole !== "owner") {
    await prisma.profile.update({
      where: { user_id: session.user.id },
      data: { account_role: "owner" },
    });
    accountRole = "owner";
  } else if (!ownsIt && accountRole === "owner") {
    // Demoted to admin, not to agent. They were trusted with everything
    // a moment ago and this is a repair, not a punishment — and admin
    // is where transfer-ownership puts an outgoing owner, so the two
    // paths agree about where somebody lands.
    await prisma.profile.update({
      where: { user_id: session.user.id },
      data: { account_role: "admin" },
    });
    accountRole = "admin";
    console.warn(
      `[me] ${session.user.id} held the owner role in account ${profile.account_id} without owning it — demoted to admin`,
    );
  }

  return NextResponse.json({
    profile: {
      id: profile.id,
      full_name: profile.full_name,
      email: profile.email,
      avatar_url: profile.avatar_url,
      phone: profile.phone,
      phone_verified: profile.phone_verified_at !== null,
      email_verified: profile.user?.email_verified !== null,
      account_id: profile.account_id,
      account_role: accountRole,
      preferred_language: profile.preferred_language,
      // Sanitised on the way out as well as in: a link stored before a
      // page was removed must not reach the dashboard as a dead row.
      quick_links: sanitizeQuickLinks(profile.quick_links),
      quick_links_enabled: profile.quick_links_enabled,
      // Resolved here rather than sent raw. The rules — null means the
      // role default, an owner is never restricted — belong in one
      // place, and a client that had to apply them itself would be a
      // second implementation to keep in step with the server's.
      //
      // This is what the menu is drawn from. It is not what enforces
      // anything: that is (dashboard)/layout.tsx, on the server.
      allowed_pages: [...pagesFor(accountRole, profile.page_access)],
    },
    account: profile.account
      ? {
          id: profile.account.id,
          name: profile.account.name,
          default_currency: profile.account.default_currency,
        }
      : null,
  });
}
