import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { invalidateBusinessCount } from "@/lib/files/legacy-access";
import { isValidE164 } from "@/lib/whatsapp/phone-utils";
import { publicSignupOpen } from "@/lib/auth/signup-policy";
import { claimInvitation, InvitationUnavailableError, plausibleInviteToken } from "@/lib/auth/claim-invitation";

// The same floor as changing a password (/api/auth/password).
const MIN_PASSWORD = 8;
const MAX_NAME_LEN = 120;

const CLOSED_MESSAGE = "Sign-ups are closed on this workspace. Ask your administrator for an invitation link.";
const INVITE_GONE_MESSAGE = "This invitation has already been used or has expired. Ask your administrator for a new link.";

/**
 * POST /api/auth/register
 *
 * Two different things, decided by whether an invitation came with it:
 *
 *  - With one: a login is made INSIDE the inviting account, at the
 *    invitation's role, and the invitation is used up in the same
 *    transaction (src/lib/auth/claim-invitation.ts). No workspace is
 *    created and nobody becomes an owner. This used to create a fresh
 *    owner workspace and leave the invitation live, so one shared link
 *    let any number of strangers make themselves owners on a server whose
 *    sign-ups are closed.
 *  - Without one: only when the server has opened sign-ups
 *    (src/lib/auth/signup-policy.ts), and then the person owns the new,
 *    empty workspace they just made — the only account they can reach.
 *
 * Role and account never come from the body.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const rawEmail = body?.email;
    const password = typeof body?.password === "string" ? body.password : "";
    const fullName = typeof body?.full_name === "string" ? body.full_name.trim().slice(0, MAX_NAME_LEN) : "";
    const phone = body?.phone;
    const invite = body?.invite;
    // Stored trimmed and lowercased, and checked without regard to case:
    // a phone keyboard that capitalised the first letter made Anu@ and
    // anu@ two different people.
    const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";

    const withInvite = plausibleInviteToken(invite);

    // Closed unless this server opens it — see src/lib/auth/signup-policy.ts.
    // Hiding the link would not be enough: this endpoint is reachable
    // directly. An invited team member still gets through.
    if (!withInvite && !publicSignupOpen()) {
      return NextResponse.json({ error: CLOSED_MESSAGE }, { status: 403 });
    }

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    // "<digits>@agent.local" is the login Add Agent makes for a phone
    // number (src/lib/auth/agent-credentials.ts). Somebody registering
    // one could squat a number before the team adds it, or answer the
    // phone-number login's suffix match in place of the real agent.
    if (email.endsWith("@agent.local") || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
    }

    if (password.length < MIN_PASSWORD) {
      return NextResponse.json(
        { error: `Password must be at least ${MIN_PASSWORD} characters` },
        { status: 400 }
      );
    }

    // Optional — the signup form only sends it once a local number has
    // actually been typed, but validate defensively if it did arrive.
    const trimmedPhone = typeof phone === "string" ? phone.trim() : "";
    if (trimmedPhone && !isValidE164(trimmedPhone)) {
      return NextResponse.json(
        { error: "Enter a valid WhatsApp number for the selected country" },
        { status: 400 }
      );
    }

    const existing = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
    if (existing) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      );
    }

    const password_hash = await bcrypt.hash(password, 12);

    // Create the login and its place in an account atomically. With an
    // invitation, claiming it is part of the same transaction: if anything
    // after it fails the invitation is handed back, and if somebody else
    // claimed it first this whole sign-up is undone.
    const result = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: { email, password_hash },
      });

      if (withInvite) {
        // Throws (undoing this transaction) if it is used, expired, or
        // names a different email address.
        const invitation = await claimInvitation(tx, invite, newUser.id, email);
        await tx.profile.create({
          data: {
            user_id: newUser.id,
            full_name: fullName,
            email,
            phone: trimmedPhone || null,
            account_id: invitation.account_id,
            account_role: invitation.role,
          },
        });
        return { user: newUser, joined: true };
      }

      const account = await tx.account.create({
        data: {
          name: fullName || email,
          owner_user_id: newUser.id,
        },
      });

      await tx.profile.create({
        data: {
          user_id: newUser.id,
          full_name: fullName,
          email,
          phone: trimmedPhone || null,
          account_id: account.id,
          account_role: "owner",
        },
      });

      return { user: newUser, joined: false };
    });
    // A new account or member: legacy-file access depends on how many
    // businesses the server has (security review R4a).
    invalidateBusinessCount();

    return NextResponse.json(
      { id: result.user.id, email: result.user.email, joined: result.joined },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof InvitationUnavailableError) {
      return NextResponse.json(
        { error: err.reason === "wrong_email" ? err.message : INVITE_GONE_MESSAGE },
        { status: 403 },
      );
    }
    // Two sign-ups for the same address racing past the check above.
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "P2002") {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }
    console.error("[register]", err);
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}
