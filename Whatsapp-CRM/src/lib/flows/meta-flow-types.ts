/**
 * Type definitions for Meta WhatsApp Flows.
 * Based on Meta WhatsApp Flows JSON spec v7.1.
 * https://developers.facebook.com/docs/whatsapp/flows/reference/flowjson
 */

export type ComponentType =
  | 'TextHeading'
  | 'TextSubheading'
  | 'TextBody'
  | 'TextCaption'
  | 'TextLabel'
  | 'TextInput'
  | 'TextArea'
  | 'RadioButtonsGroup'
  | 'CheckboxGroup'
  | 'Dropdown'
  | 'DatePicker'
  | 'Image'
  | 'Footer'

export interface DataSourceItem {
  id: string
  title: string
  description?: string
  enabled?: boolean
}

export type OnClickAction =
  | { name: 'navigate'; next: { type: 'screen'; name: string }; payload?: Record<string, unknown> }
  | { name: 'complete'; payload: Record<string, unknown> }
  | { name: 'data_exchange'; payload: Record<string, unknown> }

// ─── Component shapes ────────────────────────────────────────────

export interface TextHeadingComp  { id: string; type: 'TextHeading';    text: string }
export interface TextSubheadingComp { id: string; type: 'TextSubheading'; text: string }
export interface TextBodyComp     { id: string; type: 'TextBody';       text: string }
export interface TextCaptionComp  { id: string; type: 'TextCaption';    text: string }

/** CRM-only: displays a single text value fetched dynamically from a DataStore table. */
export interface TextLabelComp {
  id: string; type: 'TextLabel'
  text: string              // static fallback / display text
  name: string              // internal variable name for dynamic data (e.g. "prog_label")
  _source_table_id?: string
  _source_field_key?: string
  _filter_form_name?: string  // name of parent Dropdown that triggers filter
  _filter_by_field?: string   // DataStore column that stores the parent's value
}

export interface TextInputComp {
  id: string; type: 'TextInput'
  label: string; name: string
  'input-type'?: 'text' | 'number' | 'email' | 'password' | 'phone' | 'passcode'
  required?: boolean
  'helper-text'?: string
  'min-chars'?: number
  'max-chars'?: number
  /** CRM-only: DataStore field_key to save this field's value into */
  _save_field_key?: string
}

export interface TextAreaComp {
  id: string; type: 'TextArea'
  label: string; name: string
  required?: boolean
  'helper-text'?: string
  'max-length'?: number
  _save_field_key?: string
}

export interface RadioButtonsGroupComp {
  id: string; type: 'RadioButtonsGroup'
  label: string; name: string
  'data-source': DataSourceItem[]
  required?: boolean
}

export interface CheckboxGroupComp {
  id: string; type: 'CheckboxGroup'
  label: string; name: string
  'data-source': DataSourceItem[]
  required?: boolean
  'min-selected-items'?: number
  'max-selected-items'?: number
}

export interface DropdownComp {
  id: string; type: 'Dropdown'
  label: string; name: string
  'data-source': DataSourceItem[]
  required?: boolean
  'helper-text'?: string
  /** CRM-only: tracks the Data Store source so the panel can show the picker state */
  _source_table_id?: string
  _source_field_key?: string
  _save_field_key?: string
}

export interface DatePickerComp {
  id: string; type: 'DatePicker'
  label: string; name: string
  required?: boolean
  'helper-text'?: string
  'min-date'?: string
  'max-date'?: string
  _save_field_key?: string
}

export interface ImageComp {
  id: string; type: 'Image'
  src: string
  width?: number
  height?: number
  'scale-type'?: 'cover' | 'contain'
  'alt-text'?: string
}

export interface FooterComp {
  id: string; type: 'Footer'
  label: string
  'on-click-action': OnClickAction
  'left-caption'?: string
  'center-caption'?: string
}

export type MetaFlowComponent =
  | TextHeadingComp
  | TextSubheadingComp
  | TextBodyComp
  | TextCaptionComp
  | TextLabelComp
  | TextInputComp
  | TextAreaComp
  | RadioButtonsGroupComp
  | CheckboxGroupComp
  | DropdownComp
  | DatePickerComp
  | ImageComp
  | FooterComp

export interface MetaFlowScreen {
  id: string
  title: string
  terminal?: boolean
  components: MetaFlowComponent[]
}

