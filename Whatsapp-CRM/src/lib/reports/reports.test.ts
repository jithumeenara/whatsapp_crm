import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { bucketStarts, bucketFor, resolvePeriod } from "./period";
import { checkSpec, describe as say, parseSpec, ReportError, type ReportResult } from "./engine";
import { STATIC_MOMENTS, storeMoment, Params, type StoreTable } from "./moments";
import { insightsFor } from "./insights";
import { exportFilename, safeText } from "./excel";
import { PRESET_REPORTS, dataStorePresets } from "./presets";

const NOW = new Date("2026-10-04T20:30:00Z"); // 5 Oct, 02:00 in India

describe("periods are counted in the business's days", () => {
  it("knows it is already tomorrow in India", () => {
    const p = resolvePeriod({ preset: "today" }, "Asia/Kolkata", NOW)!;
    expect(p.from).toBe("2026-10-05");
    expect(p.toExclusive).toBe("2026-10-06");
  });

  it("last 30 days ends today and compares with the 30 before", () => {
    const p = resolvePeriod({ preset: "last_30_days" }, "Asia/Kolkata", NOW)!;
    expect(p).toMatchObject({ from: "2026-09-06", toExclusive: "2026-10-06", days: 30, prevFrom: "2026-08-07", prevToExclusive: "2026-09-06" });
  });

  it("last month is the whole calendar month", () => {
    const p = resolvePeriod({ preset: "last_month" }, "Asia/Kolkata", NOW)!;
    expect(p).toMatchObject({ from: "2026-09-01", toExclusive: "2026-10-01", days: 30 });
  });

  it("refuses impossible and oversized custom ranges", () => {
    expect(resolvePeriod({ from: "2026-02-30", to: "2026-03-01" }, "Asia/Kolkata", NOW)).toBeNull();
    expect(resolvePeriod({ from: "2026-05-01", to: "2026-04-01" }, "Asia/Kolkata", NOW)).toBeNull();
    expect(resolvePeriod({ from: "2020-01-01", to: "2026-01-01" }, "Asia/Kolkata", NOW)).toBeNull();
    expect(resolvePeriod({ from: "2026-09-01", to: "2026-09-30" }, "Asia/Kolkata", NOW)).toMatchObject({ days: 30 });
  });

  it("fills every bucket so a quiet day shows as zero", () => {
    expect(bucketFor(30)).toBe("day");
    expect(bucketFor(90)).toBe("week");
    expect(bucketFor(365)).toBe("month");
    expect(bucketStarts("2026-09-29", "2026-10-02", "day")).toEqual(["2026-09-29", "2026-09-30", "2026-10-01"]);
    expect(bucketStarts("2026-10-01", "2026-10-15", "week")[0]).toBe("2026-09-28"); // a Monday
    expect(bucketStarts("2026-11-15", "2027-02-01", "month")).toEqual(["2026-11-01", "2026-12-01", "2027-01-01"]);
  });
});

const TABLE: StoreTable = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Appointments",
  fields: [
    { field_key: "patient_name", label: "Patient", field_type: "text" },
    { field_key: "phone", label: "Phone", field_type: "phone" },
    { field_key: "doctor", label: "Doctor", field_type: "select" },
    { field_key: "visit_date", label: "Visit date", field_type: "date" },
    { field_key: "fee", label: "Fee", field_type: "number" },
  ],
};

describe("moments", () => {
  it("never offers a name or phone number as something to split by", () => {
    const m = storeMoment(TABLE);
    const keys = m.props.map((p) => p.key);
    expect(keys).toContain("f:doctor");
    expect(keys).toContain("m:visit_date");
    expect(keys.some((k) => k.includes("patient_name") || k.includes("phone"))).toBe(false);
    expect(m.values.map((v) => v.key)).toEqual(["n:fee"]);
  });

  it("passes Data Store table and field keys as parameters, never into the SQL text", () => {
    const evil: StoreTable = { ...TABLE, fields: [{ field_key: "x'); DROP TABLE leads; --", label: "X", field_type: "select" }] };
    const p = new Params();
    const sql = storeMoment(evil).sql(p, p.add("acct"));
    const text = [sql.from, sql.where, ...Object.values(sql.prop)].join(" ");
    expect(text).not.toContain("DROP TABLE");
    expect(p.values).toContain("x'); DROP TABLE leads; --");
  });

  it("decides won and lost exactly as the Leads page does", () => {
    const p = new Params();
    const won = STATIC_MOMENTS.find((m) => m.kind === "lead.won")!.sql(p, "$1");
    const lost = STATIC_MOMENTS.find((m) => m.kind === "lead.lost")!.sql(p, "$1");
    expect(won.where).toContain("l.status = 'closed' AND l.converted_at IS NOT NULL");
    expect(lost.where).toContain("l.converted_at IS NULL");
    expect(lost.where).toContain("lost_reason");
  });
});

