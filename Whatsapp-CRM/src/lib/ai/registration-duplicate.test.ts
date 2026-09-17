import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Refusing a second registration for the same thing.
 *
 * Built from a real pair of rows in this account's table: Manjula, the
 * same phone number, the same programme, registered twice. The assistant
 * had no reason not to — nothing checked.
 *
 * The part worth testing is the comparison. Those two rows recorded the
 * same programme as "Statutory Training Programme" and
 * "statutory_training_programme", and the same month as "September 2026"
 * and "september", because the fields are free text and the assistant
 * writes them differently on different days. A duplicate check that
 * compares those strictly agrees with itself and catches nothing.
 */

const h = vi.hoisted(() => ({
  state: {
    tables: [] as Record<string, unknown>[],
    records: [] as Record<string, unknown>[],
    created: [] as Record<string, unknown>[],
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    dataTable: {
      findMany: () => Promise.resolve(h.state.tables),
      findUnique: () => Promise.resolve({ ai_success_message: null }),
    },
    dataRecord: {
      findMany: () => Promise.resolve(h.state.records),
      create: (args: { data: Record<string, unknown> }) => {
        h.state.created.push(args.data);
        return Promise.resolve({ id: "new-record" });
      },
    },
  },
}));

import { REGISTRATION_TOOLS } from "./registration-tools";
import { invalidateRegistrationForms } from "./registration";

const CTX = { accountId: "acct-1", contactId: "contact-1" };

function table(uniqueBy: string[], capacity?: { by: string[]; limit: number | null }) {
  return {
    id: "t1",
    name: "Training Registration",
    slug: "training-registration",
    description: null,
    ai_unique_by: uniqueBy,
    ai_capacity_by: capacity?.by ?? [],
    ai_capacity_limit: capacity?.limit ?? null,
    fields: [
      { field_key: "participant", label: "Name of Participant", field_type: "text", required: true, options: null },
      { field_key: "programme", label: "Training Programme", field_type: "text", required: true, options: null },
      { field_key: "month", label: "Month", field_type: "text", required: false, options: null },
      { field_key: "from_date", label: "From Date", field_type: "text", required: false, options: null },
    ],
  };
}

const submit = (values: Record<string, unknown>) =>
  REGISTRATION_TOOLS.submit_registration.run({ table_id: "t1", values }, CTX) as Promise<
    Record<string, unknown>
  >;

beforeEach(() => {
  // Form definitions are cached for a minute in production, which would
  // otherwise make these tests order-dependent: the first one to run
  // decides what every later one sees.
  invalidateRegistrationForms(CTX.accountId);
  h.state.tables = [table(["programme"])];
  h.state.records = [];
  h.state.created = [];
});

