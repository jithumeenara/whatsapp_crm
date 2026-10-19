import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Bug (19 Oct 2026, ACSTI, after f386289): a participant typed into the
 * training's Google Sheet asked on WhatsApp "have I registered for any
 * training?" and was told no. The assistant can answer that question with
 * either of two tools; my_enquiries (leads) also claimed "registration", and
 * when the customer had no lead it said "no enquiry on record" — so the
 * registration in the sheet was never looked at.
 */

const h = vi.hoisted(() => ({
  state: { sheetRows: {} as Record<string, string[][]> },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    lead: { findMany: () => Promise.resolve([]) },
    contact: { findFirst: () => Promise.resolve({ phone: "918590551176" }) },
    dataTable: {
      findMany: () =>
        Promise.resolve([
          {
            id: "t1", name: "Training Registration", slug: "tr", description: null,
            ai_unique_by: [], ai_capacity_by: [], ai_capacity_limit: null,
            fields: [{ field_key: "name", label: "Name of Participant", field_type: "text", required: true, options: null }],
          },
        ]),
    },
    dataRecord: { findMany: () => Promise.resolve([]) },
    $queryRaw: () => Promise.resolve([]),
    sheetRoute: { findMany: () => Promise.resolve([{ id: "r1", spreadsheet_id: "S1", spreadsheet_name: "MDP 2026 November 23 to 25" }]) },
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

import { runCustomerTool } from "./customer-tools";
import { REGISTRATION_INSTRUCTION } from "./registration-tools";
import { invalidateRegistrationForms } from "./registration";
import { clearRegistrationLookupCache } from "./registration-lookup";

const CTX = { accountId: "acct-1", contactId: "contact-1" };

beforeEach(() => {
  invalidateRegistrationForms(CTX.accountId);
  clearRegistrationLookupCache();
  h.state.sheetRows = {
    "Master Template": [
      ["Sl No.", "Name of participants", "Designation", "Name of the Bank", "WhatsApp No.", "Status"],
      ["35", "priyadarsan", "Director", "Kollengode", "9446152239", "Registered"],
      ["36", "JIthu L R", "Secretary", "Monvila SCB", "8590551176", "Registered"],
    ],
  };
});

describe("asking 'am I registered?' through either tool", () => {
  it("my_enquiries with no lead still finds the registration in the training sheet", async () => {
    const r = (await runCustomerTool("my_enquiries", {}, CTX)) as Record<string, unknown>;
    expect(r.found).toBe(true);
    expect(JSON.stringify(r)).toContain("JIthu L R");
    expect(JSON.stringify(r)).not.toContain("priyadarsan");
  });

  it("the assistant is told to check before saying someone is not registered", () => {
    expect(REGISTRATION_INSTRUCTION).toMatch(/my_registrations/);
    expect(REGISTRATION_INSTRUCTION).toMatch(/never say they are not registered/i);
  });
});
