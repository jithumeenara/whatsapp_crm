// ============================================================
// /api/account
//
//   GET   — current caller's account + role. Any member.
//   PATCH — rename the account.                  Admin+.
// ============================================================

import { NextResponse } from "next/server";
import { audit, auditCtx } from "@/lib/audit";

import {
  requireRole,
  getCurrentAccount,
  toErrorResponse,
} from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { isValidCurrency } from "@/lib/countries";
import { repriceUnpricedCosts } from "@/lib/whatsapp/message-cost";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    return NextResponse.json({
      account: ctx.account,
      role: ctx.role,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const MAX_NAME_LEN = 80;

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:rename:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { name?: unknown; default_currency?: unknown }
      | null;

    const updateData: Record<string, unknown> = {};

    if (body?.name !== undefined) {
      const rawName = body.name;
      if (typeof rawName !== "string") {
        return NextResponse.json(
          { error: "'name' must be a string" },
          { status: 400 },
        );
      }
      const name = rawName.trim();
      if (name.length === 0) {
        return NextResponse.json(
          { error: "Account name cannot be empty" },
          { status: 400 },
        );
      }
      if (name.length > MAX_NAME_LEN) {
        return NextResponse.json(
          { error: `Account name must be ${MAX_NAME_LEN} characters or fewer` },
          { status: 400 },
        );
      }
      updateData.name = name;
    }

    if (body?.default_currency !== undefined) {
      if (typeof body.default_currency !== "string") {
        return NextResponse.json(
          { error: "'default_currency' must be a string" },
          { status: 400 },
        );
      }
      // A real currency from the list, never whatever text was sent: this is
      // what every deal and report prints.
      if (!isValidCurrency(body.default_currency)) {
        return NextResponse.json(
          { error: "Choose a currency from the list." },
          { status: 400 },
        );
      }
      updateData.default_currency = body.default_currency.trim().toUpperCase();
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "Nothing to update" },
        { status: 400 },
      );
    }

    const previous = await prisma.account.findUnique({
      where: { id: ctx.accountId },
      select: { name: true, default_currency: true },
    });
    const currencyChanged =
      typeof updateData.default_currency === "string" &&
      updateData.default_currency !== (previous?.default_currency ?? "").toUpperCase();
    const account = await prisma.account.update({
      where: { id: ctx.accountId },
      data: updateData,
      select: { id: true, name: true, default_currency: true },
    });

    await audit(auditCtx(request, ctx), {
      action: "account.updated",
      target: { type: "account", id: ctx.accountId },
      before: previous ?? null,
      after: updateData,
    });

    // The same follow-through as Settings → Country, currency and report
    // header, so the two ways of changing it cannot behave differently (found
    // in review): note when it changed, and price the WhatsApp costs that had
    // no rate card for the old currency. Neither undoes the save if it fails.
    if (currencyChanged) {
      const now = new Date();
      await prisma.accountReportProfile
        .upsert({
          where: { account_id: ctx.accountId },
          update: { currency_effective_from: now, updated_at: now },
          create: { account_id: ctx.accountId, currency_effective_from: now },
        })
        .catch((e: unknown) => console.error("[account] could not note the currency change date:", e instanceof Error ? e.message : e));
      await repriceUnpricedCosts(ctx.accountId).catch((e: unknown) =>
        console.error("[account] repricing failed:", e instanceof Error ? e.message : e),
      );
    }

    return NextResponse.json({ account });
  } catch (err) {
    return toErrorResponse(err);
  }
}
