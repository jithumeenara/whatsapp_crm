export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'email'
  | 'password'
  | 'phone'
  | 'url'
  | 'date'
  | 'time'
  | 'datetime'
  | 'boolean'
  | 'select'
  | 'multiselect'
  | 'radio'
  | 'country'
  | 'state'
  | 'district'
  | 'address'
  | 'relation'
  | 'file'
  | 'image'
  | 'signature'
  | 'hidden'
  | 'section_header'
  | 'html_block'

export interface SelectOption {
  label: string
  value: string
  color?: string
}

export interface FieldValidation {
  min?: number
  max?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  custom_message?: string
}

export interface FieldConfig {
  select_items?: SelectOption[]
  // Pull dropdown/multiselect/radio options from a live table field instead of manual list
  source_table_id?: string
  source_field_key?: string
  content?: string          // section_header description or html_block HTML
  hidden_value?: string
  placeholder?: string
  default_value?: string | boolean
  help_text?: string
  field_width?: 'full' | 'half' | 'third'
  validation?: FieldValidation
}

export interface DataField {
  id: string
  table_id: string
  label: string
  field_key: string
  field_type: FieldType
  // Legacy select fields stored SelectOption[] directly; new fields store FieldConfig object.
  options: FieldConfig | SelectOption[] | null
  relation_table_id: string | null
  relation_label_field: string | null
  required: boolean
  sort_order: number
  created_at: string
}

/** Extract select/radio/multiselect option list from options (handles legacy array format) */
export function getSelectItems(options: FieldConfig | SelectOption[] | null): SelectOption[] {
  if (!options) return []
  if (Array.isArray(options)) return options
  return options.select_items ?? []
}

/** Extract FieldConfig from options (handles legacy array format) */
export function getFieldConfig(options: FieldConfig | SelectOption[] | null): FieldConfig {
  if (!options) return {}
  if (Array.isArray(options)) return { select_items: options }
  return options
}

export interface DataTable {
  id: string
  account_id: string
  name: string
  slug: string
  icon: string
  description: string | null
  sort_order: number
  /** Whether the AI assistant may create rows here for a customer. */
  ai_can_register: boolean
  /** What the assistant says once a registration lands. Null = a plain confirmation. */
  ai_success_message: string | null
  /** Field keys that, together with the customer, make a second
   *  registration a duplicate. Empty = the same person may register
   *  as often as they like. */
  ai_unique_by?: string[]
  /** Fields "full" is counted over, and the ceiling. Null limit = no
   *  ceiling. Counted across every customer. */
  ai_capacity_by?: string[]
  ai_capacity_limit?: number | null
  created_at: string
  updated_at: string
  fields?: DataField[]
  _count?: { records: number; fields: number }
}

export interface DataRecord {
  id: string
  table_id: string
  data: Record<string, unknown>
  /** The customer who registered themselves through the assistant.
   *  Null for every row staff or an import created, which is most. */
  contact_id?: string | null
  contact?: { id: string; name: string | null; phone: string } | null
  created_at: string
  updated_at: string
}

/**
 * The field types a column can have.
 *
 * Ordered by how often they are actually picked, not by any internal
 * tidiness — "Text" and "Dropdown" account for most columns anyone
 * creates, and a list that buries them under Password and HTML Block
 * makes the common case the slowest.
 *
 * The last group is the one worth explaining. A section header and an
 * HTML block store nothing: they exist to lay out the *form* view of a
 * table, and as columns they are permanently empty. They stay available
 * because tables already use them, and they are grouped and labelled so
 * nobody reaches for one expecting somewhere to put a value.
 */
