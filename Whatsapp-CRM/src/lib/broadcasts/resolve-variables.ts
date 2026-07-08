/**
 * Pure, directive-free utility — safe to import from both server and client.
 * Kept separate from the 'use client' hook so API routes can import it
 * without pulling React/next-auth into the server bundle.
 */

export type VariableMapping =
  | { type: "static"; value: string }
  | { type: "field"; value: string }
  | { type: "custom_field"; value: string };

export function resolveVariables(
  variables: Record<string, VariableMapping>,
  contact: {
    name?: string | null;
    phone?: string | null;
    email?: string | null;
    company?: string | null;
  },
  customValues?: Record<string, string>,
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
    return customValues?.[v.value] ?? "";
  });
}