describe("submit_registration — repeat registrations", () => {
  it("saves the first one", async () => {
    const result = await submit({ participant: "Manjula", programme: "Statutory Training Programme" });
    expect(result.saved).toBe(true);
    expect(h.state.created).toHaveLength(1);
  });

  it("refuses the same person for the same programme", async () => {
    h.state.records = [
      {
        id: "existing",
        data: { participant: "Manjula", programme: "Statutory Training Programme" },
        created_at: new Date("2026-09-17"),
      },
    ];
    const result = await submit({ participant: "Manjula", programme: "Statutory Training Programme" });
    expect(result.saved).toBe(false);
    expect(result.already_registered).toBe(true);
    expect(result.registration_id).toBe("existing");
    expect(h.state.created).toHaveLength(0);
  });

  it("sees through the assistant's own inconsistent spelling", async () => {
    // The actual pair of rows this was built from.
    h.state.records = [
      {
        id: "existing",
        data: { participant: "Manjula", programme: "Statutory Training Programme" },
        created_at: new Date("2026-09-17"),
      },
    ];
    const result = await submit({
      participant: "Manjula",
      programme: "statutory_training_programme",
    });
    expect(result.already_registered).toBe(true);
  });

  it("sees one date written two ways as one date", async () => {
    // The exact pair in this account's table: the assistant wrote the
    // same start date as 29/09/2026 on one row and 2026-09-29 on the
    // next. Somebody who picks "From Date" to catch repeats would
    // otherwise catch nothing.
    h.state.tables = [table(["programme", "from_date"])];
    invalidateRegistrationForms(CTX.accountId);
    h.state.records = [
      {
        id: "existing",
        data: { participant: "Manjula", programme: "STP", from_date: "29/09/2026" },
        created_at: new Date("2026-09-17"),
      },
    ];
    const result = await submit({
      participant: "Manjula",
      programme: "STP",
      from_date: "2026-09-29",
    });
    expect(result.already_registered).toBe(true);
  });

  it("still tells two different dates apart", async () => {
    h.state.tables = [table(["programme", "from_date"])];
    invalidateRegistrationForms(CTX.accountId);
    h.state.records = [
      {
        id: "existing",
        data: { participant: "Manjula", programme: "STP", from_date: "29/09/2026" },
        created_at: new Date("2026-09-17"),
      },
    ];
    const result = await submit({
      participant: "Manjula",
      programme: "STP",
      from_date: "2026-12-01",
    });
    expect(result.saved).toBe(true);
  });

  it("allows the same person on a different programme", async () => {
    h.state.records = [
      {
        id: "existing",
        data: { participant: "Manjula", programme: "Statutory Training Programme" },
        created_at: new Date("2026-09-17"),
      },
    ];
    const result = await submit({ participant: "Manjula", programme: "Business Development Plan" });
    expect(result.saved).toBe(true);
  });

  it("checks nothing when the account has set no rule", async () => {
    // The default, and deliberately so: turning this on for everybody
    // would start refusing registrations that are legitimate today.
    h.state.tables = [table([])];
    invalidateRegistrationForms(CTX.accountId);
    h.state.records = [
      {
        id: "existing",
        data: { participant: "Manjula", programme: "Statutory Training Programme" },
        created_at: new Date("2026-09-17"),
      },
    ];
    const result = await submit({ participant: "Manjula", programme: "Statutory Training Programme" });
    expect(result.saved).toBe(true);
  });

  it("ignores a rule naming a field that no longer exists", async () => {
    // Otherwise every row matches on "undefined equals undefined" and
    // the table refuses every registration, with no way to see why.
    h.state.tables = [table(["a_deleted_field"])];
    invalidateRegistrationForms(CTX.accountId);
    h.state.records = [
      { id: "existing", data: { participant: "Someone else" }, created_at: new Date("2026-09-17") },
    ];
    const result = await submit({ participant: "Manjula", programme: "STP" });
    expect(result.saved).toBe(true);
  });

  it("refuses once every place is taken", async () => {
    // Counted across everybody, unlike the duplicate check: a seat taken
    // by somebody else is still a seat taken, and that is the whole
    // reason this check exists separately.
    h.state.tables = [table([], { by: ["programme"], limit: 2 })];
    invalidateRegistrationForms(CTX.accountId);
    h.state.records = [
      { id: "a", data: { participant: "One", programme: "STP" }, created_at: new Date() },
      { id: "b", data: { participant: "Two", programme: "STP" }, created_at: new Date() },
    ];
    const result = await submit({ participant: "Three", programme: "STP" });
    expect(result.saved).toBe(false);
    expect(result.full).toBe(true);
    expect(result.places_taken).toBe(2);
    expect(h.state.created).toHaveLength(0);
  });

  it("lets the last place go", async () => {
    h.state.tables = [table([], { by: ["programme"], limit: 2 })];
    invalidateRegistrationForms(CTX.accountId);
    h.state.records = [
      { id: "a", data: { participant: "One", programme: "STP" }, created_at: new Date() },
    ];
    expect((await submit({ participant: "Two", programme: "STP" })).saved).toBe(true);
  });

  it("counts each programme separately", async () => {
    h.state.tables = [table([], { by: ["programme"], limit: 1 })];
    invalidateRegistrationForms(CTX.accountId);
    h.state.records = [
      { id: "a", data: { participant: "One", programme: "STP" }, created_at: new Date() },
    ];
    expect((await submit({ participant: "Two", programme: "Business Development Plan" })).saved).toBe(
      true,
    );
  });

  it("says they are already registered before it says it is full", async () => {
    // Both are true of this person; the first is the more useful thing
    // for them to hear.
    h.state.tables = [table(["programme"], { by: ["programme"], limit: 1 })];
    invalidateRegistrationForms(CTX.accountId);
    h.state.records = [
      { id: "a", data: { participant: "Manjula", programme: "STP" }, created_at: new Date() },
    ];
    const result = await submit({ participant: "Manjula", programme: "STP" });
    expect(result.already_registered).toBe(true);
    expect(result.full).toBeUndefined();
  });

  it("has no ceiling when no limit is set", async () => {
    h.state.tables = [table([], { by: ["programme"], limit: null })];
    invalidateRegistrationForms(CTX.accountId);
    h.state.records = Array.from({ length: 50 }, (_, i) => ({
      id: String(i),
      data: { participant: `P${i}`, programme: "STP" },
      created_at: new Date(),
    }));
    expect((await submit({ participant: "One more", programme: "STP" })).saved).toBe(true);
  });
});
