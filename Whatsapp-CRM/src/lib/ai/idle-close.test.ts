import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Which conversations an auto-close is allowed to touch.
 *
 * The closing is trivial; the exclusions are the feature. An auto-close
 * that is slightly too eager does not annoy anybody — it files a
 * customer who was waiting for an answer, silently, and nobody ever
 * finds out. So every rule that keeps a conversation open is pinned
 * here, and the one that closes it gets a single test.
 */

const h = vi.hoisted(() => ({
  state: {
    configs: [] as Array<Record<string, unknown>>,
    /** What the candidate query is allowed to return — the `where` it was
     *  called with is captured so the filters themselves can be asserted. */
    candidates: [] as Array<{ id: string; contact_id: string | null }>,
    candidateWhere: null as Record<string, unknown> | null,
    lastSpeakers: [] as Array<{ conversation_id: string; sender_type: string }>,
    lastCustomer: [] as Array<{ conversation_id: string; at: Date }>,
    closedIds: [] as string[],
    notes: [] as string[],
    sent: [] as Array<{ conversationId: string; text: string }>,
    sendThrows: false,
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    aiConfig: { findMany: () => Promise.resolve(h.state.configs) },
    conversation: {
      findMany: (args: { where: Record<string, unknown> }) => {
        h.state.candidateWhere = args.where;
        return Promise.resolve(h.state.candidates);
      },
      update: (args: { where: { id: string } }) => {
        h.state.closedIds.push(args.where.id);
        return Promise.resolve({});
      },
    },
    message: {
      create: (args: { data: { conversation_id: string; content_text: string } }) => {
        h.state.notes.push(args.data.content_text);
        return Promise.resolve({ id: "n1" });
      },
    },
    // Two raw queries run, in a fixed order: who spoke last, then when
    // the customer last did.
    $queryRaw: (() => {
      let call = 0;
      return () => {
        call += 1;
        const which = call % 2 === 1 ? h.state.lastSpeakers : h.state.lastCustomer;
        return Promise.resolve(which);
      };
    })(),
  },
}));

vi.mock("@prisma/client", () => ({
  Prisma: { sql: () => ({}), join: () => ({}) },
}));

vi.mock("@/lib/socket", () => ({ emitToAccount: () => {} }));

vi.mock("@/lib/flows/meta-send", () => ({
  engineSendText: (a: { conversationId: string; text: string }) => {
    if (h.state.sendThrows) return Promise.reject(new Error("outside the window"));
    h.state.sent.push({ conversationId: a.conversationId, text: a.text });
    return Promise.resolve({ whatsapp_message_id: "wamid.1" });
  },
}));

import { sweepIdleConversations, describeMinutes } from "./idle-close";

const CONFIG = {
  account_id: "acct-1",
  user_id: "user-1",
  idle_close_after_minutes: 1440,
  idle_close_message: null as string | null,
};

beforeEach(() => {
  h.state.configs = [{ ...CONFIG }];
  h.state.candidates = [{ id: "conv-1", contact_id: "contact-1" }];
  h.state.candidateWhere = null;
  h.state.lastSpeakers = [{ conversation_id: "conv-1", sender_type: "bot" }];
  h.state.lastCustomer = [{ conversation_id: "conv-1", at: new Date() }];
  h.state.closedIds = [];
  h.state.notes = [];
  h.state.sent = [];
  h.state.sendThrows = false;
});

describe("what the sweep asks the database for", () => {
  it("never considers a Pending or assigned conversation at all", async () => {
    await sweepIdleConversations();
    const where = h.state.candidateWhere!;
    // Pending is where a handover leaves a conversation: somebody here
    // owes the customer an answer, and it is quiet precisely because
    // that has not happened. Excluded in the query, not afterwards.
    expect(where.status).toBe("open");
    expect(where.assigned_agent_id).toBeNull();
    expect(where.last_message_at).toHaveProperty("lt");
  });

  it("does nothing at all for an account that has not asked for it", async () => {
    h.state.configs = [];
    const result = await sweepIdleConversations();
    expect(result).toEqual({ accountsChecked: 0, closed: 0, messaged: 0 });
    expect(h.state.closedIds).toEqual([]);
  });
});

describe("what it closes", () => {
  it("closes a chat where we spoke last and nobody replied", async () => {
    const result = await sweepIdleConversations();
    expect(result.closed).toBe(1);
    expect(h.state.closedIds).toEqual(["conv-1"]);
  });

  it("leaves a chat where the customer spoke last", async () => {
    // They asked something and got nothing. Closing this files a failure
    // as though it were a finished conversation.
    h.state.lastSpeakers = [{ conversation_id: "conv-1", sender_type: "customer" }];
    expect((await sweepIdleConversations()).closed).toBe(0);
    expect(h.state.closedIds).toEqual([]);
  });

  it("leaves a conversation that has no messages in it", async () => {
    h.state.lastSpeakers = [];
    expect((await sweepIdleConversations()).closed).toBe(0);
  });

  it("says on the thread why it closed, in words a person reads", async () => {
    await sweepIdleConversations();
    expect(h.state.notes[0]).toContain("1 day");
    expect(h.state.notes[0]).toContain("reopens");
  });
});

describe("the last word to the customer", () => {
  it("stays quiet when no message is configured", async () => {
    await sweepIdleConversations();
    expect(h.state.sent).toEqual([]);
  });

  it("sends it while the 24-hour window is still open", async () => {
    h.state.configs = [{ ...CONFIG, idle_close_message: "Closing this for now — write anytime." }];
    await sweepIdleConversations();
    expect(h.state.sent[0].text).toBe("Closing this for now — write anytime.");
  });

  it("does not send it once the window has closed", async () => {
    // Outside 24 hours a free-form message is neither delivered nor
    // rejected, so sending one would look like it had worked.
    h.state.configs = [{ ...CONFIG, idle_close_message: "Bye" }];
    h.state.lastCustomer = [
      { conversation_id: "conv-1", at: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    ];
    await sweepIdleConversations();
    expect(h.state.sent).toEqual([]);
    // And the close still happened — an undeliverable goodbye is not a
    // reason to leave the thread open forever.
    expect(h.state.closedIds).toEqual(["conv-1"]);
  });

  it("still closes when the send fails", async () => {
    h.state.configs = [{ ...CONFIG, idle_close_message: "Bye" }];
    h.state.sendThrows = true;
    expect((await sweepIdleConversations()).closed).toBe(1);
  });
});

describe("describeMinutes", () => {
  it("writes a duration the way somebody would say it", () => {
    expect(describeMinutes(30)).toBe("30 minutes");
    expect(describeMinutes(60)).toBe("1 hour");
    expect(describeMinutes(180)).toBe("3 hours");
    expect(describeMinutes(1440)).toBe("1 day");
    expect(describeMinutes(2880)).toBe("2 days");
    expect(describeMinutes(10080)).toBe("7 days");
  });
});
