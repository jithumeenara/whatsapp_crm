import { describe, it, expect } from "vitest";
import { validateReply } from "./validator";

/**
 * Dates written one way, stored another.
 *
 * Straight from a live WhatsApp thread. The assistant drafted:
 *
 *   "Statutory Training Programme (STP) for Sub-staff
 *    Dates: 29 September 2026 to 01 October 2026
 *    Fee: ₹3,540"
 *
 * — and the reply was withheld and the customer handed to a colleague,
 * because "01 October 2026" was judged an invented date. It was not. The
 * knowledge behind it was a Data Store table holding that date as
 * 2026-10-01, and the word "october" appears nowhere in a numeric date.
 *
 * The tell is that "29 September 2026" in the same sentence passed. Not
 * because the check worked — because that table happens to carry a
 * separate Month column reading "september". Two dates from one row, one
 * accepted and one rejected, on a coincidence.
 */

const TABLE_CONTEXT = [
  "TABLE: Training",
  "PURPOSE: This is ACSTI KERALA Planed Training Programmes",
  "Name of programme: Statutory Training Programme (STP)",
  "Target group: Sub-staff",
  "Month: september",
  "Date from: 2026-09-29",
  "Date To: 2026-10-01",
  "Coordinator: Sunitha Sahadevan",
  "Fee: 3540",
].join("\n");

const validate = (reply: string, context = TABLE_CONTEXT) =>
  validateReply({ reply, contextParts: [context] });

describe("validateReply — dates", () => {
  it("accepts the reply that was withheld", () => {
    const result = validate(
      "Our upcoming programme is the Statutory Training Programme (STP) for Sub-staff, " +
        "from 29 September 2026 to 01 October 2026. Fee: 3540.",
    );
    expect(result.ok).toBe(true);
  });

  it("accepts a month name against an ISO date", () => {
    expect(validate("It runs until 01 October 2026.").ok).toBe(true);
  });

  it("accepts a month name against a day-first date", () => {
    expect(validate("It runs until 1 October 2026.", "Date To: 1/10/2026").ok).toBe(true);
  });

  it("accepts a month name against a month-first date", () => {
    expect(validate("It runs until 1 October 2026.", "Date To: 10/1/2026").ok).toBe(true);
  });

  it("still refuses a date that is nowhere in the context", () => {
    // The check has to keep doing its job: this is the failure it exists
    // for, and a confident wrong date costs somebody a wasted journey.
    const result = validate("It runs until 15 December 2027.");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.kind === "date")).toBe(true);
  });

  it("refuses the right year with the wrong day", () => {
    expect(validate("It runs until 05 October 2026.").ok).toBe(false);
  });

  it("does not accept a day and month that only line up as a fraction", () => {
    // "1/10" as a ratio in some unrelated sentence must not license
    // "1 October 2026" — that is why the year is required when stated.
    expect(validate("It runs until 1 October 2026.", "Roughly 1/10 of applicants.").ok).toBe(false);
  });
});
