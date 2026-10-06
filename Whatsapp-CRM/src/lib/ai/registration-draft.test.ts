import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ── Fakes ───────────────────────────────────────────────────────────
const h = vi.hoisted(() => {
  const state = {
    draft: null as null | Record<string, unknown>,
    sent: [] as { kind: string; body: string; ids: string[]; titles: string[] }[],
    notes: [] as string[],
    submitted: [] as Record<string, unknown>[],
    submitResult: { saved: true, say: "Registered for Training registration." } as Record<string, unknown>,
    handedOver: [] as string[],
  };
  return { state };
});

function sqlText(q: { strings?: string[] }): string {
  return (q.strings ?? []).join("?");
}

vi.mock("@/lib/db", () => ({
  prisma: {
    $executeRawUnsafe: async () => 0,
    $executeRaw: async (q: { strings?: string[]; values?: unknown[] }) => {
      if (/DELETE FROM registration_drafts WHERE conversation_id/.test(sqlText(q))) h.state.draft = null;
      return 0;
    },
    $queryRaw: async (q: { strings?: string[]; values?: unknown[] }) => {
      const text = sqlText(q);
      const v = q.values ?? [];
      if (text.includes("SELECT id, account_id")) return h.state.draft ? [h.state.draft] : [];
      if (text.includes("INSERT INTO registration_drafts")) {
        const [account_id, conversation_id, contact_id, table_id, values_enc, step, field_key, month, page, lang, edits] = v;
        h.state.draft = {
          id: (h.state.draft?.id as string) ?? "0123456789ab-cdef-0000-000000000000",
          account_id, conversation_id, contact_id, table_id, values_enc, step, field_key, month, page, lang, edits,
        };
        return [{ id: h.state.draft.id }];
      }
      return [];
    },
    message: {
      create: async ({ data }: { data: { content_text: string } }) => {
        h.state.notes.push(data.content_text);
        return {};
      },
    },
    contact: { findUnique: async () => ({ phone: "919876543210" }) },
    dataField: {
      findFirst: async ({ where }: { where: { table_id: string; field_key?: string; field_type?: unknown } }) => {
        if (where.table_id === "t1" && where.field_key === "programme") {
          return { options: { source_table_id: "t2", source_field_key: "title" } };
        }
        if (where.table_id === "t2" && where.field_type) return { field_key: "from_date" };
        return null;
      },
    },
    dataRecord: {
      findMany: async () =>
        PROGRAMMES.map((p) => ({ data: { title: p.title, from_date: p.date } })),
    },
  },
}));
vi.mock("@/lib/db/schema-patch", () => ({ onceSchemaPatch: async () => {} }));
vi.mock("@/lib/whatsapp/encryption", () => ({ encrypt: (s: string) => `enc:${s}`, decrypt: (s: string) => s.replace(/^enc:/, "") }));
vi.mock("@/lib/flows/meta-send", () => ({
  engineSendText: async (a: { text: string }) => {
    h.state.sent.push({ kind: "text", body: a.text, ids: [], titles: [] });
    return { whatsapp_message_id: "w1" };
  },
  engineSendInteractiveButtons: async (a: { bodyText: string; buttons: { id: string; title: string }[] }) => {
    h.state.sent.push({ kind: "buttons", body: a.bodyText, ids: a.buttons.map((b) => b.id), titles: a.buttons.map((b) => b.title) });
    return { whatsapp_message_id: "w2" };
  },
  engineSendInteractiveList: async (a: { bodyText: string; sections: { rows: { id: string; title: string }[] }[] }) => {
    const rows = a.sections.flatMap((s) => s.rows);
    h.state.sent.push({ kind: "list", body: a.bodyText, ids: rows.map((r) => r.id), titles: rows.map((r) => r.title) });
    return { whatsapp_message_id: "w3" };
  },
}));
vi.mock("./registration-tools", () => ({
  REGISTRATION_TOOLS: {
    submit_registration: {
      run: async (args: { values: Record<string, unknown> }) => {
        h.state.submitted.push(args.values);
        return h.state.submitResult;
      },
    },
  },
}));
vi.mock("./auto-reply", () => ({
  handOver: async (a: { note: string }) => {
    h.state.handedOver.push(a.note);
  },
}));
vi.mock("./registration", async () => {
  const actual = await vi.importActual<typeof import("./registration")>("./registration");
  return { ...actual, listRegistrationForms: async () => [FORM] };
});

const PROGRAMMES = Array.from({ length: 12 }, (_, i) => {
  const d = new Date("2026-10-10T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + i * 4);
  return { title: `Programme ${String.fromCharCode(65 + i)}`, date: d.toISOString().slice(0, 10) };
});

const FORM = {
  table_id: "t1",
  name: "Training registration",
  slug: "training",
  description: null,
  required_fields: [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "designation", label: "Designation", type: "text", required: true },
    { key: "whatsapp", label: "WhatsApp number", type: "phone", required: true },
    { key: "bank", label: "Bank name", type: "text", required: true },
    { key: "programme", label: "Programme", type: "select", required: true, options: PROGRAMMES.map((p) => p.title) },
  ],
  optional_fields: [{ key: "account_no", label: "Account number", type: "text", required: false }],
  unique_by: [],
  capacity_by: [],
  capacity_limit: null,
};

import { handleRegistrationReply, startRegistrationFromImage } from "./registration-draft";

const base = { accountId: "a1", userId: "u1", conversationId: "c1", contactId: "p1" };
const reply = (r: { text?: string; id?: string }) =>
  handleRegistrationReply({ ...base, text: r.text ?? "", interactiveReplyId: r.id ?? null });
const last = () => h.state.sent.at(-1)!;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-06T08:00:00Z"));
});
afterAll(() => vi.useRealTimers());

