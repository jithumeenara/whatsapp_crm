import { describe, it, expect } from "vitest";

import { estimateCostUsd, estimateCloudTtsCostUsd } from "./usage";

/**
 * What a call is recorded as costing.
 *
 * This is the page an account opens to understand a bill, so a number
 * that is quietly zero is worse than no page at all — it says the thing
 * is free. Both cases below said exactly that about voice, which is the
 * most expensive output this app produces.
 */

describe("estimateCostUsd", () => {
  it("prices the most specific model, not the first one that happens to match", () => {
    // "gemini-3.5-flash-transcribe" sat after "gemini-3.5-flash" in the
    // table, so every transcription was priced as ordinary chat. The
    // lookup now takes the longest matching prefix rather than trusting
    // whoever edits the list to keep it in order.
    const tokens = { inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000 };
    expect(estimateCostUsd("gemini-3.5-flash-transcribe", tokens)).toBeCloseTo(0.1, 6);
    expect(estimateCostUsd("gemini-3.5-flash", tokens)).toBeCloseTo(0.15, 6);
    expect(estimateCostUsd("gemini-3.5-flash-lite", tokens)).toBeCloseTo(0.05, 6);
  });

  it("prices audio output well above text, which is the point of showing it", () => {
    const out = { inputTokens: 0, outputTokens: 1_000_000, totalTokens: 1_000_000 };
    expect(estimateCostUsd("gemini-3.1-flash-tts", out)).toBeCloseTo(10, 6);
    expect(estimateCostUsd("gemini-3.6-flash", out)).toBeCloseTo(0.6, 6);
  });

  it("falls back to a family rate rather than to zero", () => {
    // A model id this table has never seen must not report as free.
    const tokens = { inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000 };
    expect(estimateCostUsd("gemini-4.2-flash-something", tokens)).toBeGreaterThan(0);
  });
});

describe("estimateCloudTtsCostUsd", () => {
  it("charges per character, which is how Google charges", () => {
    // Chirp3-HD, $30 per million characters.
    expect(estimateCloudTtsCostUsd(1_000_000)).toBeCloseTo(30, 6);
    expect(estimateCloudTtsCostUsd(500)).toBeCloseTo(0.015, 6);
  });

  it("keeps enough precision that one reply is not rounded away", () => {
    // A 200-character voice note costs $0.006. Rounded to cents it is
    // nothing, and a thousand of them are six dollars nobody can see.
    expect(estimateCloudTtsCostUsd(200)).toBeGreaterThan(0);
  });

  it("is zero for nothing, not negative for nonsense", () => {
    expect(estimateCloudTtsCostUsd(0)).toBe(0);
    expect(estimateCloudTtsCostUsd(-5)).toBe(0);
  });
});
