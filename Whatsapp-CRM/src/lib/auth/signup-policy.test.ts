import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { accountInvitation: { findFirst } } }));

import { isLiveInvitation, publicSignupOpen } from "./signup-policy";
import { hashInviteToken } from "./invitations";

describe("signup policy", () => {
  beforeEach(() => findFirst.mockReset());
  afterEach(() => vi.unstubAllEnvs());

  it("is closed unless the server opens it", () => {
    vi.stubEnv("NEXT_PUBLIC_ALLOW_SIGNUP", "");
    expect(publicSignupOpen()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_ALLOW_SIGNUP", "yes");
    expect(publicSignupOpen()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_ALLOW_SIGNUP", "true");
    expect(publicSignupOpen()).toBe(true);
  });

  it("lets a live invitation through, looked up by its hash", async () => {
    const token = "a".repeat(43);
    findFirst.mockResolvedValue({ id: "inv-1" });
    await expect(isLiveInvitation(token)).resolves.toBe(true);
    const where = findFirst.mock.calls[0][0].where;
    expect(where.token_hash).toBe(hashInviteToken(token));
    expect(where.accepted_at).toBeNull();
    expect(where.expires_at.gt).toBeInstanceOf(Date);
  });

  it("refuses a used, expired or unknown invitation", async () => {
    findFirst.mockResolvedValue(null);
    await expect(isLiveInvitation("b".repeat(43))).resolves.toBe(false);
  });

  it("refuses anything that is not a plausible token without asking the database", async () => {
    for (const bad of [undefined, null, 42, "", "short", "x".repeat(201)]) {
      await expect(isLiveInvitation(bad)).resolves.toBe(false);
    }
    expect(findFirst).not.toHaveBeenCalled();
  });
});
