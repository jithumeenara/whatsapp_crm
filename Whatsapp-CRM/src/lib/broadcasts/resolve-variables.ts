/**
 * Pure, directive-free utility — safe to import from both server and client.
 * Kept separate from the 'use client' hook so API routes can import it
 * without pulling React/next-auth into the server bundle.
 */

export type VariableMapping =
  | { type: "static"; value: string }
  | { type: "field"; value: string }
  | { type: "custom_field"; value: string }
  /**
   * Pulls the value from a Data Store table (the custom-tables module,
   * distinct from the simpler per-contact `custom_field`s above). Each
   * recipient's own record is found by matching `match_field_key` in
   * that table against their Contact `match_contact_field` (phone/email/
   * name), then `value` (a field_key in the same table) is read out.
   * Resolution happens per-recipient in run-broadcast.ts via a
   * pre-built index (see resolve-data-store.ts) — this module stays a
   * pure string-in/string-out mapper and never touches the DB itself.
   */
  | {
      type: "data_store";
      value: string; // field_key to read as the variable's value
      table_id: string;
      match_field_key: string;
      match_contact_field: "phone" | "email" | "name";
    };

export function resolveVariables(
  variables: Record<string, VariableMapping>,
  contact: {
    name?: string | null;
    phone?: string | null;
    email?: string | null;
    company?: string | null;
  },
  customValues?: Record<string, string>,
  /** Pre-resolved data_store values for THIS contact, keyed by the same
   *  placeholder key as `variables` (e.g. "1", "2"). Built once per
   *  broadcast by resolve-data-store.ts's buildDataStoreIndex(). */
  dataStoreValues?: Record<string, string>,
): string[] {
  const keys = Object.keys(variables).sort((a, b) => {
    const an = Number(a);
    const bn = Number(b);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return a.localeCompare(b);
  });

  return keys.map((key) => {
    const v = variables[key];
    if (v.type === "static") return v.value;
    if (v.type === "field") {
      const fieldMap: Record<string, string | undefined | null> = {
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        company: contact.company,
      };
      return fieldMap[v.value] ?? "";
    }
    if (v.type === "data_store") {
      return dataStoreValues?.[key] ?? "";
    }
    return customValues?.[v.value] ?? "";
  });
}
