import { describe, it, expect } from "vitest";

import {
  NAV_ITEMS,
  NAV_SECTIONS,
  DEFAULT_QUICK_LINKS,
  MAX_QUICK_LINKS,
  navItemFor,
  sanitizeQuickLinks,
  isDataTableHref,
  dataTableIdOf,
  dataTableNavItem,
} from "./sections";

/**
 * The one list of where this app can go.
 *
 * It is read by three things now — the sidebar, the dashboard's quick
 * links, and the Profile screen that chooses them — and the value of a
 * shared list is entirely in it staying coherent. A stored shortcut to a
 * page that was removed is a row that goes nowhere, which is the one
 * outcome worth a test.
 */

describe("the navigation catalogue", () => {
  it("has no duplicate destinations", () => {
    const hrefs = NAV_ITEMS.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("gives every item a label and an icon", () => {
    for (const item of NAV_ITEMS) {
      expect(item.label.trim()).not.toBe("");
      expect(item.icon).toBeTruthy();
    }
  });

  it("defaults to destinations that actually exist", () => {
    for (const href of DEFAULT_QUICK_LINKS) {
      expect(navItemFor(href), `${href} is not in the navigation`).toBeTruthy();
    }
    expect(DEFAULT_QUICK_LINKS.length).toBeLessThanOrEqual(MAX_QUICK_LINKS);
  });

  it("covers every section with at least one item", () => {
    for (const section of NAV_SECTIONS) {
      expect(section.items.length).toBeGreaterThan(0);
    }
  });
});

describe("sanitizeQuickLinks", () => {
  it("keeps real links in the order given", () => {
    expect(sanitizeQuickLinks(["/leads", "/inbox"])).toEqual(["/leads", "/inbox"]);
  });

  it("drops a link to a page that no longer exists", () => {
    // The failure this guards: a shortcut saved before a page was
    // removed, rendering as a row that goes nowhere.
    expect(sanitizeQuickLinks(["/inbox", "/a-page-we-deleted"])).toEqual(["/inbox"]);
  });

  it("drops duplicates rather than showing one twice", () => {
    expect(sanitizeQuickLinks(["/inbox", "/inbox", "/leads"])).toEqual(["/inbox", "/leads"]);
  });

  it("caps the list, because past six it is not a shortcut", () => {
    const everything = NAV_ITEMS.map((i) => i.href);
    expect(everything.length).toBeGreaterThan(MAX_QUICK_LINKS);
    expect(sanitizeQuickLinks(everything)).toHaveLength(MAX_QUICK_LINKS);
  });

  it("survives anything a request body might carry", () => {
    expect(sanitizeQuickLinks(null)).toEqual([]);
    expect(sanitizeQuickLinks("/inbox")).toEqual([]);
    expect(sanitizeQuickLinks([1, null, {}, "/inbox"])).toEqual(["/inbox"]);
  });
});

/**
 * Data Store tables as quick links.
 *
 * A table is what somebody actually wants on a dashboard — "Training
 * Registration", not "Data Store", which is only the cupboard it sits
 * in. Tables belong to the account rather than to the app, so they
 * cannot be in the catalogue and the shape has to be trusted instead;
 * these pin down how far that trust goes.
 */
describe("Data Store table links", () => {
  const TABLE = "/data/11d2f48d-203f-4986-90d1-d0b20e7cee30";

  it("recognises a table link", () => {
    expect(isDataTableHref(TABLE)).toBe(true);
    expect(dataTableIdOf(TABLE)).toBe("11d2f48d-203f-4986-90d1-d0b20e7cee30");
  });

  it("keeps one through sanitising, alongside ordinary pages", () => {
    expect(sanitizeQuickLinks(["/inbox", TABLE])).toEqual(["/inbox", TABLE]);
  });

  it("is a uuid or it is nothing", () => {
    // The shape is all that is checked here, so it has to be checked
    // exactly. /data/../../something must never pass for a table.
    expect(isDataTableHref("/data/not-a-uuid")).toBe(false);
    expect(isDataTableHref("/data/../admin")).toBe(false);
    expect(isDataTableHref("/data")).toBe(false);
    expect(isDataTableHref(`${TABLE}/edit`)).toBe(false);
    expect(sanitizeQuickLinks(["/data/whatever"])).toEqual([]);
  });

  it("renders as a normal quick link", () => {
    const item = dataTableNavItem("11d2f48d-203f-4986-90d1-d0b20e7cee30", "Training Registration");
    expect(item.href).toBe(TABLE);
    expect(item.label).toBe("Training Registration");
    expect(item.icon).toBeTruthy();
    // Data Store is not an agent's section, and one of its tables is not
    // either.
    expect(item.agentAllowed).toBe(false);
  });
});
