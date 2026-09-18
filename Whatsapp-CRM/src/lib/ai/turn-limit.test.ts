import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * What a customer hears once the assistant has used up its turns.
 *
 * From a live server log. Two conversations had reached the limit, and
 * every message after it produced a log line, a fresh note on the
 * thread, and nothing whatsoever to the person who had written — one of
 * them seven times over. Silence is the one outcome the limit was never
 * meant to produce: it exists to stop a bot going in circles, not to
 * stop the business answering.
 *
 * Two rules, and they pull in opposite directions, which is why both are
 * pinned here: say something to the customer, and say it once.
 */

const h = vi.hoisted(() => ({
  state: {
    config: null as Record<string, unknown> | null,
    conversation: { assigned_agent_id: null as string | null, status: "open" },
    /** Rows `message.findFirst` should answer with, keyed by the shape of
     *  the query — see the mock below. */
    priorNote: null as Record<string, unknown> | null,
    priorSameText: null as Record<string, unknown> | null,
    lastHumanReply: null as { created_at: Date } | null,
    botReplies: [] as Array<{ created_at: Date }>,
    sentText: [] as string[],
    notes: [] as string[],
    conversationUpdates: 0,
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    aiConfig: { findUnique: () => Promise.resolve(h.state.config) },
    conversation: {
      findFirst: () => Promise.resolve(h.state.conversation),
      update: () => {
        h.state.conversationUpdates += 1;
        return Promise.resolve({});
      },
    },
    message: {
      findFirst: (args: { where: Record<string, unknown> }) => {
        // Three different questions go through findFirst. They are told
        // apart by what they filter on, which is exactly how the code
        // distinguishes them too.
        if (args.where.sender_type === "agent") return Promise.resolve(h.state.lastHumanReply);
        if (args.where.sender_type === "system") return Promise.resolve(h.state.priorNote);
        return Promise.resolve(h.state.priorSameText);
      },
      findMany: () => Promise.resolve(h.state.botReplies),
      create: (args: { data: { content_text: string } }) => {
        h.state.notes.push(args.data.content_text);
        return Promise.resolve({ id: "n1" });
      },
      count: () => Promise.resolve(0),
      updateMany: () => Promise.resolve({ count: 0 }),
    },
    contact: { findUnique: () => Promise.resolve(null) },
  },
}));

vi.mock("@/lib/socket", () => ({ emitToAccount: () => {} }));

vi.mock("@/lib/flows/meta-send", () => ({
  engineSendText: (a: { text: string }) => {
    h.state.sentText.push(a.text);
    return Promise.resolve({ whatsapp_message_id: "wamid.1" });
  },
  engineSendVoiceNote: () => Promise.resolve({ whatsapp_message_id: "wamid.2" }),
}));

// Nothing below the guard should run at all; if the turn limit ever stops
// short-circuiting, these make it obvious rather than mysterious.
vi.mock("./customer-pipeline", () => ({
  runCustomerTurn: () => {
    throw new Error("the model must not be called once the turn limit is reached");
  },
  formatTurnTimings: () => "",
}));

vi.mock("./handoff-alert", () => ({ sendHandoffAlert: () => Promise.resolve({}) }));
vi.mock("./usage", () => ({ recordAiUsage: () => Promise.resolve() }));
vi.mock("./speech", () => ({ speak: () => Promise.reject(new Error("no")) }));
vi.mock("./providers/registry", () => ({ getProviderKeys: () => ({}) }));
vi.mock("@/lib/whatsapp/encryption", () => ({ decrypt: (v: string) => v }));

import { autoReplyToMessage } from "./auto-reply";

const INPUT = {
  accountId: "acct-1",
  userId: "user-1",
  conversationId: "conv-1",
  contactId: "contact-1",
  message: "Is anyone there?",
  channel: "whatsapp",
};

beforeEach(() => {
  h.state.config = {
    id: "ai-1",
    ai_auto_reply_enabled: true,
    ai_auto_reply_channels: ["whatsapp"],
    ai_auto_reply_pause_on_agent: true,
    ai_auto_reply_max_turns: 2,
    history_depth_default: 6,
    low_confidence_message: null,
    low_confidence_assign_to: null,
    active_provider: "gemini",
  };
  h.state.conversation = { assigned_agent_id: null, status: "open" };
  h.state.priorNote = null;
  h.state.priorSameText = null;
  h.state.lastHumanReply = null;
  // Two already sent, against a limit of two.
  h.state.botReplies = [{ created_at: new Date() }, { created_at: new Date() }];
  h.state.sentText = [];
  h.state.notes = [];
  h.state.conversationUpdates = 0;
});

describe("the turn limit", () => {
  it("tells the customer something instead of going silent", async () => {
    expect(await autoReplyToMessage(INPUT)).toBe("skipped_turn_limit");
    expect(h.state.sentText).toHaveLength(1);
    expect(h.state.sentText[0]).toContain("team member");
  });

  it("uses the account's own wording when it has one", async () => {
    h.state.config = { ...h.state.config, low_confidence_message: "ഒരു നിമിഷം, ഞങ്ങൾ വിളിക്കാം." };
    await autoReplyToMessage(INPUT);
    expect(h.state.sentText[0]).toBe("ഒരു നിമിഷം, ഞങ്ങൾ വിളിക്കാം.");
  });

  it("leaves one note, not one per message", async () => {
    await autoReplyToMessage(INPUT);
    expect(h.state.notes).toHaveLength(1);
    expect(h.state.notes[0]).toContain("stopped answering");

    // The second message arrives to find that note already there.
    h.state.priorNote = { id: "n1" };
    await autoReplyToMessage(INPUT);
    expect(h.state.notes).toHaveLength(1);
  });

  it("does not repeat the holding line either", async () => {
    h.state.priorNote = { id: "n1" };
    await autoReplyToMessage(INPUT);
    expect(h.state.sentText).toHaveLength(0);
  });

  it("still hands the conversation over on the first message past the limit", async () => {
    await autoReplyToMessage(INPUT);
    expect(h.state.conversationUpdates).toBe(1);
  });

  it("has no limit at all when the cap is switched off", async () => {
    // 0 is what the Chatbot page's switch writes. The model must be
    // reached, which the mock proves by throwing — so this asserts that
    // the guard was not what stopped the turn.
    h.state.config = { ...h.state.config, ai_auto_reply_max_turns: 0 };
    h.state.botReplies = Array.from({ length: 40 }, () => ({ created_at: new Date() }));

    expect(await autoReplyToMessage(INPUT)).toBe("handed_off");
    expect(h.state.notes[0]).toContain("could not generate a reply");
    // And nothing was skipped quietly: no turn-limit note was written.
    expect(h.state.notes.some((n) => n.includes("stopped answering"))).toBe(false);
  });

  it("stays out of a thread a person has taken, without saying anything", async () => {
    // A colleague is already in this conversation. The assistant
    // announcing that it is fetching one would be absurd.
    h.state.conversation = { assigned_agent_id: "agent-1", status: "open" };
    expect(await autoReplyToMessage(INPUT)).toBe("skipped_agent_active");
    expect(h.state.sentText).toHaveLength(0);
    expect(h.state.notes).toHaveLength(0);
  });
});
