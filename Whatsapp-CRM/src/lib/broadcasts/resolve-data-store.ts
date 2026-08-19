import { prisma } from "@/lib/db";
import type { VariableMapping } from "./resolve-variables";

interface ContactLite {
  id: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
}

type DataStoreMapping = Extract<VariableMapping, { type: "data_store" }>;

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

function contactMatchValue(contact: ContactLite, field: "phone" | "email" | "name"): string {
  const v = contact[field];
  return v ? String(v).trim().toLowerCase() : "";
}

/**
 * Pre-resolves every `data_store`-mapped variable for a batch of
 * recipients, in one pass per referenced table (not one query per
 * recipient). Returns contactId -> { placeholderKey -> value }, meant
 * to be fed into resolveVariables()'s `dataStoreValues` param per
 * recipient inside run-broadcast.ts's send loop.
 *
 * Matching: a Data Store record "belongs" to a contact when the
 * record's `match_field_key` value equals the contact's
 * `match_contact_field` (phone/email/name) — case-insensitively, and
 * for phone additionally by digits-only comparison so "+91 98765"
 * matches "919876543210".
 */
export async function buildDataStoreIndex(
  variables: Record<string, VariableMapping>,
  contacts: ContactLite[],
): Promise<Record<string, Record<string, string>>> {
  const dataStoreEntries = Object.entries(variables).filter(
    (e): e is [string, DataStoreMapping] => e[1].type === "data_store",
  );
  if (dataStoreEntries.length === 0 || contacts.length === 0) return {};

  const tableIds = [...new Set(dataStoreEntries.map(([, m]) => m.table_id))];
  const recordsByTable: Record<string, { data: Record<string, unknown> }[]> = {};
  await Promise.all(
    tableIds.map(async (tableId) => {
      const records = await prisma.dataRecord.findMany({
        where: { table_id: tableId },
        select: { data: true },
        take: 5000,
      });
      recordsByTable[tableId] = records as { data: Record<string, unknown> }[];
    }),
  );

  const index: Record<string, Record<string, string>> = {};
  for (const contact of contacts) {
    const perContact: Record<string, string> = {};
    for (const [key, mapping] of dataStoreEntries) {
      const records = recordsByTable[mapping.table_id] ?? [];
      const matchVal = contactMatchValue(contact, mapping.match_contact_field);
      if (!matchVal) continue;
      const matchDigits = mapping.match_contact_field === "phone" ? digitsOnly(matchVal) : "";

      const record = records.find((r) => {
        const raw = r.data?.[mapping.match_field_key];
        if (raw == null) return false;
        const rawStr = String(raw).trim().toLowerCase();
        if (rawStr === matchVal) return true;
        if (matchDigits && digitsOnly(rawStr) === matchDigits) return true;
        return false;
      });

      if (record) {
        const val = record.data?.[mapping.value];
        if (val != null && String(val).trim()) perContact[key] = String(val);
      }
    }
    if (Object.keys(perContact).length > 0) index[contact.id] = perContact;
  }
  return index;
}
