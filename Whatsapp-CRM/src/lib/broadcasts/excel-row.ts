/**
 * Shared between the client (Step2SelectAudience's state) and the
 * server-side /api/broadcasts/parse-excel route that now does the
 * actual Excel parsing — see that route for why parsing moved server-side.
 */
export interface ExcelContactRow {
  phone: string;
  name?: string;
  tagNames?: string[];
  /** "business"/"company" column — matches Contact.company directly. */
  company?: string;
  /**
   * Any other column in the sheet, keyed by its header text. Flows into a
   * Custom Field per contact (auto-created if the name doesn't exist yet)
   * so it shows up as a "Custom Field" option in the broadcast's variable
   * mapping step — e.g. a "Doctor" or "Appointment Date" column.
   */
  customFields?: Record<string, string>;
  /** Already a contact with another name: which one it keeps. */
  nameChoice?: NameChoice;
}

/**
 * A number in the file that is already a contact: which name it keeps.
 * 'saved' (the default) keeps the CRM's; 'file' takes the file's.
 */
export type NameChoice = 'saved' | 'file';

const MAX_NAME = 100;

/** Text only, spaces tidied, at most 100 characters. */
export function cleanName(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) : '';
}

/** The file gives a name the CRM already has a different one for. */
export function nameDiffers(saved: string | null | undefined, fromFile: string | null | undefined): boolean {
  const a = cleanName(saved);
  const b = cleanName(fromFile);
  return !!a && !!b && a.toLowerCase() !== b.toLowerCase();
}

/**
 * The name to save on an existing contact, or null to leave it. A blank
 * saved name takes the file's; a different one is replaced only when the
 * person chose the file's name for that number.
 */
export function nameUpdateFor(saved: string | null | undefined, row: { name?: unknown; nameChoice?: unknown }): string | null {
  const fromFile = cleanName(row.name);
  if (!fromFile) return null;
  if (!cleanName(saved)) return fromFile;
  return nameDiffers(saved, fromFile) && row.nameChoice === 'file' ? fromFile : null;
}
