import { describe, it, expect } from "vitest";

import {
  thinkingConfigFor,
  supportsThinkingLevel,
  normalizeEffort,
  isThinkingRejection,
  DEFAULT_REASONING_EFFORT,
} from "./reasoning";

/**
 * The parameter that decides how long a customer waits.
 *
 * Worth its own test for one reason: getting it wrong is not slow, it is
 * broken. `thinkingLevel` is a Gemini 3 field, and sending it to a model
 * that does not document support is an error rather than a no-op — so an
 * account pinned to an older model would have every single reply fail,
 * which is a far worse outcome than the latency this exists to fix. The
 * model-name gate is the whole safety property, and these cases are the
 * shapes a model id actually takes.
 */

describe("supportsThinkingLevel", () => {
  it("accepts the Gemini 3 family, in both spellings Google uses", () => {
    expect(supportsThinkingLevel("gemini-3.6-flash")).toBe(true);
    expect(supportsThinkingLevel("gemini-3.8-flash")).toBe(true);
    expect(supportsThinkingLevel("gemini-3.5-flash-lite")).toBe(true);
    expect(supportsThinkingLevel("gemini-3-flash-preview")).toBe(true);
  });

  it("leaves every other model exactly as it was", () => {
    // 2.5 has thinkingBudget, a different shape, and is on its way out —
    // half-supporting it here would be worse than not touching it.
    expect(supportsThinkingLevel("gemini-2.5-flash")).toBe(false);
    expect(supportsThinkingLevel("gemini-1.5-flash")).toBe(false);
    expect(supportsThinkingLevel("gpt-4o")).toBe(false);
    expect(supportsThinkingLevel("claude-sonnet-5")).toBe(false);
    expect(supportsThinkingLevel("deepseek-chat")).toBe(false);
    expect(supportsThinkingLevel(null)).toBe(false);
    expect(supportsThinkingLevel(undefined)).toBe(false);
    expect(supportsThinkingLevel("")).toBe(false);
  });

  it("is not fooled by a name that merely starts the same way", () => {
    // 'gemini-30-…' is not the 3 series. The separator is what makes the
    // version a version.
    expect(supportsThinkingLevel("gemini-30-flash")).toBe(false);
    expect(supportsThinkingLevel("gemini-3x")).toBe(false);
  });
});

describe("thinkingConfigFor", () => {
  it("speaks Gemini's vocabulary, not ours", () => {
    expect(thinkingConfigFor("gemini-3.6-flash", "minimal")).toEqual({
      thinkingConfig: { thinkingLevel: "minimal" },
    });
    expect(thinkingConfigFor("gemini-3.6-flash", "low")).toEqual({
      thinkingConfig: { thinkingLevel: "low" },
    });
    // 'balanced' and 'thorough' are our words; Google's are medium/high.
    expect(thinkingConfigFor("gemini-3.6-flash", "balanced")).toEqual({
      thinkingConfig: { thinkingLevel: "medium" },
    });
    expect(thinkingConfigFor("gemini-3.6-flash", "thorough")).toEqual({
      thinkingConfig: { thinkingLevel: "high" },
    });
  });

  it("sends nothing at all to a model that would reject it", () => {
    expect(thinkingConfigFor("gemini-2.5-flash", "low")).toBeUndefined();
    expect(thinkingConfigFor("gpt-4o", "low")).toBeUndefined();
  });

  it("falls back to fast rather than to the provider's own default", () => {
    // An account created before this setting existed, a null column, a
    // value somebody typed by hand — all of them get the fast reply,
    // because the provider's default is the thing being corrected.
    expect(DEFAULT_REASONING_EFFORT).toBe("low");
    for (const bad of [undefined, null, "", "high", 3, {}]) {
      expect(normalizeEffort(bad)).toBe("low");
      expect(thinkingConfigFor("gemini-3.6-flash", bad)).toEqual({
        thinkingConfig: { thinkingLevel: "low" },
      });
    }
  });
});

describe("isThinkingRejection", () => {
  it("recognises the provider objecting to this parameter", () => {
    expect(
      isThinkingRejection(new Error('Invalid JSON payload received. Unknown name "thinkingLevel"')),
    ).toBe(true);
    expect(isThinkingRejection(new Error("[400 Bad Request] thinking_level is not supported"))).toBe(
      true,
    );
  });

  it("does not swallow an unrelated failure", () => {
    // A retry hides whatever it retries past. Quota, auth and safety
    // failures are all things somebody needs to be told about, so a
    // loose match here would cost more than it saved.
    expect(isThinkingRejection(new Error("RESOURCE_EXHAUSTED: quota exceeded"))).toBe(false);
    expect(isThinkingRejection(new Error("API key not valid"))).toBe(false);
    expect(isThinkingRejection(new Error("Candidate was blocked due to SAFETY"))).toBe(false);
    expect(isThinkingRejection("some string")).toBe(false);
  });
});
