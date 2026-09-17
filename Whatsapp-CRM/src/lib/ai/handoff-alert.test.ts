import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The rules that decide whether a staff alert is sent at all.
 *
 * Worth testing because every one of them fails silently by design: an
 * alert that is skipped looks exactly like an alert that was never
 * configured, and neither produces anything a person would notice. The
 * one thing this must never do is decide not to send and say nothing
 * about why — hence `skipped` carrying a reason rather than a bare false.
 */

const h = vi.hoisted(() => ({
  state: {
    config: null as Record<string, unknown> | null,
    template: null as Record<string, unknown> | null,
    sentText: [] as Array<{ to: string; text: string }>,
    sentTemplate: [] as Array<{ to: string; templateName: string; body: string[] }>,
    textThrows: null as string | null,
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    aiConfig: { findUnique: () => Promise.resolve(h.state.config) },
    messageTemplate: { findFirst: () => Promise.resolve(h.state.template) },
  },
}));

vi.mock("@/lib/whatsapp/encryption", () => ({ decrypt: (v: string) => v }));

vi.mock("@/lib/whatsapp/template-row-guard", () => ({
  isMessageTemplate: (row: unknown) => Boolean(row),
}));

vi.mock("@/lib/whatsapp/resolve-config", () => ({
  resolveWhatsAppConfig: () =>
    Promise.resolve({ phone_number_id: "pn1", access_token: "tok" }),
}));

vi.mock("@/lib/whatsapp/meta-api", () => ({
  sendTextMessage: (a: { to: string; text: string }) => {
    if (h.state.textThrows) return Promise.reject(new Error(h.state.textThrows));
    h.state.sentText.push({ to: a.to, text: a.text });
    return Promise.resolve({});
  },
  sendTemplateMessage: (a: {
    to: string;
    templateName: string;
    messageParams?: { body?: string[] };
  }) => {
    h.state.sentTemplate.push({
      to: a.to,
      templateName: a.templateName,
      body: a.messageParams?.body ?? [],
    });
    return Promise.resolve({});
  },
}));

import { sendHandoffAlert } from "./handoff-alert";

const INPUT = {
  accountId: "acct-1",
  conversationId: "conv-1",
  reason: "low_confidence",
  customerMessage: "I want to register for the September programme",
  contact: { name: "Hari", phone: "919876543210" },
};

beforeEach(() => {
  h.state.config = {
    handoff_alert_enabled: true,
    handoff_alert_numbers: ["919000000001"],
    handoff_alert_template: null,
    handoff_alert_reasons: [],
  };
  h.state.template = null;
  h.state.sentText = [];
  h.state.sentTemplate = [];
  h.state.textThrows = null;
});

describe("sendHandoffAlert", () => {
  it("says why it skipped rather than silently doing nothing", async () => {
    h.state.config = { ...h.state.config, handoff_alert_enabled: false };
    expect((await sendHandoffAlert(INPUT)).skipped).toBe("disabled");

    h.state.config = { ...h.state.config, handoff_alert_enabled: true, handoff_alert_numbers: [] };
    expect((await sendHandoffAlert(INPUT)).skipped).toBe("no_numbers");
  });

  it("sends the customer's name, number, reason and words", async () => {
    const result = await sendHandoffAlert(INPUT);
    expect(result.sent).toBe(1);
    const body = h.state.sentText[0].text;
    expect(body).toContain("Hari");
    expect(body).toContain("919876543210");
    expect(body).toContain("low confidence");
    expect(body).toContain("register for the September programme");
  });

  it("only alerts on the reasons asked for, when any are listed", async () => {
    h.state.config = { ...h.state.config, handoff_alert_reasons: ["safety"] };
    expect((await sendHandoffAlert(INPUT)).skipped).toBe("reason_filtered");

    h.state.config = { ...h.state.config, handoff_alert_reasons: ["low_confidence"] };
    expect((await sendHandoffAlert(INPUT)).sent).toBe(1);
  });

  it("refuses a template that is not approved, instead of sending nothing quietly", async () => {
    h.state.config = { ...h.state.config, handoff_alert_template: "staff_alert" };
    h.state.template = null;

    const result = await sendHandoffAlert(INPUT);
    expect(result.sent).toBe(0);
    expect(result.failed[0].error).toContain("not approved");
    // And it did not quietly fall back to plain text, which would look
    // like it worked right up until a staff member outside the 24-hour
    // window never heard anything.
    expect(h.state.sentText).toHaveLength(0);
  });

  it("flattens the quoted message, because Meta rejects a parameter with newlines", async () => {
    h.state.config = { ...h.state.config, handoff_alert_template: "staff_alert" };
    h.state.template = {
      id: "t1",
      user_id: "u1",
      name: "staff_alert",
      body_text: "{{1}} {{2}} {{3}} {{4}}",
      language: "en",
    };

    await sendHandoffAlert({ ...INPUT, customerMessage: "line one\n\nline   two" });
    expect(h.state.sentTemplate[0].body[2]).toBe("line one line two");
  });

  it("reports the number an alert failed for", async () => {
    h.state.config = { ...h.state.config, handoff_alert_numbers: ["919000000001", "919000000002"] };
    h.state.textThrows = "Recipient outside the 24 hour window";

    const result = await sendHandoffAlert(INPUT);
    expect(result.sent).toBe(0);
    expect(result.failed.map((f) => f.to)).toEqual(["919000000001", "919000000002"]);
  });

  it("never throws, because the handover it follows must not be undone", async () => {
    h.state.config = null;
    await expect(sendHandoffAlert(INPUT)).resolves.toBeTruthy();
  });
});
