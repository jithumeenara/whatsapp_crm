import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * When this month's AI budget is used up (budget.ts), the assistant does
 * not call the model. The customer hears the usual hand-over line once,
 * and the team gets the conversation with a note saying why.
 */

vi.mock("./budget", async (orig) => ({
  ...(await orig<typeof import("./budget")>()),
  aiBudgetState: async () => ({ limitUsd: 10, spentUsd: 10.5, month: "2026-11", ratio: 1.05, over: true }),
}));

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
    throw new Error("the model must not be called once the budget is used up");
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

describe("the monthly AI budget is used up", () => {
  beforeEach(() => {
    // Plenty of turns left: only the budget stops it.
    h.state.config = { ...h.state.config, ai_auto_reply_max_turns: 10 };
    h.state.botReplies = [];
  });

  it("hands over with a note saying why, and tells the customer once", async () => {
    expect(await autoReplyToMessage(INPUT)).toBe("skipped_budget");
    expect(h.state.sentText).toHaveLength(1);
    expect(h.state.notes.some((n) => n.includes("AI budget is used up"))).toBe(true);
    expect(h.state.conversationUpdates).toBe(1);
  });

  it("says nothing again in the same exchange once the note is there", async () => {
    h.state.priorNote = { id: "note-1" };
    expect(await autoReplyToMessage(INPUT)).toBe("skipped_budget");
    expect(h.state.sentText).toHaveLength(0);
    expect(h.state.notes).toHaveLength(0);
  });
});
