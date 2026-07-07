import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { hasMinRole, isAccountRole, type AccountRole } from "./roles";
import { verifyApiKey } from "./api-key";
import { checkRateLimit, RATE_LIMITS, type RateLimitResult } from "@/lib/rate-limit";

// ------------------------------------------------------------
// Errors
// ------------------------------------------------------------

export class UnauthorizedError extends Error {
  readonly status = 401 as const;
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403 as const;
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class TooManyRequestsError extends Error {
  readonly status = 429 as const;
  readonly reset: number;
  readonly limit: number;
  constructor(result: RateLimitResult) {
    super("Rate limit exceeded");
    this.name = "TooManyRequestsError";
    this.reset = result.reset;
    this.limit = result.limit;
  }
}

export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof TooManyRequestsError) {
    const retryAfter = Math.max(1, Math.ceil((err.reset - Date.now()) / 1000));
    return NextResponse.json(
      { error: err.message, retry_after_seconds: retryAfter },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "X-RateLimit-Limit": String(err.limit),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil(err.reset / 1000)),
        },
      },
    );
  }
  if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  // Prisma throws P2023 when a value cannot be parsed as a UUID.
  // Return 400 so clients get a meaningful error instead of a generic 500.
  if (
    err instanceof Error &&
    'code' in err &&
    (err as { code: string }).code === 'P2023'
  ) {
    return NextResponse.json({ error: "Invalid ID format" }, { status: 400 });
  }
  console.error("[toErrorResponse] uncategorized error:", err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

// ------------------------------------------------------------
// Profile cache — avoids a DB round-trip on every authenticated request
// ------------------------------------------------------------

type CachedProfile = {
  account_id: string
  account_role: string
  account: { id: string; name: string }
  expiresAt: number
}

const profileCache = new Map<string, CachedProfile>()
const PROFILE_CACHE_TTL_MS = 60_000 // 60 seconds

function getCachedProfile(userId: string): CachedProfile | null {
  const entry = profileCache.get(userId)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    profileCache.delete(userId)
    return null
  }
  return entry
}

function setCachedProfile(userId: string, profile: Omit<CachedProfile, 'expiresAt'>) {
  profileCache.set(userId, { ...profile, expiresAt: Date.now() + PROFILE_CACHE_TTL_MS })
}

// ------------------------------------------------------------
// Account context
// ------------------------------------------------------------

export interface AccountContext {
  /** Prisma client */
  db: typeof prisma;
  /** The current user's ID */
  userId: string;
  /** Caller's account_id from their profile row. */
  accountId: string;
  /** Caller's role within their account. */
  role: AccountRole;
  /** Lightweight account meta — id + name. */
  account: { id: string; name: string };
}

export async function getCurrentAccount(): Promise<AccountContext> {
  const session = await auth();

  if (!session?.user?.id) {
    throw new UnauthorizedError();
  }

  const userId = session.user.id;

  // Use cached profile to avoid a DB round-trip on every request
  let cached = getCachedProfile(userId)
  if (!cached) {
    const profile = await prisma.profile.findUnique({
      where: { user_id: userId },
      include: { account: { select: { id: true, name: true } } },
    });

    if (!profile || !profile.account_id || !profile.account_role) {
      throw new ForbiddenError("Profile is not linked to an account");
    }
    if (!isAccountRole(profile.account_role)) {
      throw new ForbiddenError(`Unknown account role: ${profile.account_role}`);
    }
    if (!profile.account) {
      throw new ForbiddenError("Account record not found — contact support");
    }

    setCachedProfile(userId, {
      account_id: profile.account_id,
      account_role: profile.account_role,
      account: { id: profile.account.id, name: profile.account.name },
    })
    cached = getCachedProfile(userId)!
  }

  return {
    db: prisma,
    userId,
    accountId: cached.account_id,
    role: cached.account_role as AccountRole,
    account: cached.account,
  };
}

export async function requireRole(min: AccountRole): Promise<AccountContext> {
  const ctx = await getCurrentAccount();
  if (!hasMinRole(ctx.role, min)) {
    throw new ForbiddenError(
      `This action requires the '${min}' role or higher`
    );
  }
  return ctx;
}

/**
 * Like requireRole but also accepts a Bearer API key (wcrm_…).
 * API keys are treated as supervisor-level: can read/write all data
 * but cannot touch account settings (admin+).
 * Rate-limited: 120 reads / 60 writes per minute per key.
 */
export async function requireRoleOrApiKey(
  req: Request,
  min: AccountRole,
): Promise<AccountContext> {
  const authHeader = req.headers.get("authorization") ?? "";

  if (authHeader.startsWith("Bearer wcrm_")) {
    const raw = authHeader.slice("Bearer ".length);

    // Rate-limit by key prefix before hitting the DB
    const keyPrefix = raw.slice(0, 12);
    const isWrite = req.method !== "GET";
    const rlResult = checkRateLimit(
      `api:${keyPrefix}`,
      isWrite ? RATE_LIMITS.apiWrite : RATE_LIMITS.apiRead,
    );
    if (!rlResult.success) throw new TooManyRequestsError(rlResult);

    const result = await verifyApiKey(raw);
    if (!result) throw new UnauthorizedError("Invalid API key.");

    // API keys act as supervisor — can read/write but not admin settings
    const apiRole: AccountRole = "supervisor";
    if (!hasMinRole(apiRole, min)) {
      throw new ForbiddenError(
        `This action requires the '${min}' role or higher — API keys have supervisor-level access.`,
      );
    }

    // Use the account's earliest profile as the system userId for DB writes
    const profile = await prisma.profile.findFirst({
      where: { account_id: result.accountId },
      orderBy: { created_at: "asc" },
      include: { account: { select: { id: true, name: true } } },
    });
    if (!profile?.account) throw new ForbiddenError("Account not found.");

    return {
      db: prisma,
      userId: profile.user_id,
      accountId: result.accountId,
      role: apiRole,
      account: { id: profile.account.id, name: profile.account.name },
    };
  }

  return requireRole(min);
}
