import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Bug (19 Oct 2026, ACSTI): in AI Settings → Admin, "registration details
 * for 9048724010" ended with "That question needed more lookups than one
 * turn allows". The admin assistant had no way to find a person by number:
 * read_data_table returns the newest 50 rows, so it read table after table
 * until it ran out of turns.
 */

const h = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock("@/lib/db", () => ({
  prisma: {
    dataTable: {
      findMany: () =>
        Promise.resolve([
          {
            id: "t1", name: "Training Registration",
            fields: [
              { field_key: "name", label: "Name of Participant", field_type: "text" },
              { field_key: "wa", label: "Whatsapp no", field_type: "phone" },
              { field_key: "aadhaar", label: "Aadhaar No", field_type: "text" },
              { field_key: "pw", label: "Password", field_type: "password" },
            ],
          },
        ]),
    },
    $queryRaw: () => Promise.resolve(h.rows),
    contact: { findMany: () => Promise.resolve([{ name: "Faisal A", phone: "919048724010", created_at: new Date("2026-09-25T10:00:00Z") }]) },
    lead: { findMany: () => Promise.resolve([]) },
    sheetRoute: { findMany: () => Promise.resolve([]) },
    sheetRouteTarget: { findMany: () => Promise.resolve([]) },
  },
}));

import { runTool, TOOL_NAMES } from "./tools";

beforeEach(() => {
  h.rows = [
    { id: "r1", table_id: "t1", data: { name: "Faisal A", wa: "+91 90487 24010", aadhaar: "1234 5678 9012", pw: "x" }, created_at: new Date("2026-09-25T12:00:00Z") },
    // Returned by a too-loose query — must be dropped.
    { id: "r2", table_id: "t1", data: { name: "Someone Else", wa: "9847000000" }, created_at: new Date("2026-09-26T12:00:00Z") },
  ];
});

describe("admin assistant — find a person by phone number", () => {
  it("is offered", () => {
    expect(TOOL_NAMES).toContain("find_by_phone");
  });

  it("finds the registration and the contact in one lookup, and nobody else", async () => {
    const r = (await runTool("find_by_phone", { phone: "9048724010" }, { accountId: "acct-1" })) as Record<string, unknown>;
    const text = JSON.stringify(r);
    expect(text).toContain("Faisal A");
    expect(text).toContain("Training Registration");
    expect(text).not.toContain("Someone Else");
    expect(text).not.toMatch(/1234 5678 9012|"Password"/);
  });

  it("says plainly when the number is not a phone number", async () => {
    const r = (await runTool("find_by_phone", { phone: "12345" }, { accountId: "acct-1" })) as Record<string, unknown>;
    expect(String(r.error)).toMatch(/10 digits/);
  });
});
