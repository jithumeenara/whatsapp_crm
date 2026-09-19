import { describe, it, expect } from "vitest";

import {
  slaStateFor,
  hoursUntouched,
  describeUntouched,
  DEFAULT_SLA,
} from "./sla";

/**
 * When a lead is called late.
 *
 * The thing worth guarding is the quiet direction: a lead marked
 * overdue that is not, or worse, one that is overdue and not marked.
 * The first makes people stop reading the colour; the second is the
 * failure the colour exists to prevent.
 */

const NOW = new Date("2026-09-19T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

describe("slaStateFor", () => {
  it("leaves a lead touched today alone", () => {
    expect(slaStateFor({ status: "new", updated_at: hoursAgo(2) }, DEFAULT_SLA, NOW)).toBe("ok");
  });

  it("warns once it passes the warning threshold", () => {
    expect(slaStateFor({ status: "new", updated_at: hoursAgo(24) }, DEFAULT_SLA, NOW)).toBe("warn");
    expect(slaStateFor({ status: "new", updated_at: hoursAgo(48) }, DEFAULT_SLA, NOW)).toBe("warn");
  });

  it("breaches once it passes the second one", () => {
    expect(slaStateFor({ status: "new", updated_at: hoursAgo(72) }, DEFAULT_SLA, NOW)).toBe("breach");
    expect(slaStateFor({ status: "new", updated_at: hoursAgo(200) }, DEFAULT_SLA, NOW)).toBe("breach");
  });

  it("never calls a closed lead late", () => {
    // Finished work marked overdue is how a list of warnings becomes
    // something people stop reading.
    expect(slaStateFor({ status: "closed", updated_at: hoursAgo(500) }, DEFAULT_SLA, NOW)).toBe("ok");
  });

  it("is switched off by a zero", () => {
    const off = { warnHours: 0, breachHours: 0 };
    expect(slaStateFor({ status: "new", updated_at: hoursAgo(500) }, off, NOW)).toBe("ok");
  });

  it("honours a warning-only setup", () => {
    const warnOnly = { warnHours: 12, breachHours: 0 };
    expect(slaStateFor({ status: "new", updated_at: hoursAgo(500) }, warnOnly, NOW)).toBe("warn");
  });
});

describe("hoursUntouched", () => {
  it("reads a clock ahead of ours as zero, not as a lead from the future", () => {
    const future = new Date(NOW.getTime() + 3600_000).toISOString();
    expect(hoursUntouched(future, NOW)).toBe(0);
  });

  it("does not throw on a timestamp it cannot parse", () => {
    expect(hoursUntouched("not a date", NOW)).toBe(0);
  });
});

describe("describeUntouched", () => {
  it("says it the way somebody would", () => {
    expect(describeUntouched(hoursAgo(0.5), NOW)).toBe("just now");
    expect(describeUntouched(hoursAgo(5), NOW)).toBe("5h untouched");
    expect(describeUntouched(hoursAgo(50), NOW)).toBe("2d untouched");
  });

  it("rounds to one unit, because the hours past three days do not matter", () => {
    expect(describeUntouched(hoursAgo(79), NOW)).toBe("3d untouched");
  });
});
