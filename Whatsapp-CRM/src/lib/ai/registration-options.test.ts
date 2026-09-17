import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * What the assistant is allowed to write into a dropdown.
 *
 * From a live test. This account's Training table holds one scheduled
 * programme; its knowledge documents list every *type* of programme the
 * institute runs. Asked to register, the assistant offered a Ministerial
 * Staff batch that exists in a brochure and not in the schedule, and
 * started collecting details for it. The office would have received a
 * registration for a batch that was never running.
 *
 * Two things let that happen. The options reader only understood the
 * legacy array shape, so a modern `select` field arrived with no options
 * at all and nothing to validate against. And a field whose options come
 * from another table was not read at all — which is the shape that makes
 * this correct for any business, since it is the difference between "a
 * programme we run" and "a programme we are running".
 */

const h = vi.hoisted(() => ({
  state: {
    tables: [] as Record<string, unknown>[],
    records: {} as Record<string, Array<Record<string, unknown>>>,
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    dataTable: { findMany: () => Promise.resolve(h.state.tables) },
    dataRecord: {
      findMany: (args: { where: { table_id: string } }) =>
        Promise.resolve(h.state.records[args.where.table_id] ?? []),
    },
  },
}));

import { listRegistrationForms, invalidateRegistrationForms } from "./registration";

const ACCOUNT = "acct-1";

function form(programmeField: Record<string, unknown>) {
  return {
    id: "reg",
    name: "Training Registration",
    slug: "training-registration",
    description: null,
    ai_unique_by: [],
    ai_capacity_by: [],
    ai_capacity_limit: null,
    fields: [
      { field_key: "participant", label: "Name", field_type: "text", required: true, options: null },
      programmeField,
    ],
  };
}

const programmeOptions = async () => {
  const [f] = await listRegistrationForms(ACCOUNT);
  return [...f.required_fields, ...f.optional_fields].find((x) => x.key === "programme")?.options;
};

beforeEach(() => {
  invalidateRegistrationForms(ACCOUNT);
  h.state.tables = [];
  h.state.records = {};
});

describe("listRegistrationForms — what a dropdown will accept", () => {
  it("reads options written the modern way", async () => {
    // A select field saved any time in the last year stores a
    // FieldConfig object, not a bare array. Reading only the array shape
    // left the field with no options and the assistant free to invent.
    h.state.tables = [
      form({
        field_key: "programme",
        label: "Training Programme",
        field_type: "select",
        required: true,
        options: { select_items: [{ label: "STP", value: "stp" }] },
      }),
    ];
    expect(await programmeOptions()).toEqual(["STP"]);
  });

  it("still reads the legacy array shape", async () => {
    h.state.tables = [
      form({
        field_key: "programme",
        label: "Training Programme",
        field_type: "select",
        required: true,
        options: [{ label: "STP", value: "stp" }],
      }),
    ];
    expect(await programmeOptions()).toEqual(["STP"]);
  });

  it("takes the options from another table when that is where they live", async () => {
    // The fix that matters: only what is actually scheduled.
    h.state.tables = [
      form({
        field_key: "programme",
        label: "Training Programme",
        field_type: "select",
        required: true,
        options: { source_table_id: "training", source_field_key: "name_of_programme" },
      }),
    ];
    h.state.records = {
      training: [
        { data: { name_of_programme: "Statutory Training Programme (STP)" } },
        { data: { name_of_programme: "Statutory Training Programme (STP)" } },
        { data: { name_of_programme: "Basic Banking" } },
      ],
    };
    // Each value once, however many rows carry it.
    expect(await programmeOptions()).toEqual([
      "Statutory Training Programme (STP)",
      "Basic Banking",
    ]);
  });

  it("leaves the field open rather than refusing everything when the source is empty", async () => {
    // An empty list would reject every answer. A table nobody has filled
    // in yet is a configuration problem, not a reason to make
    // registration impossible.
    h.state.tables = [
      form({
        field_key: "programme",
        label: "Training Programme",
        field_type: "select",
        required: true,
        options: { source_table_id: "training", source_field_key: "name_of_programme" },
      }),
    ];
    h.state.records = { training: [] };
    expect(await programmeOptions()).toBeUndefined();
  });

  it("prefers options written by hand over the table they could come from", async () => {
    h.state.tables = [
      form({
        field_key: "programme",
        label: "Training Programme",
        field_type: "select",
        required: true,
        options: {
          select_items: [{ label: "Only this", value: "only" }],
          source_table_id: "training",
          source_field_key: "name_of_programme",
        },
      }),
    ];
    h.state.records = { training: [{ data: { name_of_programme: "Something else" } }] };
    expect(await programmeOptions()).toEqual(["Only this"]);
  });
});
