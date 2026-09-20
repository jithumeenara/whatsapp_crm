import { describe, it, expect } from "vitest";

import {
  estimateCostUsd,
  estimateCloudTtsCostUsd,
  priceFor,
  isLooselyPriced,
  PRICES_CHECKED_ON,
} from "./usage";

/**
 * What a call is recorded as costing.
 *
 * This is the page an account opens to understand a bill, so a number
 * that is quietly wrong is worse than no page at all. It has been wrong
 * twice in two different ways, and there is a test below for each:
 * once by being zero for voice, and once by being five to twenty times
 * under on every model at once.
 *
 * The figures asserted here are quoted from ai.google.dev, paid tier,
 * and checked on PRICES_CHECKED_ON. When Google changes them these
 * tests are supposed to fail — that is the point of pinning them.
 */

const ONE_M_IN = { inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000 };
const ONE_M_OUT = { inputTokens: 0, outputTokens: 1_000_000, totalTokens: 1_000_000 };

/** Inside the promotional window, and after it. */
const DECEMBER = new Date("2026-12-31T23:00:00Z");
const JANUARY = new Date("2027-01-01T00:00:00Z");

describe("estimateCostUsd", () => {
  it("matches Google's published rates", () => {
    expect(estimateCostUsd("gemini-3.5-flash", ONE_M_IN, DECEMBER)).toBeCloseTo(1.5, 6);
    expect(estimateCostUsd("gemini-3.5-flash", ONE_M_OUT, DECEMBER)).toBeCloseTo(9.0, 6);
    expect(estimateCostUsd("gemini-3.5-flash-lite", ONE_M_IN, DECEMBER)).toBeCloseTo(0.3, 6);
    expect(estimateCostUsd("gemini-3.5-flash-lite", ONE_M_OUT, DECEMBER)).toBeCloseTo(2.5, 6);
  });

  it("prices the most specific model, not the first one that happens to match", () => {
    // Flash-Lite must beat Flash, which must beat the bare family row.
    expect(estimateCostUsd("gemini-3.5-flash-lite", ONE_M_IN, DECEMBER)).toBeCloseTo(0.3, 6);
    expect(estimateCostUsd("gemini-3.5-flash", ONE_M_IN, DECEMBER)).toBeCloseTo(1.5, 6);
  });

  it("prices the transcription model that actually exists", () => {
    // The row used to be spelled "gemini-3.5-flash-transcribe", which is
    // not a model. The real id therefore matched nothing specific and
    // fell through to the chat family rate — a twentieth of the truth on
    // output — for as long as voice notes had been transcribed.
    expect(estimateCostUsd("gemini-3.5-transcribe", ONE_M_IN, DECEMBER)).toBeCloseTo(2.0, 6);
    expect(estimateCostUsd("gemini-3.5-transcribe", ONE_M_OUT, DECEMBER)).toBeCloseTo(12.0, 6);
    expect(isLooselyPriced("gemini-3.5-transcribe", DECEMBER)).toBe(false);
  });

  it("prices audio output well above text, which is the point of showing it", () => {
    expect(estimateCostUsd("gemini-3.1-flash-tts", ONE_M_OUT, DECEMBER)).toBeCloseTo(20, 6);
    expect(estimateCostUsd("gemini-2.5-flash-preview-tts", ONE_M_OUT, DECEMBER)).toBeCloseTo(10, 6);
    expect(estimateCostUsd("gemini-3.6-flash", ONE_M_OUT, DECEMBER)).toBeCloseTo(3.75, 6);
  });

  it("matches a model id that carries a suffix", () => {
    // The app sends "gemini-3.1-flash-tts-preview"; the row is the stem.
    expect(estimateCostUsd("gemini-3.1-flash-tts-preview", ONE_M_OUT, DECEMBER)).toBeCloseTo(20, 6);
  });

  it("falls back to a family rate rather than to zero", () => {
    // A model id this table has never seen must not report as free —
    // but it must also not claim to be exact.
    expect(estimateCostUsd("gemini-4.2-flash-something", ONE_M_IN, DECEMBER)).toBeGreaterThan(0);
    expect(isLooselyPriced("gemini-4.2-flash-something", DECEMBER)).toBe(true);
  });

  it("is zero, not NaN, for a model from another vendor entirely", () => {
    expect(estimateCostUsd("claude-opus-5", ONE_M_IN, DECEMBER)).toBe(0);
    expect(estimateCostUsd("", ONE_M_IN, DECEMBER)).toBe(0);
  });
});

describe("the January 2027 price rise", () => {
  // Google's page: "$0.75 through December 31, 2026. $1.50 starting
  // January 1, 2027." A flat table would have halved every estimate
  // from New Year's Day without anything noticing.
  it("uses the promotional rate before the rise", () => {
    expect(estimateCostUsd("gemini-3.6-flash", ONE_M_IN, DECEMBER)).toBeCloseTo(0.75, 6);
    expect(estimateCostUsd("gemini-3.8-flash", ONE_M_OUT, DECEMBER)).toBeCloseTo(3.75, 6);
  });

  it("doubles on the stroke of the new year", () => {
    expect(estimateCostUsd("gemini-3.6-flash", ONE_M_IN, JANUARY)).toBeCloseTo(1.5, 6);
    expect(estimateCostUsd("gemini-3.8-flash", ONE_M_OUT, JANUARY)).toBeCloseTo(7.5, 6);
    expect(estimateCostUsd("gemini-3.7-flash", ONE_M_IN, JANUARY)).toBeCloseTo(1.5, 6);
  });

  it("leaves the models that are not promotional alone", () => {
    expect(estimateCostUsd("gemini-3.5-flash", ONE_M_IN, JANUARY)).toBeCloseTo(1.5, 6);
    expect(estimateCostUsd("gemini-3.5-flash-lite", ONE_M_IN, JANUARY)).toBeCloseTo(0.3, 6);
  });

  it("prices a call at the time it happened, not the time it is read", () => {
    // A December reply keeps December's price when the Usage tab is
    // opened in February. Otherwise every historical total would move.
    const december = estimateCostUsd("gemini-3.6-flash", ONE_M_IN, DECEMBER);
    const january = estimateCostUsd("gemini-3.6-flash", ONE_M_IN, JANUARY);
    expect(january).toBeCloseTo(december * 2, 6);
  });
});

describe("saying when the figure is a guess", () => {
  it("calls an exact published rate exact", () => {
    expect(priceFor("gemini-3.6-flash", DECEMBER)?.exact).toBe(true);
    expect(priceFor("gemini-3.5-flash-lite", DECEMBER)?.exact).toBe(true);
  });

  it("admits a family fallback is not exact", () => {
    expect(priceFor("gemini-9.9-flash", DECEMBER)?.exact).toBe(false);
  });

  it("admits the embedding rate is borrowed", () => {
    // Google's pricing page no longer lists gemini-embedding-001, which
    // is the model this app embeds with. Showing embedding-2's rate is
    // the best available answer; presenting it as fact would not be.
    expect(priceFor("gemini-embedding-001", DECEMBER)?.exact).toBe(false);
    expect(estimateCostUsd("gemini-embedding-001", ONE_M_IN, DECEMBER)).toBeCloseTo(0.2, 6);
  });

  it("knows nothing about a model it has never heard of", () => {
    expect(priceFor("some-other-model")).toBeNull();
  });

  it("carries the date the rates were checked", () => {
    expect(PRICES_CHECKED_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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