export const FIELD_TYPES: { value: FieldType; label: string; group: string }[] = [
  // The everyday ones.
  { value: 'text',          label: 'Text',           group: 'Common' },
  { value: 'select',        label: 'Dropdown',       group: 'Common' },
  { value: 'number',        label: 'Number',         group: 'Common' },
  { value: 'date',          label: 'Date',           group: 'Common' },
  { value: 'phone',         label: 'Phone',          group: 'Common' },
  { value: 'email',         label: 'Email',          group: 'Common' },
  { value: 'textarea',      label: 'Long text',      group: 'Common' },
  { value: 'boolean',       label: 'Yes / No',       group: 'Common' },

  { value: 'multiselect',   label: 'Pick several',   group: 'Choice' },
  { value: 'radio',         label: 'Radio buttons',  group: 'Choice' },

  { value: 'time',          label: 'Time',           group: 'Date & time' },
  { value: 'datetime',      label: 'Date and time',  group: 'Date & time' },

  { value: 'district',      label: 'District',       group: 'Location' },
  { value: 'state',         label: 'State / region', group: 'Location' },
  { value: 'country',       label: 'Country',        group: 'Location' },
  { value: 'address',       label: 'Address',        group: 'Location' },

  { value: 'file',          label: 'File',           group: 'Files' },
  { value: 'image',         label: 'Image',          group: 'Files' },
  { value: 'signature',     label: 'Signature',      group: 'Files' },

  { value: 'relation',      label: 'Link to another table', group: 'Advanced' },
  { value: 'url',           label: 'Web address',    group: 'Advanced' },
  { value: 'password',      label: 'Password',       group: 'Advanced' },
  { value: 'hidden',        label: 'Hidden value',   group: 'Advanced' },

  { value: 'section_header', label: 'Section heading', group: 'Layout only — stores nothing' },
  { value: 'html_block',    label: 'HTML block',      group: 'Layout only — stores nothing' },
]

export const FIELD_GROUPS = [
  'Common',
  'Choice',
  'Date & time',
  'Location',
  'Files',
  'Advanced',
  'Layout only — stores nothing',
]

export const TABLE_ICONS = [
  { value: 'database', emoji: '🗄️' },
  { value: 'users', emoji: '👥' },
  { value: 'stethoscope', emoji: '🩺' },
  { value: 'graduation', emoji: '🎓' },
  { value: 'building', emoji: '🏢' },
  { value: 'book', emoji: '📚' },
  { value: 'calendar', emoji: '📅' },
  { value: 'folder', emoji: '📁' },
  { value: 'chart', emoji: '📊' },
  { value: 'star', emoji: '⭐' },
  { value: 'heart', emoji: '❤️' },
  { value: 'clock', emoji: '🕐' },
]

export function getIconEmoji(icon: string): string {
  return TABLE_ICONS.find((i) => i.value === icon)?.emoji ?? '🗄️'
}

/** Field types that collect data (not display-only) */
export const DATA_FIELD_TYPES = new Set<FieldType>([
  'text','textarea','number','email','password','phone','url',
  'date','time','datetime','boolean','select','multiselect','radio',
  'country','state','district','address','relation','file','image',
  'signature','hidden',
])

/** Field types that use select_items options */
export const CHOICE_FIELD_TYPES = new Set<FieldType>(['select', 'multiselect', 'radio'])

/**
 * The field types the AI assistant is able to fill on a registration.
 *
 * Lives here rather than beside the registration code because both sides
 * need it: the server decides what to ask the customer for, and the
 * table's settings panel counts what will be asked. Two lists would
 * drift, and the panel would promise a question the assistant never asks.
 *
 * `relation` is deliberately absent — it points at another row by id, and
 * a model asked for one invents a plausible uuid. Layout types
 * (section_header, html_block) hold no answer, and file/signature/image
 * cannot be given over a chat message.
 */
export const AI_FILLABLE_FIELD_TYPES: ReadonlySet<string> = new Set([
  'text', 'number', 'date', 'email', 'phone', 'url', 'select',
])

export function isAiFillable(field: Pick<DataField, 'field_type'>): boolean {
  return AI_FILLABLE_FIELD_TYPES.has(field.field_type)
}
