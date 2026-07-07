import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

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
    },
  });

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  // Self-healing: if this user owns the account but their role is wrong, fix it.
  let accountRole = profile.account_role;
  if (profile.account?.owner_user_id === session.user.id && accountRole !== "owner") {
    await prisma.profile.update({
      where: { user_id: session.user.id },
      data: { account_role: "owner" },
    });
    accountRole = "owner";
  }

  return NextResponse.json({
    profile: {
      id: profile.id,
      full_name: profile.full_name,
      email: profile.email,
      avatar_url: profile.avatar_url,
      account_id: profile.account_id,
      account_role: accountRole,
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
