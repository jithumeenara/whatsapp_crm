import { describe, expect, it } from "vitest";
import { safeText } from "./spreadsheet-safe";

// Moved unchanged from the old reports tests when the Reports section was
// removed; the broadcast and contact-list exports still rely on it.
describe("spreadsheet export text", () => {
  it("neutralises anything a spreadsheet would read as a formula", () => {
    expect(safeText("=HYPERLINK(\"http://x\")")).toBe("'=HYPERLINK(\"http://x\")");
    for (const bad of ["+1", "-1", "@SUM(A1)", "\tx", "\rx"]) expect(safeText(bad).startsWith("'")).toBe(true);
    expect(safeText("Facebook Ads")).toBe("Facebook Ads");
    expect(safeText("കൊല്ലം")).toBe("കൊല്ലം");
  });
});
