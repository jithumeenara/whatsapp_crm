import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSharedActivity, writeSharedActivity } from "./shared-activity";

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

describe("shared idle clock", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: fakeStorage() });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is empty until a tab writes it", () => {
    expect(readSharedActivity(1_000_000)).toBe(0);
  });

  it("reads back what another tab wrote", () => {
    writeSharedActivity(999_000);
    expect(readSharedActivity(1_000_000)).toBe(999_000);
  });

  it("does not believe a time from the future", () => {
    writeSharedActivity(1_000_000 + 60_000);
    expect(readSharedActivity(1_000_000)).toBe(0);
  });

  it("does not believe something that is not a time", () => {
    window.localStorage.setItem("crm.last-activity", "forever");
    expect(readSharedActivity(1_000_000)).toBe(0);
  });

  it("falls back to nothing when storage is blocked", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => { throw new Error("blocked"); },
        setItem: () => { throw new Error("blocked"); },
      },
    });
    expect(() => writeSharedActivity(999_000)).not.toThrow();
    expect(readSharedActivity(1_000_000)).toBe(0);
  });
});