describe("a spec is checked before it runs", () => {
  it("accepts every ready report", () => {
    for (const p of [...PRESET_REPORTS, ...dataStorePresets([TABLE])]) {
      expect(() => checkSpec(parseSpec(p.spec), [TABLE])).not.toThrow();
    }
  });

  it("refuses shapes, moments and details that do not exist", () => {
    expect(() => parseSpec({ shape: "drop", moment: "lead.won", period: {} })).toThrow(ReportError);
    expect(() => checkSpec(parseSpec({ shape: "count", moment: "lead.nope", period: {} }), [])).toThrow(/does not exist/);
    expect(() => checkSpec(parseSpec({ shape: "count", moment: "lead.won", by: "password", period: {} }), [])).toThrow(/cannot split/);
    expect(() => checkSpec(parseSpec({ shape: "sum", moment: "lead.won", value: "amount", period: {} }), [])).toThrow(/no number/);
    expect(() => checkSpec(parseSpec({ shape: "from_to", moment: "lead.won", to: "lead.won", period: {} }), [])).toThrow(/two different/);
    expect(() => parseSpec({ shape: "count", moment: "lead.won", period: {}, filters: [1, 2, 3, 4].map(() => ({ prop: "source", value: "x" })) })).toThrow(/three/);
    expect(() => parseSpec({ shape: "from_to", moment: "lead.won", period: {}, window_days: 9999 })).toThrow(/365/);
  });

  it("says the report as a sentence", () => {
    const c = checkSpec(parseSpec({ shape: "from_to", moment: "lead.created", to: "lead.won", by: "agent", window_days: 90, period: {} }), []);
    expect(say(c, "in the last 90 days")).toBe("Leads created → leads won within 90 days, by team member — in the last 90 days");
  });
});

const base: ReportResult = {
  title: "t", shape: "count", periodLabel: "in the last 30 days",
  period: { from: "2026-09-06", toExclusive: "2026-10-06", prevFrom: "2026-08-07", prevToExclusive: "2026-09-06" },
  unit: null, byLabel: null, total: 0, previousTotal: 0,
};

describe("automatic insights", () => {
  it("quotes only numbers from the result", () => {
    const lines = insightsFor({
      ...base, byLabel: "Source", total: 158, previousTotal: 120,
      groups: [
        { key: "fb", label: "Facebook", value: 65, previous: 60 },
        { key: "walk", label: "Walk-in", value: 22, previous: 4 },
      ],
    });
    expect(lines[0]).toBe("158 — 32% more than the period before (120).");
    expect(lines[1]).toBe("Top source: Facebook — 41% (65 of 158).");
    expect(lines[2]).toBe("Biggest rise: Walk-in, up 18 (from 4 to 22).");
  });

  it("stays quiet about changes on a tiny base", () => {
    expect(insightsFor({ ...base, total: 3, previousTotal: 1 })).toEqual(["3 in the last 30 days."]);
  });

  it("describes a win rate with the best and lowest group", () => {
    const lines = insightsFor({
      ...base, shape: "from_to", byLabel: "Team member", total: 40,
      funnel: {
        windowDays: 90, toLabel: "Lead won",
        all: { key: "all", label: "all", started: 40, converted: 10, rate: 0.25, medianSeconds: 2 * 86400 },
        groups: [
          { key: "a", label: "Anu", started: 20, converted: 8, rate: 0.4, medianSeconds: 86400 },
          { key: "b", label: "Ravi", started: 20, converted: 2, rate: 0.1, medianSeconds: 4 * 86400 },
        ],
      },
    });
    expect(lines[0]).toBe('25% reached "Lead won" within 90 days (10 of 40).');
    expect(lines[1]).toBe("Typical time to get there: 2.0 days (median).");
    expect(lines[2]).toBe("Best team member: Anu at 40% (8 of 20); lowest: Ravi at 10% (2 of 20).");
  });
});

describe("Excel export", () => {
  it("neutralises anything a spreadsheet would read as a formula", () => {
    expect(safeText("=HYPERLINK(\"http://x\")")).toBe("'=HYPERLINK(\"http://x\")");
    for (const bad of ["+1", "-1", "@SUM(A1)", "\tx", "\rx"]) expect(safeText(bad).startsWith("'")).toBe(true);
    expect(safeText("Facebook Ads")).toBe("Facebook Ads");
    expect(safeText("കൊല്ലം")).toBe("കൊല്ലം");
  });

  it("names the file safely", () => {
    expect(exportFilename("How many leads won, by source — this month", "2026-10-01")).toBe("How many leads won by source 2026-10-01.xlsx");
    expect(exportFilename('../../etc/passwd" — x', "2026-10-01")).toBe("etcpasswd 2026-10-01.xlsx");
  });
});
