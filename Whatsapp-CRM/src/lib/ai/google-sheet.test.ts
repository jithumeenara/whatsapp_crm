import { describe, it, expect, vi, afterEach } from "vitest";
import { parseSheetUrl, parseCsv, serializeSheet, fetchSheet, SheetError } from "./google-sheet";

describe("parseSheetUrl", () => {
  it("takes the id and tab out of a normal browser URL", () => {
    const ref = parseSheetUrl(
      "https://docs.google.com/spreadsheets/d/1AbC-dEf_12345/edit#gid=987654",
    );
    expect(ref.spreadsheetId).toBe("1AbC-dEf_12345");
    expect(ref.gid).toBe("987654");
    expect(ref.csvUrl).toBe(
      "https://docs.google.com/spreadsheets/d/1AbC-dEf_12345/export?format=csv&gid=987654",
    );
  });

  it("works without a tab id", () => {
    const ref = parseSheetUrl("https://docs.google.com/spreadsheets/d/1AbC/edit");
    expect(ref.gid).toBeNull();
    expect(ref.csvUrl).not.toContain("gid");
  });

  // The server fetches this URL on the account's behalf, so the host is
  // the one thing that can never be left to whatever was pasted.
  it("refuses any host but Google's", () => {
    expect(() => parseSheetUrl("https://evil.example.com/spreadsheets/d/1AbC")).toThrow(SheetError);
    expect(() => parseSheetUrl("http://169.254.169.254/latest/meta-data/")).toThrow(SheetError);
    expect(() => parseSheetUrl("file:///etc/passwd")).toThrow(SheetError);
    expect(() => parseSheetUrl("https://docs.google.com.evil.test/spreadsheets/d/1AbC")).toThrow(
      SheetError,
    );
  });

  it("refuses a Google link that is not a spreadsheet", () => {
    expect(() => parseSheetUrl("https://docs.google.com/document/d/1AbC/edit")).toThrow(
      /not a spreadsheet/i,
    );
  });

  it("says what is wrong in words, not a status code", () => {
    expect(() => parseSheetUrl("not a url")).toThrow(/paste the sheet URL/i);
  });
});

describe("parseCsv", () => {
  it("keeps a comma inside a quoted field", () => {
    expect(parseCsv('a,"b,c",d')).toEqual([["a", "b,c", "d"]]);
  });

  it("keeps a newline inside a quoted field", () => {
    // A multi-line answer in one cell is the normal case for a knowledge
    // sheet, and the reason splitting on commas and newlines is wrong.
    expect(parseCsv('q,"line one\nline two"')).toEqual([["q", "line one\nline two"]]);
  });

  it("unescapes a doubled quote", () => {
    expect(parseCsv('a,"say ""hi"" now"')).toEqual([["a", 'say "hi" now']]);
  });

  it("handles CRLF without emitting blank rows", () => {
    expect(parseCsv("a,b\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("strips a byte-order mark so the first header still matches", () => {
    expect(parseCsv("﻿Question,Answer")).toEqual([["Question", "Answer"]]);
  });

  it("drops rows that are entirely empty", () => {
    expect(parseCsv("a,b\n,\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
});

describe("serializeSheet", () => {
  it("labels every value with its column", () => {
    // A retrieved chunk arrives without the header row above it. "Fee:
    // 3540" survives that; a bare 3540 in column four does not.
    const text = serializeSheet({
      title: "Fees",
      headers: ["Programme", "Month", "Fee"],
      rows: [["STP", "September", "3540"]],
      truncated: false,
    });
    expect(text).toBe("Programme: STP | Month: September | Fee: 3540");
  });

  it("skips empty cells rather than printing bare labels", () => {
    const text = serializeSheet({
      title: null,
      headers: ["A", "B"],
      rows: [["x", "   "]],
      truncated: false,
    });
    expect(text).toBe("A: x");
  });

  it("names an unnamed column instead of losing the value", () => {
    const text = serializeSheet({
      title: null,
      headers: ["A", ""],
      rows: [["x", "y"]],
      truncated: false,
    });
    expect(text).toContain("Column 2: y");
  });

  it("puts the account's own description first", () => {
    const text = serializeSheet(
      { title: null, headers: ["A"], rows: [["x"]], truncated: false },
      "2026 fee structure",
    );
    expect(text.startsWith("2026 fee structure")).toBe(true);
  });

  it("admits when rows were cut", () => {
    const text = serializeSheet({
      title: null,
      headers: ["A"],
      rows: [["x"]],
      truncated: true,
    });
    expect(text).toMatch(/only the first .* rows/i);
  });
});

describe("fetchSheet", () => {
  afterEach(() => vi.unstubAllGlobals());

  function respond(body: string, headers: Record<string, string>, status = 200) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status, headers })),
    );
  }

  // The failure the whole module exists to catch. Google answers an
  // unshared sheet with 200 and a sign-in page; stored as knowledge,
  // that HTML gets quoted at customers forever.
  it("refuses Google's sign-in page instead of storing it as knowledge", async () => {
    respond("<html><body>Sign in</body></html>", { "content-type": "text/html; charset=utf-8" });
    await expect(fetchSheet("https://docs.google.com/spreadsheets/d/1AbC")).rejects.toThrow(
      /not shared/i,
    );
  });

  it("reads a shared sheet into headers and rows", async () => {
    respond("Question,Answer\nWhat are the fees?,3540\n", {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="Fees 2026.csv"',
    });
    const sheet = await fetchSheet("https://docs.google.com/spreadsheets/d/1AbC");
    expect(sheet.headers).toEqual(["Question", "Answer"]);
    expect(sheet.rows).toEqual([["What are the fees?", "3540"]]);
    expect(sheet.title).toBe("Fees 2026");
  });

  it("says the sheet is gone rather than returning nothing", async () => {
    respond("", { "content-type": "text/html" }, 404);
    await expect(fetchSheet("https://docs.google.com/spreadsheets/d/1AbC")).rejects.toThrow(
      /no sheet with that link/i,
    );
  });

  it("rejects an empty sheet explicitly", async () => {
    respond("", { "content-type": "text/csv" });
    await expect(fetchSheet("https://docs.google.com/spreadsheets/d/1AbC")).rejects.toThrow(
      /empty/i,
    );
  });
});
