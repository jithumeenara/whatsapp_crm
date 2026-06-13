import { prisma } from "@/lib/db";
import { normalizePhone, phonesMatch } from "@/lib/whatsapp/phone-utils";

export function normalizeKey(phone: string): string {
  return normalizePhone(phone);
}

export interface ExistingContact {
  id: string;
  phone: string;
  name?: string | null;
  [key: string]: unknown;
}

export async function findExistingContact(
  accountId: string,
  phone: string,
): Promise<ExistingContact | null> {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const suffix = normalized.length >= 8 ? normalized.slice(-8) : normalized;

  const candidates = await prisma.contact.findMany({
    where: {
      account_id: accountId,
      phone: { endsWith: suffix },
    },
  });

  return candidates.find((c) => phonesMatch(c.phone, phone)) ?? null;
}

export function isExactMatch(existing: ExistingContact, phone: string): boolean {
  return normalizeKey(existing.phone) === normalizeKey(phone);
}

export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  // Prisma unique constraint violation code
  const e = error as { code?: string };
  return e.code === "P2002";
}

export function dedupeByPhone<T extends { phone: string }>(
  rows: T[],
): { unique: T[]; duplicates: number } {
  const seen = new Set<string>();
  const unique: T[] = [];
  let duplicates = 0;

  for (const row of rows) {
    const key = normalizeKey(row.phone);
    if (!key) {
      duplicates++;
      continue;
    }
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    unique.push(row);
  }

  return { unique, duplicates };
}
