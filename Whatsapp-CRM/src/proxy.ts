import { auth } from "@/auth";
import { NextResponse } from "next/server";

export const proxy = auth((req) => {
  const { nextUrl, auth: session } = req;
  const isLoggedIn = !!session?.user;

  const isAuthPage =
    nextUrl.pathname === "/login" ||
    nextUrl.pathname === "/signup" ||
    nextUrl.pathname === "/forgot-password";

  // Auth pages — redirect to dashboard if already logged in.
  if (isLoggedIn && isAuthPage) {
    const url = nextUrl.clone();
    const inviteToken = nextUrl.searchParams.get("invite");
    if (
      inviteToken &&
      (nextUrl.pathname === "/login" || nextUrl.pathname === "/signup")
    ) {
      url.pathname = `/join/${encodeURIComponent(inviteToken)}`;
      url.search = "";
    } else {
      url.pathname = "/dashboard";
      url.search = "";
    }
    return NextResponse.redirect(url);
  }

  // Protected pages — redirect to login if not authenticated.
  const protectedPaths = [
    "/dashboard",
    "/inbox",
    "/contacts",
    "/leads",
    "/follow-ups",
    "/tasks",
    "/segments",
    "/reports",
    "/pipelines",
    "/broadcasts",
    "/automations",
    "/chatbot",
    "/flows",
    "/templates",
    "/data",
    "/files",
    "/settings",
  ];
  if (
    !isLoggedIn &&
    protectedPaths.some((p) => nextUrl.pathname.startsWith(p))
  ) {
    const url = nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // API routes that need auth (not webhooks or invite peeks).
  if (
    !isLoggedIn &&
    nextUrl.pathname.startsWith("/api/whatsapp/") &&
    !nextUrl.pathname.includes("/webhook")
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
