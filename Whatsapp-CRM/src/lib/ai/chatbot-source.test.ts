import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * What a chatbot contributes to the knowledge base, and what it must
 * not.
 *
 * The line being drawn is between what a bot *says* and how it *works*.
 * A customer asking where the campus is should get the address the
 * business already wrote into its Location Guide bot. What they must
 * never get is the plumbing around it — the tag it sets, the variable
 * it saves, the condition it branches on. Those are in the same rows
 * and are equally easy to serialize, which is exactly why this is
 * tested rather than assumed.
 */

const h = vi.hoisted(() => ({ flow: null as Record<string, unknown> | null }));

vi.mock("@/lib/db", () => ({
  prisma: { flow: { findFirst: () => Promise.resolve(h.flow) } },
}));

import { serializeChatbot } from "./chatbot-source";

function node(node_key: string, node_type: string, config: Record<string, unknown>) {
  return { node_key, node_type, config };
}

beforeEach(() => {
  h.flow = {
    name: "Location Guide",
    description: null,
    entry_node_id: "start",
    nodes: [
      node("start", "send_buttons", {
        text: "Which of our centres do you need directions to?",
        buttons: [
          { reply_id: "hq", title: "Head office", next_node_key: "hq" },
          { reply_id: "campus", title: "Training campus", next_node_key: "campus" },
        ],
      }),
      node("hq", "send_message", {
        text: "Head office: ACSTI, Poojappura, Thiruvananthapuram 695012.\n\nOpposite the Central Jail.",
        next_node_key: "tag",
      }),
      node("campus", "send_message", {
        text: "Training campus: Kesavadasapuram, near the flyover.",
        next_node_key: "tag",
      }),
      node("tag", "set_tag", { mode: "add", tag_id: "t1", next_node_key: "end" }),
      node("end", "end", {}),
    ],
  };
});

describe("serializeChatbot", () => {
  it("keeps what the bot says to a customer", async () => {
    const out = await serializeChatbot("acct-1", "flow-1");
    expect(out.text).toContain("Poojappura");
    expect(out.text).toContain("Opposite the Central Jail");
    expect(out.text).toContain("Head office | Training campus");
    expect(out.stepCount).toBe(3);
  });

  it("records which choice leads where, because the address depends on it", async () => {
    const out = await serializeChatbot("acct-1", "flow-1");
    // Without this, two addresses sit in the corpus with nothing saying
    // which is which, and the assistant picks whichever embeds closer.
    expect(out.text).toContain('Reached by choosing "Head office"');
    expect(out.text).toContain('Reached by choosing "Training campus"');
  });

  it("leaves the machinery out", async () => {
    const out = await serializeChatbot("acct-1", "flow-1");
    expect(out.text).not.toContain("set_tag");
    expect(out.text).not.toContain("t1");
    expect(out.text).not.toContain("next_node_key");
  });

  it("drops placeholders rather than letting them be quoted back", async () => {
    // "Hello {{contact.name}}" reaching a customer verbatim is a failure
    // this app has already had once, with prompt placeholders nothing
    // substituted.
    h.flow = {
      name: "Welcome",
      description: null,
      entry_node_id: "a",
      nodes: [node("a", "send_message", { text: "Hello {{contact.name}}, welcome to ACSTI." })],
    };
    const out = await serializeChatbot("acct-1", "flow-1");
    expect(out.text).not.toContain("{{");
    expect(out.text).toContain("welcome to ACSTI");
  });

  it("carries the purpose into the header, so the model knows when it applies", async () => {
    const out = await serializeChatbot("acct-1", "flow-1", "how to reach our campus");
    expect(out.text).toContain("PURPOSE: how to reach our campus");
    expect(out.text).toContain("CHATBOT: Location Guide");
  });

  it("reads a list bot's rows and their descriptions", async () => {
    h.flow = {
      name: "Courses",
      description: null,
      entry_node_id: "a",
      nodes: [
        node("a", "send_list", {
          text: "Pick a programme",
          button_label: "See all",
          sections: [
            {
              title: "Available",
              rows: [
                { reply_id: "stp", title: "STP", description: "Statutory Training Programme", next_node_key: "b" },
              ],
            },
          ],
        }),
      ],
    };
    const out = await serializeChatbot("acct-1", "flow-1");
    expect(out.text).toContain("STP — Statutory Training Programme");
  });

  it("says so plainly when there is nothing to read", async () => {
    h.flow = {
      name: "Tagger",
      description: null,
      entry_node_id: "a",
      nodes: [node("a", "set_tag", { mode: "add", tag_id: "t1" })],
    };
    await expect(serializeChatbot("acct-1", "flow-1")).rejects.toThrow(/no message text/);
  });

  it("refuses a bot that is not this account's", async () => {
    h.flow = null;
    await expect(serializeChatbot("acct-1", "flow-1")).rejects.toThrow(/no longer exists/);
  });

  it("does not loop forever on a bot that points back at itself", async () => {
    h.flow = {
      name: "Menu",
      description: null,
      entry_node_id: "a",
      nodes: [
        node("a", "send_buttons", {
          text: "Main menu",
          buttons: [{ reply_id: "back", title: "Back", next_node_key: "a" }],
        }),
      ],
    };
    const out = await serializeChatbot("acct-1", "flow-1");
    expect(out.stepCount).toBe(1);
  });
});
