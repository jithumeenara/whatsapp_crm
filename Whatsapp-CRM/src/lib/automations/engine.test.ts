import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tenant isolation on the automation dispatcher (GHSA-63cv-2c49-m5v3).
 *
 * The guard being tested is the first thing `runAutomationsForTrigger`
 * does: a contact id arriving from anywhere must be proved to belong to
 * the account before a single automation is looked up, because the steps
 * that follow write to that contact. Without it, a trigger carrying
 * another tenant's contact id would run this tenant's automations against
 * that tenant's data.
 *
 * These tests used to mock `./admin-client` — the Supabase service-role
 * client the engine was built on. The engine has since moved entirely to
 * Prisma, so the mock stopped intercepting anything and the tests ran
 * against the real database, where ids like "c1" fail as malformed UUIDs
 * before any assertion is reached. They were failing for a reason that
 * had nothing to do with tenant isolation, which is the worst way for a
 * security test to fail: loudly, and about the wrong thing.
 *
 * Mocked at `@/lib/db` now, which is where the engine actually reads.
 */

const h = vi.hoisted(() => ({
  state: {
    /** What the ownership guard's lookup returns. Null = the contact is
     *  not in this account. */
    owned: null as { id: string } | null,
    automations: [] as Record<string, unknown>[],
    steps: [] as Record<string, unknown>[],
    /** Every model.method the engine touched, in order. */
    calls: [] as string[],
    /** The `where` of each contact write, which is the thing under test. */
    contactUpdates: [] as Record<string, unknown>[],
  },
}));

vi.mock("@/lib/db", () => {
  const { state } = h;
  const track = <T>(name: string, value: T) => {
    state.calls.push(name);
    return Promise.resolve(value);
  };

  return {
    prisma: {
      contact: {
        findFirst: () => track("contact.findFirst", state.owned),
        findUnique: () => track("contact.findUnique", state.owned),
        updateMany: (args: { where: Record<string, unknown> }) => {
          state.calls.push("contact.updateMany");
          state.contactUpdates.push(args.where);
          return Promise.resolve({ count: 1 });
        },
      },
      automation: {
        findMany: () => track("automation.findMany", state.automations),
        findUnique: () => track("automation.findUnique", state.automations[0] ?? null),
        update: () => track("automation.update", {}),
      },
      automationStep: {
        findMany: () => track("automationStep.findMany", state.steps),
      },
      automationLog: {
        create: () => track("automationLog.create", { id: "log1" }),
        findUnique: () =>
          track("automationLog.findUnique", { steps_executed: [], status: "success" }),
        update: () => track("automationLog.update", {}),
      },
      automationPendingExecution: {
        create: () => track("automationPendingExecution.create", {}),
        update: () => track("automationPendingExecution.update", {}),
      },
      conversation: {
        findFirst: () => track("conversation.findFirst", null),
        updateMany: () => track("conversation.updateMany", { count: 0 }),
      },
      contactTag: {
        upsert: () => track("contactTag.upsert", {}),
        deleteMany: () => track("contactTag.deleteMany", { count: 0 }),
        count: () => track("contactTag.count", 0),
      },
      profile: {
        findFirst: () => track("profile.findFirst", null),
      },
    },
    // `Prisma` is imported from @prisma/client in the engine, not from
    // here, so nothing else needs standing in for.
  };
});

vi.mock("./meta-send", () => ({
  engineSendText: vi.fn(async () => ({ whatsapp_message_id: "m1" })),
  engineSendTemplate: vi.fn(async () => ({ whatsapp_message_id: "m1" })),
  engineSendCatalogItem: vi.fn(async () => ({ whatsapp_message_id: "m1" })),
}));

import { runAutomationsForTrigger } from "./engine";

const ACCOUNT = "acct-1";
const CONTACT = "c1";

beforeEach(() => {
  h.state.owned = null;
  h.state.automations = [];
  h.state.steps = [];
  h.state.calls = [];
  h.state.contactUpdates = [];
});

describe("runAutomationsForTrigger — tenant isolation", () => {
  it("refuses to dispatch when the contact is not in the account (GHSA-63cv-2c49-m5v3)", async () => {
    // The ownership lookup finds nothing: the contact belongs to another
    // tenant, or to nobody.
    h.state.owned = null;
    // Loaded so that a guard failure would be unmistakable — this
    // automation writes to the contact.
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    const result = await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "victim-contact-uuid",
      context: { message_text: "manual trigger" },
    });

    expect(result).toEqual({ matched: 0 });
    // Bailed at the guard: the automations were never even looked up, so
    // nothing could have run against the other tenant's contact.
    expect(h.state.calls).toContain("contact.findFirst");
    expect(h.state.calls).not.toContain("automation.findMany");
    expect(h.state.contactUpdates).toHaveLength(0);
  });

  it("proceeds past the guard when the contact belongs to the account", async () => {
    h.state.owned = { id: CONTACT };
    // None matching — this proves only that the guard let us through.
    h.state.automations = [];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: CONTACT,
      context: {},
    });

    expect(h.state.calls).toContain("automation.findMany");
  });

  it("scopes the update_contact_field write to the automation's account", async () => {
    h.state.owned = { id: CONTACT };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: CONTACT,
      context: {},
    });

    expect(h.state.contactUpdates).toHaveLength(1);
    // Both halves matter. The id alone would let a mismatched pair
    // through; the account_id is what makes the write a no-op rather
    // than a cross-tenant edit if the guard is ever bypassed.
    expect(h.state.contactUpdates[0]).toMatchObject({
      id: CONTACT,
      account_id: ACCOUNT,
    });
  });
});

function automationWithUpdateStep() {
  return {
    id: "a1",
    account_id: ACCOUNT,
    user_id: "u1",
    trigger_type: "new_message_received",
    trigger_config: {},
    is_active: true,
  };
}

function updateStep() {
  return {
    id: "s1",
    automation_id: "a1",
    step_type: "update_contact_field",
    position: 0,
    parent_step_id: null,
    step_config: { field: "company", value: "pwned-by-automation" },
  };
}
