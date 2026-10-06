import { describe, expect, it } from "vitest";
import {
  choiceRows,
  displayValue,
  editRows,
  inMonth,
  isCancel,
  looksLikeSomethingElse,
  matchChoice,
  matchField,
  matchMonth,
  monthRows,
  monthsOf,
  needsMonth,
  nextMissing,
  parseReplyId,
  replyId,
  summaryText,
  toIsoDate,
  upcoming,
  type Choice,
} from "./registration-draft-core";
import { maskAadhaarValue, parseRegistration, type FormHint } from "./image-reading";
import type { RegistrationForm } from "./registration";

const DRAFT = "0123456789ab-cdef-0000-000000000000";

const FORM: RegistrationForm = {
  table_id: "t1",
  name: "Training registration",
  slug: "training",
  description: null,
  required_fields: [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "designation", label: "Designation", type: "text", required: true },
    { key: "whatsapp", label: "WhatsApp number", type: "phone", required: true },
    { key: "programme", label: "Programme", type: "select", required: true, options: ["A"] },
  ],
  optional_fields: [{ key: "bank_account", label: "Bank account", type: "text", required: false }],
  unique_by: [],
  capacity_by: [],
  capacity_limit: null,
};

function programmes(n: number, from = "2026-10-01"): Choice[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(`${from}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i * 5);
    return { value: `Programme ${i + 1}`, date: d.toISOString().slice(0, 10) };
  });
}

describe("dates", () => {
  it("reads the spellings tables hold", () => {
    expect(toIsoDate("2026-10-15")).toBe("2026-10-15");
    expect(toIsoDate("2026-10-15T09:00:00Z")).toBe("2026-10-15");
    expect(toIsoDate("15/10/2026")).toBe("2026-10-15");
    expect(toIsoDate("15-10-2026")).toBe("2026-10-15");
    expect(toIsoDate("31/02/2026")).toBeNull();
    expect(toIsoDate("next week")).toBeNull();
  });

  it("offers only what is still open, soonest first, undated last", () => {
    const list = upcoming(
      [
        { value: "Old", date: "2026-09-01" },
        { value: "Later", date: "2026-11-01" },
        { value: "Any time", date: null },
        { value: "Soon", date: "2026-10-07" },
      ],
      "2026-10-06",
    );
    expect(list.map((c) => c.value)).toEqual(["Soon", "Later", "Any time"]);
  });
});

describe("month first", () => {
  it("asks for the month only when the choices outgrow one list and have dates", () => {
    expect(needsMonth(programmes(10))).toBe(false);
    expect(needsMonth(programmes(12))).toBe(true);
    expect(needsMonth(programmes(12).map((c) => ({ ...c, date: null })))).toBe(false);
  });

  it("groups by month, with undated ones last", () => {
    const choices = [...programmes(12), { value: "Rolling", date: null }];
    expect(monthsOf(choices)).toEqual(["2026-10", "2026-11", "none"]);
    expect(inMonth(choices, "2026-11").every((c) => c.date?.startsWith("2026-11"))).toBe(true);
    expect(inMonth(choices, "none").map((c) => c.value)).toEqual(["Rolling"]);
    const rows = monthRows(DRAFT, monthsOf(choices), "en", choices);
    expect(rows[0]).toMatchObject({ title: "October 2026", description: "7 options" });
    expect(monthRows(DRAFT, ["2026-10"], "ml", choices)[0].title).toBe("ഒക്ടോബർ 2026");
  });

  it("understands a typed month in English or Malayalam", () => {
    const months = ["2026-10", "2026-11"];
    expect(matchMonth("October", months)).toBe("2026-10");
    expect(matchMonth("nov", months)).toBe("2026-11");
    expect(matchMonth("ഒക്ടോബർ മാസം", months)).toBe("2026-10");
    expect(matchMonth("11", months)).toBe("2026-11");
    expect(matchMonth("October 2027", months)).toBeNull();
    expect(matchMonth("what is the fee", months)).toBeNull();
  });
});

describe("choosing", () => {
  it("fits WhatsApp's list: ten rows, or nine and 'See more'", () => {
    expect(choiceRows(DRAFT, programmes(10), 0, "en")).toHaveLength(10);
    const first = choiceRows(DRAFT, programmes(14), 0, "en");
    expect(first).toHaveLength(10);
    expect(first[9]).toMatchObject({ title: "See more" });
    expect(parseReplyId(first[9].id)).toMatchObject({ kind: "page", payload: "1" });
    expect(choiceRows(DRAFT, programmes(14), 1, "en")).toHaveLength(5);
  });

  it("keeps titles to 24 characters and puts the full name and date beneath", () => {
    const [row] = choiceRows(DRAFT, [{ value: "Statutory Training Programme for Clerks", date: "2026-10-20" }], 0, "en");
    expect(row.title.length).toBeLessThanOrEqual(24);
    expect(row.description).toContain("Statutory Training Programme for Clerks");
    expect(row.description).toContain("20 Oct 2026");
  });

  it("matches a typed choice only when it names exactly one", () => {
    const choices: Choice[] = [
      { value: "Accounts Training", date: null },
      { value: "Office Procedure", date: null },
      { value: "Accounts Advanced", date: null },
    ];
    expect(matchChoice("office procedure", choices)?.value).toBe("Office Procedure");
    expect(matchChoice("procedure", choices)?.value).toBe("Office Procedure");
    expect(matchChoice("accounts", choices)).toBeNull(); // two match
    expect(matchChoice("2", choices, choices)?.value).toBe("Office Procedure");
    expect(matchChoice("hi", choices)).toBeNull();
  });
});

describe("ids on rows and buttons", () => {
  it("round-trips, and refuses anything else", () => {
    const id = replyId("edit", DRAFT, "bank_account");
    expect(parseReplyId(id)).toEqual({ kind: "edit", short: "0123456789", payload: "bank_account" });
    expect(parseReplyId(replyId("yes", DRAFT))).toMatchObject({ kind: "yes", payload: "" });
    expect(parseReplyId("img_yes_1759999999999")).toBeNull();
    expect(parseReplyId("rgo_0123456789_x'; drop")).toBeNull();
  });
});

describe("what is asked next, and the summary", () => {
  it("asks the first required detail still missing, in the form's order", () => {
    expect(nextMissing(FORM, { name: "Asha" })?.key).toBe("designation");
    expect(nextMissing(FORM, { name: "A", designation: "Clerk", whatsapp: "9198", programme: "A" })).toBeNull();
  });

  it("shows everything together, an account number only by its last four, a phone in full", () => {
    const text = summaryText(
      FORM,
      { name: "Asha", designation: "Clerk", whatsapp: "919876543210", programme: "A", bank_account: "001234567890123" },
      "en",
    );
    expect(text).toContain("• Name: Asha");
    expect(text).toContain("• WhatsApp number: 919876543210");
    expect(text).toContain("• Bank account: XXXX0123");
    expect(text).not.toContain("001234567890123");
    expect(text).toMatch(/Shall I register you/);
    expect(text.length).toBeLessThanOrEqual(1024);
    expect(displayValue({ key: "p", label: "Phone", type: "phone", required: true }, "919876543210")).toBe("919876543210");
    expect(displayValue({ key: "i", label: "IFSC", type: "text", required: true }, "SBIN0001234")).toBe("SBIN0001234");
  });

  it("stays within WhatsApp's 1024 characters however long the details", () => {
    const long = summaryText(FORM, { name: "x".repeat(2000), designation: "y", whatsapp: "1", programme: "A" }, "ml");
    expect(long.length).toBeLessThanOrEqual(1024);
    expect(long).toMatch(/register ചെയ്യട്ടെ/);
  });

  it("offers each filled detail to change, and a way out", () => {
    const rows = editRows(DRAFT, FORM, { name: "Asha", bank_account: "001234567890123" }, "en");
    expect(rows.map((r) => r.title)).toEqual(["Name", "Bank account", "Cancel registration"]);
    expect(rows[1].description).toBe("XXXX0123");
    expect(matchField("bank", FORM)?.key).toBe("bank_account");
  });

  it("knows a question from an answer, and a cancel when it sees one", () => {
    expect(looksLikeSomethingElse("what is the fee?")).toBe(true);
    expect(looksLikeSomethingElse("Senior Clerk")).toBe(false);
    expect(isCancel("Cancel")).toBe(true);
    expect(isCancel("റദ്ദാക്കൂ")).toBe(true);
    expect(isCancel("cancel the old one and book the new")).toBe(false);
  });
});

describe("what the photo gave", () => {
  const hints: FormHint[] = [
    {
      table_id: "t1",
      name: "Training registration",
      fields: [
        { key: "name", label: "Name", type: "text" },
        { key: "bank_account", label: "Bank account", type: "text" },
        { key: "aadhaar", label: "Aadhaar number", type: "text" },
      ],
    },
  ];

  it("keeps a bank account number whole — the account stores it — and never an Aadhaar number", () => {
    const r = parseRegistration(
      {
        table_id: "t1",
        people: 1,
        values: [
          { key: "name", value: " Asha  K " },
          { key: "bank_account", value: "123456789012" },
          { key: "aadhaar", value: "234567890123" },
          { key: "invented_field", value: "x" },
        ],
      },
      hints,
    );
    expect(r?.values).toEqual({ name: "Asha K", bank_account: "123456789012", aadhaar: "XXXX XXXX 0123" });
  });

  it("refuses a form that does not exist, and counts the people in a list", () => {
    expect(parseRegistration({ table_id: "nope", people: 1, values: [{ key: "name", value: "A" }] }, hints)).toBeUndefined();
    expect(parseRegistration({ table_id: "t1", people: 7, values: [] }, hints)).toEqual({ tableId: "t1", people: 7, values: {} });
  });

  it("masks an Aadhaar printed 4-4-4 in any field, but not a run-together number elsewhere", () => {
    expect(maskAadhaarValue("2345 6789 0123", { key: "note", label: "Note" })).toBe("XXXX XXXX 0123");
    expect(maskAadhaarValue("234567890123", { key: "account", label: "Account no" })).toBe("234567890123");
  });
});
