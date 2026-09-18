import { describe, it, expect } from "vitest";

import {
  applyFilters,
  optionsFor,
  filterableFields,
  activeFilterCount,
  asComparableDate,
  type FilterMap,
} from "./filters";
import type { DataField, DataRecord, FieldType } from "./types";

/**
 * The behaviour worth pinning down is the cascade, because it is the
 * part that is easy to get subtly wrong in a way nobody notices: a
 * filter that constrains its own option list still *looks* right on
 * first use and then traps whoever used it, since the moment they pick
 * a value every other value disappears and they can never change their
 * mind without clearing everything.
 *
 * The fixture is a training schedule because that is the table this was
 * asked for, but nothing in the code knows that — the same assertions
 * would hold for appointments or stock, which is the actual claim being
 * tested here.
 */

let id = 0
function field(key: string, type: FieldType, extra: Partial<DataField> = {}): DataField {
  id += 1
  return {
    id: `f${id}`,
    table_id: "t1",
    label: key,
    field_key: key,
    field_type: type,
    options: null,
    relation_table_id: null,
    relation_label_field: null,
    required: false,
    sort_order: id,
    created_at: "",
    ...extra,
  }
}

function record(data: Record<string, unknown>): DataRecord {
  id += 1
  return { id: `r${id}`, table_id: "t1", data, created_at: "", updated_at: "" } as DataRecord
}

const FIELDS: DataField[] = [
  field("programme", "select"),
  field("month", "select"),
  field("from_date", "date"),
  field("seats", "number"),
  field("residential", "boolean"),
  field("notes", "textarea"),
]

const ROWS: DataRecord[] = [
  record({ programme: "stp", month: "October", from_date: "2026-10-01", seats: 30, residential: true }),
  record({ programme: "stp", month: "November", from_date: "2026-11-05", seats: 25, residential: true }),
  record({ programme: "banking", month: "October", from_date: "2026-10-20", seats: 40, residential: false }),
  record({ programme: "banking", month: "December", from_date: "2026-12-02", seats: 18, residential: false }),
]

describe("filterableFields", () => {
  it("offers a control for what can be narrowed and nothing else", () => {
    const keys = filterableFields(FIELDS).map((f) => f.field.field_key)
    expect(keys).toEqual(["programme", "month", "from_date", "seats", "residential"])
    // Free text is the search box's job; a second text box per column
    // would be a worse version of it.
    expect(keys).not.toContain("notes")
  })
})

describe("optionsFor — the cascade", () => {
  it("offers every value when nothing is chosen", () => {
    expect(optionsFor(FIELDS[1], ROWS, FIELDS, {}).map((o) => o.value)).toEqual([
      "December",
      "November",
      "October",
    ])
  })

  it("narrows the other fields once one is chosen", () => {
    const filters: FilterMap = { programme: { kind: "choice", value: "stp" } }
    expect(optionsFor(FIELDS[1], ROWS, FIELDS, filters).map((o) => o.value)).toEqual([
      "November",
      "October",
    ])
  })

  it("does not narrow its own list, so a choice can be changed", () => {
    // The whole trap this guards against: if picking "stp" left the
    // programme dropdown offering only "stp", switching to banking would
    // mean clearing every filter first.
    const filters: FilterMap = { programme: { kind: "choice", value: "stp" } }
    expect(optionsFor(FIELDS[0], ROWS, FIELDS, filters).map((o) => o.value)).toEqual([
      "banking",
      "stp",
    ])
  })

  it("counts what each choice would leave, so nothing is a guess", () => {
    const october = optionsFor(FIELDS[1], ROWS, FIELDS, {}).find((o) => o.value === "October")
    expect(october?.count).toBe(2)
  })

  it("keeps a chosen value visible even when nothing else selects it", () => {
    // Reachable through a date range that excludes the chosen month. The
    // option showing (0) is honest; the option vanishing would look like
    // the app had forgotten what was picked.
    const filters: FilterMap = {
      month: { kind: "choice", value: "December" },
      from_date: { kind: "range", from: "2026-10-01", to: "2026-10-31" },
    }
    const values = optionsFor(FIELDS[1], ROWS, FIELDS, filters)
    expect(values.find((o) => o.value === "December")).toEqual({
      value: "December",
      label: "December",
      count: 0,
    })
  })

  it("shows a configured label rather than the stored id", () => {
    const labelled = field("programme", "select", {
      options: { select_items: [{ label: "Statutory Training Programme", value: "stp" }] },
    })
    const fields = [labelled, ...FIELDS.slice(1)]
    // Sorted by the label the reader sees, not by the id underneath it.
    expect(optionsFor(labelled, ROWS, fields, {}).map((o) => o.label)).toEqual([
      "banking",
      "Statutory Training Programme",
    ])
  })
})

describe("applyFilters", () => {
  it("combines filters, narrowing with each one", () => {
    const filters: FilterMap = {
      programme: { kind: "choice", value: "stp" },
      month: { kind: "choice", value: "October" },
    }
    const out = applyFilters(ROWS, FIELDS, filters)
    expect(out).toHaveLength(1)
    expect(out[0].data.from_date).toBe("2026-10-01")
  })

  it("filters a date range inclusively at both ends", () => {
    const filters: FilterMap = { from_date: { kind: "range", from: "2026-10-01", to: "2026-11-05" } }
    expect(applyFilters(ROWS, FIELDS, filters)).toHaveLength(3)
  })

  it("filters a number range", () => {
    const filters: FilterMap = { seats: { kind: "range", from: "25", to: "" } }
    expect(applyFilters(ROWS, FIELDS, filters).map((r) => r.data.seats)).toEqual([30, 25, 40])
  })

  it("treats a range with both ends blank as no filter at all", () => {
    const filters: FilterMap = { seats: { kind: "range", from: "", to: "" } }
    expect(applyFilters(ROWS, FIELDS, filters)).toHaveLength(4)
    expect(activeFilterCount(filters)).toBe(0)
  })

  it("filters a yes/no field", () => {
    expect(
      applyFilters(ROWS, FIELDS, { residential: { kind: "bool", value: "no" } }),
    ).toHaveLength(2)
  })

  it("matches a multiselect cell on any one of its values", () => {
    const tags = field("tags", "multiselect")
    const rows = [record({ tags: ["evening", "online"] }), record({ tags: ["online"] })]
    expect(applyFilters(rows, [tags], { tags: { kind: "choice", value: "evening" } })).toHaveLength(1)
    expect(applyFilters(rows, [tags], { tags: { kind: "choice", value: "online" } })).toHaveLength(2)
  })

  it("ignores a filter whose field has been deleted, rather than hiding everything", () => {
    const filters: FilterMap = { gone: { kind: "choice", value: "x" } }
    expect(applyFilters(ROWS, FIELDS, filters)).toHaveLength(4)
  })
})

describe("asComparableDate", () => {
  it("reads the three shapes a date cell is actually stored in", () => {
    expect(asComparableDate("2026-10-01")).toBe("2026-10-01")
    expect(asComparableDate("2026-10-01T09:30:00.000Z")).toMatch(/^2026-(09|10)-/)
    // A unix timestamp, which is what an Excel import leaves behind.
    expect(asComparableDate(String(Math.floor(Date.UTC(2026, 9, 1, 12) / 1000)))).toBe("2026-10-01")
  })

  it("is null for anything it cannot order", () => {
    expect(asComparableDate("")).toBeNull()
    expect(asComparableDate(null)).toBeNull()
    expect(asComparableDate("not a date")).toBeNull()
  })
})
