import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * What a broadcast is allowed to do to the Inbox.
 *
 * Sending to five hundred people used to open five hundred
 * conversations and lift every one of them to the top of the list. The
 * three customers who had actually asked something were then somewhere
 * below four hundred and ninety-seven people who had been sent an offer
 * and said nothing. The Inbox is a list of things to do, and one
 * campaign could empty it of meaning.
 *
 * Two things have to hold at once, which is why both are pinned here:
 * the send must still be recorded, and it must not disturb anything.
 */

const h = vi.hoisted(() => ({
  state: {
    existingConversation: null as { id: string } | null,
    created: [] as unknown[],
    messages: [] as Array<Record<string, unknown>>,
    conversationUpdates: [] as unknown[],
    events: [] as string[],
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    conversation: {
      findFirst: () => Promise.resolve(h.state.existingConversation),
      create: (args: { data: unknown }) => {
        h.state.created.push(args.data);
        return Promise.resolve({ id: "new-conv" });
      },
      update: (args: { data: unknown }) => {
        h.state.conversationUpdates.push(args.data);
        return Promise.resolve({ id: "conv-1" });
      },
    },
    message: {
      create: (args: { data: Record<string, unknown> }) => {
        h.state.messages.push(args.data);
        return Promise.resolve({ id: "msg-1", ...args.data });
      },
    },
  },
}));

vi.mock("@/lib/socket", () => ({
  emitToAccount: (_a: string, event: string) => {
    h.state.events.push(event);
  },
}));

// The send loop's other dependencies, none of which this function
// touches — stubbed only so the module imports.
vi.mock("@/lib/whatsapp/meta-api", () => ({
  sendTemplateMessage: () => Promise.resolve({}),
  sendMarketingTemplateMessage: () => Promise.resolve({}),
}));
vi.mock("@/lib/whatsapp/encryption", () => ({ decrypt: (v: string) => v }));
vi.mock("@/lib/whatsapp/template-row-guard", () => ({ isMessageTemplate: () => true }));
vi.mock("@/lib/whatsapp/resolve-config", () => ({
  resolveWhatsAppConfig: () => Promise.resolve({}),
  NoWhatsAppConfigError: class extends Error {},
}));

import { recordBroadcastMessage } from "./run-broadcast";

const ARGS = {
  accountId: "acct-1",
  ownerUserId: "user-1",
  broadcastId: "bc-1",
  contactId: "contact-1",
  templateName: "offer_2026",
  renderedBody: "20% off this month",
  whatsappMessageId: "wamid.1",
  whatsappConfigId: "wa-1",
};

beforeEach(() => {
  h.state.existingConversation = { id: "conv-1" };
  h.state.created = [];
  h.state.messages = [];
  h.state.conversationUpdates = [];
  h.state.events = [];
});

describe("a broadcast, by default", () => {
  it("records the message in a thread that already exists", async () => {
    await recordBroadcastMessage({ ...ARGS, showInInbox: false });
    expect(h.state.messages).toHaveLength(1);
    expect(h.state.messages[0].broadcast_id).toBe("bc-1");
    expect(h.state.messages[0].content_text).toBe("20% off this month");
  });

  it("does not reorder the Inbox", async () => {
    // last_message_at is what the Inbox sorts on. Leaving it alone is
    // the whole fix: the thread keeps its place instead of jumping over
    // every customer who is actually waiting.
    await recordBroadcastMessage({ ...ARGS, showInInbox: false });
    expect(h.state.conversationUpdates).toEqual([]);
    expect(h.state.events).toEqual(["message"]);
    expect(h.state.events).not.toContain("conversation");
  });

  it("opens no thread for somebody who has never written in", async () => {
    // These are the five hundred. Their reply is what puts them in the
    // Inbox — the webhook creates the conversation then.
    h.state.existingConversation = null;
    await recordBroadcastMessage({ ...ARGS, showInInbox: false });
    expect(h.state.created).toEqual([]);
    expect(h.state.messages).toEqual([]);
    expect(h.state.events).toEqual([]);
  });
});

describe("a broadcast that asked to be visible", () => {
  it("bumps the thread and tells the Inbox", async () => {
    await recordBroadcastMessage({ ...ARGS, showInInbox: true });
    expect(h.state.conversationUpdates).toHaveLength(1);
    expect(h.state.conversationUpdates[0]).toMatchObject({
      last_message_text: "20% off this month",
    });
    expect(h.state.events).toEqual(["message", "conversation"]);
  });

  it("opens a thread for a new recipient", async () => {
    h.state.existingConversation = null;
    await recordBroadcastMessage({ ...ARGS, showInInbox: true });
    expect(h.state.created).toHaveLength(1);
    expect(h.state.messages).toHaveLength(1);
  });
});

describe("either way", () => {
  it("never throws — the send already happened", async () => {
    h.state.existingConversation = { id: "conv-1" };
    const boom = { ...ARGS, showInInbox: true, renderedBody: "x" };
    // A failure recording the message must not be mistaken for a
    // failure to send, which is what the recipient row records.
    await expect(recordBroadcastMessage(boom)).resolves.toBeUndefined();
  });
});
