import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Bug (19 Oct 2026, ACSTI): a customer asking about their registration on
 * WhatsApp was told they had none, unless they had registered through
 * WhatsApp. Registrations taken on the website, by phone, or typed into the
 * training's Google Sheet have no chat linked to them, and my_registrations
 * only looked at rows saved by this chat.
 *
 * The fix looks for the customer's own WhatsApp number in the registration
 * table and in the sheets the table routes to — never anyone else's row.
 */

const h = vi.hoisted(() => ({
  state: {
    byPhoneRows: [] as Record<string, unknown>[],
    sheetRows: {} as Record<string, string[][]>,
    routes: [] as Record<string, unknown>[],
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    contact: { findFirst: () => Promise.resolve({ phone: "+919446437835" }) },
    dataTable: {
      findMany: () =>
        Promise.resolve([
          {
            id: "t1", name: "Training Registration", slug: "tr", description: null,
            ai_unique_by: [], ai_capacity_by: [], ai_capacity_limit: null,
            fields: [
              { field_key: "name", label: "Name of Participant", field_type: "text", required: true, options: null },
              { field_key: "wa", label: "Whatsapp no", field_type: "text", required: true, options: null },
              { field_key: "aadhaar", label: "Aadhaar No", field_type: "text", required: false, options: null },
            ],
          },
        ]),
    },
    // Rows saved by this chat: none.
    dataRecord: { findMany: () => Promise.resolve([]) },
    // Rows found by phone number (the SQL narrows; the code checks again).
    $queryRaw: () => Promise.resolve(h.state.byPhoneRows),
    sheetRoute: { findMany: () => Promise.resolve(h.state.routes) },
    sheetRouteTarget: { findMany: () => Promise.resolve([]) },
  },
}));

vi.mock("@/lib/google/oauth", () => ({ googleAccessToken: () => Promise.resolve("tok") }));
vi.mock("@/lib/google/sheets", async () => {
  const real = await vi.importActual<Record<string, unknown>>("@/lib/google/sheets");
  return {
    ...real,
    getSpreadsheet: (_t: string, id: string) =>
      Promise.resolve({ id, title: "MDP 2026", tabs: Object.keys(h.state.sheetRows).map((title, i) => ({ sheetId: i, title })) }),
    readTab: (_t: string, _id: string, tab: string) => Promise.resolve(h.state.sheetRows[tab] ?? []),
  };
});

import { REGISTRATION_TOOLS } from "./registration-tools";
import { invalidateRegistrationForms } from "./registration";
import { clearRegistrationLookupCache } from "./registration-lookup";

const CTX = { accountId: "acct-1", contactId: "contact-1" };
const run = () => REGISTRATION_TOOLS.my_registrations.run({}, CTX) as Promise<Record<string, unknown>>;

beforeEach(() => {
  invalidateRegistrationForms(CTX.accountId);
  clearRegistrationLookupCache();
  h.state.byPhoneRows = [];
  h.state.sheetRows = {};
  h.state.routes = [];
});

describe("my_registrations — registrations not made through this chat", () => {
  it("finds a row entered by the office with this customer's number, and never someone else's", async () => {
    h.state.byPhoneRows = [
      { id: "own", table_id: "t1", data: { name: "Anil Kumar K P", wa: "94464 37835", aadhaar: "1234 5678 9012" }, created_at: new Date("2026-10-01T10:00:00Z"), source: "import" },
      // Returned by a too-loose query — must still be dropped.
      { id: "other", table_id: "t1", data: { name: "Someone Else", wa: "9847000000" }, created_at: new Date("2026-10-02T10:00:00Z"), source: "import" },
    ];
    const r = await run();
    expect(r.found).toBe(true);
    const regs = r.registrations as Array<Record<string, unknown>>;
    expect(regs.map((x) => x.registration_id)).toEqual(["own"]);
    expect(JSON.stringify(regs)).not.toMatch(/Someone Else|1234 5678 9012/);
    expect(regs[0].can_change_in_chat).toBe(false);
  });

  it("finds a row typed straight into the training's Google Sheet", async () => {
    h.state.routes = [{ spreadsheet_id: "S1", spreadsheet_name: "MDP 2026" }];
    h.state.sheetRows = {
      "Master Template": [
        ["Sl No.", "Name of participants", "WhatsApp No.", "Aadhaar No", "Status", "CRM ID"],
        ["35", "priyadarsan", "9446152239", "", "Paid", ""],
        ["36", "Anil Kumar K P", "+91 94464 37835", "9999 8888 7777", "Confirmed", ""],
        ["37", "Anil (from CRM)", "9446437835", "", "New", "rec-123"],
      ],
    };
    const r = await run();
    const regs = r.registrations as Array<Record<string, unknown>>;
    expect(regs).toHaveLength(1);
    expect(regs[0].details).toMatchObject({ "Name of participants": "Anil Kumar K P", Status: "Confirmed" });
    expect(JSON.stringify(regs)).not.toMatch(/priyadarsan|9999 8888 7777|rec-123/);
    expect(String(regs[0].where)).toMatch(/MDP 2026/);
  });

  it("says plainly when there is nothing for this number", async () => {
    expect((await run()).found).toBe(false);
  });
});
