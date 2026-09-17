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

export const FIELD_TYPES: { value: FieldType; label: string; group: string }[] = [
  // Text
  { value: 'text',          label: 'Text',           group: 'Basic' },
  { value: 'textarea',      label: 'Long Text',      group: 'Basic' },
  { value: 'number',        label: 'Number',         group: 'Basic' },
  { value: 'email',         label: 'Email',          group: 'Basic' },
  { value: 'password',      label: 'Password',       group: 'Basic' },
  { value: 'phone',         label: 'Phone',          group: 'Basic' },
  { value: 'url',           label: 'URL',            group: 'Basic' },
  // Date & Time
  { value: 'date',          label: 'Date Picker',    group: 'Date & Time' },
  { value: 'time',          label: 'Time Picker',    group: 'Date & Time' },
  { value: 'datetime',      label: 'Date & Time',    group: 'Date & Time' },
  // Choice
  { value: 'boolean',       label: 'Yes / No',       group: 'Choice' },
  { value: 'select',        label: 'Dropdown',       group: 'Choice' },
  { value: 'multiselect',   label: 'Multi Select',   group: 'Choice' },
  { value: 'radio',         label: 'Radio Buttons',  group: 'Choice' },
  // Location
  { value: 'country',       label: 'Country',        group: 'Location' },
  { value: 'state',         label: 'State / Region', group: 'Location' },
  { value: 'district',      label: 'District',       group: 'Location' },
  { value: 'address',       label: 'Address',        group: 'Location' },
  // Files
  { value: 'image',         label: 'Image Upload',   group: 'Files' },
  { value: 'file',          label: 'File Upload',    group: 'Files' },
  { value: 'signature',     label: 'Signature',      group: 'Files' },
  // Advanced
  { value: 'relation',      label: 'Link to Table',  group: 'Advanced' },
  { value: 'hidden',        label: 'Hidden Field',   group: 'Advanced' },
  // Display
  { value: 'section_header', label: 'Section Header', group: 'Display' },
  { value: 'html_block',    label: 'HTML Block',     group: 'Display' },
]

export const FIELD_GROUPS = ['Basic', 'Date & Time', 'Choice', 'Location', 'Files', 'Advanced', 'Display']

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
