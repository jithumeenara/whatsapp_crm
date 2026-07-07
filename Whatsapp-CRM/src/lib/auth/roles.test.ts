import { describe, expect, it } from "vitest";
import {
  ACCOUNT_ROLES,
  type AccountRole,
  canDeleteAccount,
  canEditSettings,
  canManageMembers,
  canSendMessages,
  canTransferOwnership,
  canViewAllLeads,
  canViewOnly,
  hasMinRole,
  isAccountRole,
  roleRank,
} from "./roles";

describe("roleRank", () => {
  it("orders owner > admin > supervisor > agent > viewer", () => {
    expect(roleRank("owner")).toBeGreaterThan(roleRank("admin"));
    expect(roleRank("admin")).toBeGreaterThan(roleRank("supervisor"));
    expect(roleRank("supervisor")).toBeGreaterThan(roleRank("agent"));
    expect(roleRank("agent")).toBeGreaterThan(roleRank("viewer"));
  });

  it("returns correct numeric ranks", () => {
    expect(roleRank("owner")).toBe(5);
    expect(roleRank("admin")).toBe(4);
    expect(roleRank("supervisor")).toBe(3);
    expect(roleRank("agent")).toBe(2);
    expect(roleRank("viewer")).toBe(1);
  });
});

describe("hasMinRole", () => {
  it("returns true when role meets the threshold", () => {
    expect(hasMinRole("owner", "viewer")).toBe(true);
    expect(hasMinRole("admin", "agent")).toBe(true);
    expect(hasMinRole("supervisor", "agent")).toBe(true);
    expect(hasMinRole("agent", "agent")).toBe(true);
  });

  it("returns false when role is below the threshold", () => {
    expect(hasMinRole("viewer", "agent")).toBe(false);
    expect(hasMinRole("agent", "supervisor")).toBe(false);
    expect(hasMinRole("supervisor", "admin")).toBe(false);
    expect(hasMinRole("admin", "owner")).toBe(false);
  });

  it.each<[AccountRole, AccountRole, boolean]>([
    ["owner", "owner", true],
    ["owner", "admin", true],
    ["owner", "supervisor", true],
    ["owner", "agent", true],
    ["owner", "viewer", true],
    ["admin", "owner", false],
    ["admin", "admin", true],
    ["admin", "supervisor", true],
    ["admin", "agent", true],
    ["admin", "viewer", true],
    ["supervisor", "owner", false],
    ["supervisor", "admin", false],
    ["supervisor", "supervisor", true],
    ["supervisor", "agent", true],
    ["supervisor", "viewer", true],
    ["agent", "owner", false],
    ["agent", "admin", false],
    ["agent", "supervisor", false],
    ["agent", "agent", true],
    ["agent", "viewer", true],
    ["viewer", "owner", false],
    ["viewer", "admin", false],
    ["viewer", "supervisor", false],
    ["viewer", "agent", false],
    ["viewer", "viewer", true],
  ])("%s vs min %s → %s", (role, min, expected) => {
    expect(hasMinRole(role, min)).toBe(expected);
  });
});

describe("isAccountRole", () => {
  it("accepts every value in ACCOUNT_ROLES", () => {
    for (const role of ACCOUNT_ROLES) {
      expect(isAccountRole(role)).toBe(true);
    }
  });

  it("rejects garbage / case mismatch / non-strings", () => {
    expect(isAccountRole("Owner")).toBe(false);
    expect(isAccountRole("")).toBe(false);
    expect(isAccountRole(null)).toBe(false);
    expect(isAccountRole(undefined)).toBe(false);
    expect(isAccountRole(123)).toBe(false);
    expect(isAccountRole("superuser")).toBe(false);
  });
});

describe("capability predicates", () => {
  it("canManageMembers: supervisor+ can manage members", () => {
    expect(canManageMembers("owner")).toBe(true);
    expect(canManageMembers("admin")).toBe(true);
    expect(canManageMembers("supervisor")).toBe(true);
    expect(canManageMembers("agent")).toBe(false);
    expect(canManageMembers("viewer")).toBe(false);
  });

  it("canEditSettings: admin+ only", () => {
    expect(canEditSettings("owner")).toBe(true);
    expect(canEditSettings("admin")).toBe(true);
    expect(canEditSettings("supervisor")).toBe(false);
    expect(canEditSettings("agent")).toBe(false);
    expect(canEditSettings("viewer")).toBe(false);
  });

  it("canSendMessages: agent+ only", () => {
    expect(canSendMessages("owner")).toBe(true);
    expect(canSendMessages("admin")).toBe(true);
    expect(canSendMessages("supervisor")).toBe(true);
    expect(canSendMessages("agent")).toBe(true);
    expect(canSendMessages("viewer")).toBe(false);
  });

  it("canViewAllLeads: supervisor+ can see all leads", () => {
    expect(canViewAllLeads("owner")).toBe(true);
    expect(canViewAllLeads("admin")).toBe(true);
    expect(canViewAllLeads("supervisor")).toBe(true);
    expect(canViewAllLeads("agent")).toBe(false);
    expect(canViewAllLeads("viewer")).toBe(false);
  });

  it("canViewOnly: viewer only", () => {
    expect(canViewOnly("owner")).toBe(false);
    expect(canViewOnly("admin")).toBe(false);
    expect(canViewOnly("supervisor")).toBe(false);
    expect(canViewOnly("agent")).toBe(false);
    expect(canViewOnly("viewer")).toBe(true);
  });

  it("canDeleteAccount: owner only", () => {
    expect(canDeleteAccount("owner")).toBe(true);
    expect(canDeleteAccount("admin")).toBe(false);
    expect(canDeleteAccount("supervisor")).toBe(false);
    expect(canDeleteAccount("agent")).toBe(false);
    expect(canDeleteAccount("viewer")).toBe(false);
  });

  it("canTransferOwnership: owner only", () => {
    expect(canTransferOwnership("owner")).toBe(true);
    expect(canTransferOwnership("admin")).toBe(false);
    expect(canTransferOwnership("supervisor")).toBe(false);
    expect(canTransferOwnership("agent")).toBe(false);
    expect(canTransferOwnership("viewer")).toBe(false);
  });
});