beforeEach(() => {
  h.state.draft = null;
  h.state.sent = [];
  h.state.notes = [];
  h.state.submitted = [];
  h.state.submitResult = { saved: true, say: "Registered for Training registration." };
  h.state.handedOver = [];
});

async function startFromPhoto(values: Record<string, string> = { name: "Asha K", designation: "Senior Clerk", bank: "SBI", account_no: "001234567890123" }) {
  return startRegistrationFromImage({
    ...base,
    sourceMessageId: "11111111-1111-1111-1111-111111111111",
    extract: { tableId: "t1", people: 1, values },
    languageSample: "",
  });
}

describe("registering from a photo", () => {
  it("asks the month, then the programme, then shows everything with Yes / No, then saves", async () => {
    expect(await startFromPhoto()).toBe("started");
    // Twelve programmes with dates: month first.
    expect(last().kind).toBe("list");
    expect(last().body).toMatch(/Which month/);
    expect(last().titles).toEqual(["October 2026", "November 2026"]);
    expect(h.state.notes[0]).toMatch(/Registration from a photo started — Training registration/);

    // Tap November.
    expect(await reply({ id: last().ids[1] })).toBe(true);
    expect(last().body).toMatch(/Please choose the Programme: \(November 2026\)|Please choose the Programme:.*November 2026/);
    expect(last().titles.every((t) => t.startsWith("Programme"))).toBe(true);

    // Tap the first November programme.
    const picked = last().titles[0];
    expect(await reply({ id: last().ids[0] })).toBe(true);

    // The summary: everything at once, the account number by its last four, the WhatsApp number filled in.
    const summary = last();
    expect(summary.kind).toBe("buttons");
    expect(summary.body).toContain("• Name: Asha K");
    expect(summary.body).toContain("• WhatsApp number: 919876543210");
    expect(summary.body).toContain(`• Programme: ${picked}`);
    expect(summary.body).toContain("• Account number: XXXX0123");
    expect(summary.titles).toEqual(["Yes, register", "No, change"]);

    // Yes.
    expect(await reply({ id: summary.ids[0] })).toBe(true);
    expect(h.state.submitted[0]).toMatchObject({ name: "Asha K", programme: picked, account_no: "001234567890123" });
    expect(last().body).toBe("You are registered ✅");
    expect(h.state.draft).toBeNull();
    expect(h.state.notes.at(-1)).toMatch(/Registered from a photo/);
  });

  it("asks for a required detail the photo did not have, and checks it", async () => {
    await startFromPhoto({ name: "Asha K", bank: "SBI" });
    expect(last()).toMatchObject({ kind: "text", body: expect.stringMatching(/Please send your Designation/) });
    // A question is not an answer: left for the assistant.
    expect(await reply({ text: "what is the fee?" })).toBe(false);
    expect(await reply({ text: "Senior Clerk" })).toBe(true);
    expect(last().body).toMatch(/Which month/);
  });

  it("takes a typed month and programme as well as taps", async () => {
    await startFromPhoto();
    expect(await reply({ text: "October" })).toBe(true);
    expect(await reply({ text: "programme b" })).toBe(true);
    expect(last().body).toContain("• Programme: Programme B");
  });

  it("lets them change one detail on No, then shows the summary again", async () => {
    await startFromPhoto();
    await reply({ text: "October" });
    await reply({ text: "programme b" });
    expect(await reply({ id: last().ids[1] })).toBe(true); // No, change
    expect(last().body).toMatch(/Which detail/);
    const designationRow = last().ids[last().titles.indexOf("Designation")];
    expect(await reply({ id: designationRow })).toBe(true);
    expect(last().body).toMatch(/Please send your Designation/);
    await reply({ text: "Section Officer" });
    expect(last().body).toContain("• Designation: Section Officer");
  });

  it("hands a list of several people to the team, and saves nothing", async () => {
    const out = await startRegistrationFromImage({
      ...base,
      sourceMessageId: "11111111-1111-1111-1111-111111111111",
      extract: { tableId: "t1", people: 6, values: { name: "Asha K" } },
      languageSample: "",
    });
    expect(out).toBe("group");
    expect(h.state.handedOver[0]).toMatch(/details for 6 people/);
    expect(last().body).toMatch(/more than one person/);
    expect(h.state.submitted).toHaveLength(0);
  });

  it("does not register twice: an existing registration ends it plainly", async () => {
    await startFromPhoto();
    await reply({ text: "October" });
    await reply({ text: "programme b" });
    h.state.submitResult = { saved: false, already_registered: true, say: "…" };
    await reply({ text: "yes" });
    expect(last().body).toBe("You are already registered for this.");
    expect(h.state.draft).toBeNull();
  });

  it("cancels on 'cancel', in Malayalam too, and answers in Malayalam", async () => {
    await startRegistrationFromImage({
      ...base,
      sourceMessageId: "11111111-1111-1111-1111-111111111111",
      extract: { tableId: "t1", people: 1, values: { name: "ആശ", designation: "ക്ലർക്ക്", bank: "SBI" } },
      languageSample: "എനിക്ക് register ചെയ്യണം",
    });
    expect(last().body).toMatch(/ഏത് മാസത്തേക്കാണ്/);
    expect(last().titles[0]).toBe("ഒക്ടോബർ 2026");
    expect(await reply({ text: "റദ്ദാക്കൂ" })).toBe(true);
    expect(last().body).toMatch(/റദ്ദാക്കി/);
    expect(h.state.draft).toBeNull();
  });

  it("ignores a button from another draft", async () => {
    await startFromPhoto();
    expect(await reply({ id: "rgy_ffffffffff" })).toBe(false);
  });
});
