// ============================================================
// Account role helpers — pure, unit-testable, no I/O.
//
// Hierarchy (highest → lowest privilege):
//   owner(5) → admin(4) → supervisor(3) → agent(2) → viewer(1)
//
// Predicates are the single source of truth for "what can this role do?"
// Both API route guards and UI gates call them here.
// ============================================================

export type AccountRole = "owner" | "admin" | "supervisor" | "agent" | "viewer";

/** Ordered list of every valid role, lowest privilege first. */
export const ACCOUNT_ROLES: readonly AccountRole[] = [
  "viewer",
  "agent",
  "supervisor",
  "admin",
  "owner",
] as const;

/**
 * Numeric rank of a role. Higher = more privileged. Mirrors the
 * CASE expression in `is_account_member` so JS/SQL stay aligned.
 */
export function roleRank(role: AccountRole): number {
  switch (role) {
    case "owner":
      return 5;
    case "admin":
      return 4;
    case "supervisor":
      return 3;
    case "agent":
      return 2;
    case "viewer":
      return 1;
  }
}

/**
 * True iff `role` is at least as privileged as `min`. Use this
 * for any "user has at least admin" / "at least agent" checks.
 */
export function hasMinRole(role: AccountRole, min: AccountRole): boolean {
  return roleRank(role) >= roleRank(min);
}

/** Type-narrow an unknown string into a valid `AccountRole`. */
export function isAccountRole(value: unknown): value is AccountRole {
  return (
    typeof value === "string" &&
    (ACCOUNT_ROLES as readonly string[]).includes(value)
  );
}

// ============================================================
// Capability predicates
// ============================================================

/** Owner / admin / supervisor: invite and remove members, change roles. */
export function canManageMembers(role: AccountRole): boolean {
  return hasMinRole(role, "supervisor");
}

/**
 * Owner / admin only: edit account-wide settings (WhatsApp config,
 * API keys, webhooks, AI config, database).
 */
export function canEditSettings(role: AccountRole): boolean {
  return hasMinRole(role, "admin");
}

/**
 * Owner only: WhatsApp Config, API Keys, Webhooks tabs.
 */
export function canEditWhatsAppConfig(role: AccountRole): boolean {
  return role === "owner";
}

/**
 * Owner / admin / supervisor / agent: write operational data — send messages,
 * create contacts, run broadcasts, edit automations.
 * Viewers are read-only.
 */
export function canSendMessages(role: AccountRole): boolean {
  return hasMinRole(role, "agent");
}

/**
 * Owner / admin / supervisor: see all leads across all agents.
 * Agents only see leads assigned to them (or the unassigned pool).
 */
export function canViewAllLeads(role: AccountRole): boolean {
  return hasMinRole(role, "supervisor");
}

/**
 * Viewer: read-only across everything. Provided as a positive
 * predicate so UI gates read naturally.
 */
export function canViewOnly(role: AccountRole): boolean {
  return role === "viewer";
}

/** Owner only: irreversible destructive operations. */
export function canDeleteAccount(role: AccountRole): boolean {
  return role === "owner";
}

/** Owner only: hand the account to another member. */
export function canTransferOwnership(role: AccountRole): boolean {
  return role === "owner";
}
