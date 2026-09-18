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
    /** Every SQL string the sweep built, so a test can look at it. */
    sql: [] as string[],
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
      return (query: { text?: string }) => {
        call += 1;
        if (query?.text) h.state.sql.push(query.text);
        const which = call % 2 === 1 ? h.state.lastSpeakers : h.state.lastCustomer;
        return Promise.resolve(which);
      };
    })(),
  },
}));

/**
 * A real tagged template, not a stub returning {}.
 *
 * The stub is what let a live bug through: the sweep built
 * `conversation_id IN (...)` with text parameters against a uuid
 * column, Postgres refused it on every tick for days, and every test
 * still passed because the mock never looked at the SQL. It now records
 * it, so the shape of the query is something a test can assert about.
 */
function fragmentOf(value: unknown): string {
  if (value && typeof value === "object" && "text" in value) {
    return String((value as { text: unknown }).text);
  }
  return "?";
}

vi.mock("@prisma/client", () => ({
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      text: strings.raw.reduce(
        (acc: string, part: string, i: number) =>
          acc + part + (i < values.length ? fragmentOf(values[i]) : ""),
        "",
      ),
    }),
    join: (parts: unknown[]) => ({ text: parts.map(fragmentOf).join(", ") }),
  },
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
  h.state.sql = [];
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

describe("the SQL it builds", () => {
  it("casts every conversation id to uuid", async () => {
    // messages.conversation_id is uuid. Passing the ids as plain text
    // parameters made Postgres refuse the query outright — no rows, no
    // closes, and an error log nobody was reading. The cast is the fix,
    // and this is the assertion that would have caught it.
    await sweepIdleConversations();
    expect(h.state.sql).toHaveLength(2);
    for (const text of h.state.sql) {
      expect(text).toContain("::uuid");
      expect(text).toContain("conversation_id IN");
    }
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