export interface MetaFlowDefinition {
  version: '7.1'
  screens: MetaFlowScreen[]
  /** CRM-only: DataStore table ID to save form submissions to */
  _save_table_id?: string
}

// ─── Defaults factory ─────────────────────────────────────────────

let _compId = 0
export function genCompId() { return `comp_${++_compId}` }

export function defaultComponent(type: ComponentType): MetaFlowComponent {
  const id = genCompId()
  switch (type) {
    case 'TextHeading':    return { id, type, text: 'Heading' }
    case 'TextSubheading': return { id, type, text: 'Subheading' }
    case 'TextBody':       return { id, type, text: 'Body text' }
    case 'TextCaption':    return { id, type, text: 'Caption text' }
    case 'TextLabel':      return { id, type, text: 'Label text', name: `label_${id}` }
    case 'TextInput':      return { id, type, label: 'Label', name: `input_${id}`, 'input-type': 'text', required: false }
    case 'TextArea':       return { id, type, label: 'Label', name: `textarea_${id}`, required: false, 'max-length': 600 }
    case 'RadioButtonsGroup': return { id, type, label: 'Choose one', name: `radio_${id}`, required: false, 'data-source': [{ id: 'opt_1', title: 'Option 1' }, { id: 'opt_2', title: 'Option 2' }] }
    case 'CheckboxGroup':  return { id, type, label: 'Choose options', name: `check_${id}`, required: false, 'data-source': [{ id: 'opt_1', title: 'Option 1' }] }
    case 'Dropdown':       return { id, type, label: 'Select', name: `dropdown_${id}`, required: false, 'data-source': [{ id: 'opt_1', title: 'Option 1' }] }
    case 'DatePicker':     return { id, type, label: 'Select date', name: `date_${id}`, required: false }
    case 'Image':          return { id, type, src: '', 'scale-type': 'contain' }
    case 'Footer':         return { id, type, label: 'Continue', 'on-click-action': { name: 'complete', payload: {} } }
  }
}

export function genScreenId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let suffix = ''
  for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * 26)]
  return 'SCREEN_' + suffix
}

export function blankFlow(): MetaFlowDefinition {
  return {
    version: '7.1',
    screens: [
      {
        id: 'SCREEN_ONE',
        title: 'Screen 1',
        components: [
          defaultComponent('TextHeading'),
          defaultComponent('Footer'),
        ],
      },
    ],
  }
}

// ─── Visual metadata ──────────────────────────────────────────────

export const COMPONENT_META: Record<ComponentType, { label: string; group: string; color: string }> = {
  TextHeading:       { label: 'Heading',        group: 'Text',        color: 'bg-blue-100 text-blue-700' },
  TextSubheading:    { label: 'Subheading',     group: 'Text',        color: 'bg-blue-50 text-blue-600' },
  TextBody:          { label: 'Body text',      group: 'Text',        color: 'bg-slate-100 text-slate-600' },
  TextCaption:       { label: 'Caption',        group: 'Text',        color: 'bg-slate-100 text-slate-500' },
  TextLabel:         { label: 'Label (dynamic)', group: 'Text',       color: 'bg-teal-100 text-teal-700' },
  TextInput:         { label: 'Text input',     group: 'Input',       color: 'bg-violet-100 text-violet-700' },
  TextArea:          { label: 'Text area',      group: 'Input',       color: 'bg-violet-100 text-violet-700' },
  RadioButtonsGroup: { label: 'Single choice',  group: 'Selection',   color: 'bg-emerald-100 text-emerald-700' },
  CheckboxGroup:     { label: 'Multi-choice',   group: 'Selection',   color: 'bg-emerald-100 text-emerald-700' },
  Dropdown:          { label: 'Dropdown',       group: 'Selection',   color: 'bg-emerald-100 text-emerald-700' },
  DatePicker:        { label: 'Date picker',    group: 'Input',       color: 'bg-amber-100 text-amber-700' },
  Image:             { label: 'Image',          group: 'Media',       color: 'bg-pink-100 text-pink-700' },
  Footer:            { label: 'Button',         group: 'Action',      color: 'bg-primary/10 text-primary' },
}

export const COMPONENT_GROUPS = ['Text', 'Input', 'Selection', 'Media', 'Action'] as const
