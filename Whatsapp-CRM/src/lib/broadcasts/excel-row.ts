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
}
