import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * When a PDF is read by its text layer and when it is read by eye.
 *
 * The order is the point. A text layer is the document's own characters
 * and is exact; OCR is a model's reading of a photograph, and a model
 * reading a photograph of a fee table can misread a digit. So anything
 * with real text must keep using its real text, and OCR must be reached
 * only when there is nothing else — never as a preference, never as a
 * silent upgrade.
 *
 * The other half is the refusal. A scan that cannot be read has to say
 * so; what it must never do is return a few characters of header and
 * have them stored as though they were the Act.
 */

const h = vi.hoisted(() => ({
  state: {
    /** What the fake pdf.js finds in the text layer. */
    layer: "",
    /** What the fake Gemini reads off the pages. */
    ocr: "",
    ocrCalls: 0,
    ocrThrows: null as string | null,
    openThrows: false,
  },
}));

vi.mock("unpdf", () => ({
  getDocumentProxy: () => {
    if (h.state.openThrows) return Promise.reject(new Error("bad header"));
    return Promise.resolve({});
  },
  extractText: () => Promise.resolve({ text: h.state.layer }),
}));

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {
        generateContent: () => {
          h.state.ocrCalls += 1;
          if (h.state.ocrThrows) return Promise.reject(new Error(h.state.ocrThrows));
          return Promise.resolve({
            response: { text: () => h.state.ocr, usageMetadata: undefined },
          });
        },
      };
    }
  },
}));

vi.mock("./usage", () => ({ recordAiUsage: () => Promise.resolve() }));

import { readPdf, looksLikePdf, normalizePdfText } from "./pdf-extract";

const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
const REAL_TEXT = "The Kerala Co-operative Societies Act, 1969. ".repeat(20);

beforeEach(() => {
  h.state.layer = "";
  h.state.ocr = "";
  h.state.ocrCalls = 0;
  h.state.ocrThrows = null;
  h.state.openThrows = false;
});

describe("readPdf", () => {
  it("uses the text layer and does not call the model at all", async () => {
    h.state.layer = REAL_TEXT;
    const result = await readPdf(BYTES, { geminiApiKey: "key" });
    expect(result.ocrUsed).toBe(false);
    expect(result.text).toContain("Co-operative Societies Act");
    // The saving is incidental; the correctness is not. Exact characters
    // beat a careful reading every time.
    expect(h.state.ocrCalls).toBe(0);
  });

  it("reads the pages when there is no text layer", async () => {
    h.state.layer = "";
    h.state.ocr = REAL_TEXT;
    const result = await readPdf(BYTES, { geminiApiKey: "key" });
    expect(result.ocrUsed).toBe(true);
    expect(h.state.ocrCalls).toBe(1);
  });

  it("treats a page number as no text layer at all", async () => {
    // A scan often carries a handful of characters — a page number, a
    // header baked into the template. Storing those as the document
    // would be worse than storing nothing.
    h.state.layer = "Page 1 of 60";
    h.state.ocr = REAL_TEXT;
    const result = await readPdf(BYTES, { geminiApiKey: "key" });
    expect(result.ocrUsed).toBe(true);
    expect(result.text).toContain("Co-operative Societies Act");
  });

  it("says what can be done about it when no key is saved", async () => {
    h.state.layer = "";
    await expect(readPdf(BYTES, {})).rejects.toThrow(/Gemini key/);
    expect(h.state.ocrCalls).toBe(0);
  });

  it("lets the OCR failure through rather than storing an empty entry", async () => {
    h.state.layer = "";
    h.state.ocrThrows = "RESOURCE_EXHAUSTED: quota exceeded";
    await expect(readPdf(BYTES, { geminiApiKey: "key" })).rejects.toThrow(/quota/);
  });

  it("refuses a scan that read back as nothing", async () => {
    h.state.layer = "";
    h.state.ocr = "   ";
    await expect(readPdf(BYTES, { geminiApiKey: "key" })).rejects.toThrow(/blank or too faint/);
  });

  it("explains a PDF that will not open, instead of failing obscurely", async () => {
    h.state.openThrows = true;
    await expect(readPdf(BYTES, { geminiApiKey: "key" })).rejects.toThrow(/corrupted or password-protected/);
  });
});

describe("looksLikePdf", () => {
  it("recognises one by its content type", () => {
    expect(looksLikePdf("https://example.com/download?id=7", "application/pdf")).toBe(true);
    expect(looksLikePdf("https://example.com/x", "application/pdf; charset=binary")).toBe(true);
  });

  it("recognises one by its extension, since servers mislabel them", () => {
    // Plenty of sites serve a PDF as application/octet-stream. Reading
    // that as a web page is what put binary noise into a knowledge base.
    expect(
      looksLikePdf(
        "https://cooperation.kerala.gov.in/wp-content/uploads/2023/08/KCS-ACT_1969.pdf",
        "application/octet-stream",
      ),
    ).toBe(true);
    expect(looksLikePdf("https://example.com/a.PDF?v=2", "")).toBe(true);
  });

  it("leaves an ordinary page alone", () => {
    expect(looksLikePdf("https://example.com/about", "text/html")).toBe(false);
    expect(looksLikePdf("https://example.com/pdf-guide", "text/html")).toBe(false);
  });
});

describe("normalizePdfText", () => {
  it("rejoins lines broken mid-sentence but keeps paragraph breaks", () => {
    // The chunker splits on blank lines, so those have to survive while
    // pdf.js's per-item breaks do not.
    expect(normalizePdfText("one\ntwo\n\nthree")).toBe("one two\n\nthree");
    expect(normalizePdfText("a\n\n\n\nb")).toBe("a\n\nb");
  });
});
