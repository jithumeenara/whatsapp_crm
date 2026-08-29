"use client";

import { useEffect, useMemo, useState } from "react";
import type { MessageTemplate, Contact, CustomField } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { HeaderMediaPicker } from "@/components/shared/header-media-picker";
import {
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  Image as ImageIcon,
  Film,
  File as FileIcon,
  FileText,
  LayoutTemplate,
  Loader2,
  Eye,
  Send,
  PenLine,
  User,
  Tags,
} from "lucide-react";
import { extractVariableIndices } from "@/lib/whatsapp/template-validators";
import { extractVariableKeys, isNamedVariableText } from "@/lib/whatsapp/template-variable-keys";

export interface TemplateSendValues {
  /** Positional {{1}}, {{2}}, … — set when the template uses Meta's
   *  classic numbered format. */
  body: string[];
  /** Named {{customer_name}}, … — set instead of `body` when the
   *  template uses Meta's named-parameter format (extremely common on
   *  templates synced FROM Meta, since Business Manager defaults new
   *  templates to it). */
  bodyByName?: Record<string, string>;
  headerText?: string;
  headerMediaUrl?: string;
  buttonParams?: Record<number, string>;
}

const HEADER_MEDIA_ICON: Record<string, typeof ImageIcon> = {
  image: ImageIcon,
  video: Film,
  document: FileIcon,
};

function cn(...c: (string | boolean | undefined | null)[]) { return c.filter(Boolean).join(' '); }

interface TemplatePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (template: MessageTemplate, values: TemplateSendValues) => void;
  /** When set, fetches the conversation's contact (+ their custom field
   *  values) so each variable can be mapped to a Contact Field or Custom
   *  Field instead of only ever typed by hand. */
  conversationId?: string;
}

function renderBodyPreview(body: string, isNamed: boolean, params: string[], namedValues: Record<string, string>): string {
  if (isNamed) {
    return body.replace(/\{\{([^}]+)\}\}/g, (_, rawKey) => {
      const key = rawKey.trim();
      const value = namedValues[key];
      return value && value.trim().length > 0 ? value : `{{${key}}}`;
    });
  }
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
    const idx = Number(raw) - 1;
    const value = params[idx];
    return value && value.trim().length > 0 ? value : `{{${raw}}}`;
  });
}

function renderHeaderPreview(headerContent: string, value: string): string {
  return headerContent.replace(/\{\{1\}\}/g, value?.trim() ? value : "{{1}}");
}

interface UrlButtonSlot {
  index: number;
  text: string;
  url: string;
}

/**
 * Templates may need values for: body variables (either Meta's classic
 * positional {{1}}/{{2}} format, or the named {{customer_name}} format —
 * a template uses one or the other, never mixed), a text-header
 * variable, and per-URL-button suffixes. Collect them all so the
 * send-message path doesn't 400 on missing parameters.
 */
function collectVariableSlots(template: MessageTemplate): {
  isBodyNamed: boolean;
  bodyVars: number[];
  bodyNamedKeys: string[];
  headerVarCount: number;
  urlButtonSlots: UrlButtonSlot[];
} {
  const isBodyNamed = isNamedVariableText(template.body_text);
  const bodyVars = isBodyNamed ? [] : extractVariableIndices(template.body_text);
  const bodyNamedKeys = isBodyNamed ? extractVariableKeys(template.body_text) : [];
  const headerVarCount =
    template.header_type === "text" && template.header_content
      ? extractVariableIndices(template.header_content).length
      : 0;
  const urlButtonSlots: UrlButtonSlot[] = [];
  (template.buttons ?? []).forEach((b, i) => {
    if (b.type === "URL" && extractVariableIndices(b.url).length > 0) {
      urlButtonSlots.push({ index: i, text: b.text, url: b.url });
    }
  });
  return { isBodyNamed, bodyVars, bodyNamedKeys, headerVarCount, urlButtonSlots };
}

// ── Variable mapping — same source model as the broadcast composer's
// Variable Mapping popup (Static / Contact Field / Custom Field), scoped
// to the one contact already loaded here instead of resolving per-recipient.
// Data Store lookup is deliberately not offered — it exists in broadcasts to
// avoid typing the same value for thousands of recipients; for a single
// known contact it would just add a table/match-field picker for no benefit
// over typing the value directly.
type VarSourceType = "static" | "contact_field" | "custom_field";
type ContactFieldKey = "name" | "phone" | "email" | "company";

interface VarMapping {
  type: VarSourceType;
  staticValue: string;
  contactField?: ContactFieldKey;
  customFieldId?: string;
}

function emptyMapping(): VarMapping {
  return { type: "static", staticValue: "" };
}

const CONTACT_FIELD_OPTIONS: { key: ContactFieldKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "company", label: "Company" },
];

const MAPPING_TILES: { type: VarSourceType; label: string; icon: typeof PenLine }[] = [
  { type: "static", label: "Static", icon: PenLine },
  { type: "contact_field", label: "Contact", icon: User },
  { type: "custom_field", label: "Custom Field", icon: Tags },
];

function resolveMappingValue(
  mapping: VarMapping | undefined,
  contact: Contact | null,
  customValues: Map<string, string>,
): string {
  if (!mapping) return "";
  if (mapping.type === "static") return mapping.staticValue;
  if (mapping.type === "contact_field") {
    if (!mapping.contactField || !contact) return "";
    const map: Record<ContactFieldKey, string | undefined> = {
      name: contact.name, phone: contact.phone, email: contact.email, company: contact.company,
    };
    return map[mapping.contactField] ?? "";
  }
  if (mapping.type === "custom_field") {
    if (!mapping.customFieldId) return "";
    return customValues.get(mapping.customFieldId) ?? "";
  }
  return "";
}

interface VarRow { id: string; label: string }

/** One placeholder's mapping control — a compact 3-tile source switcher
 *  plus whichever control that source needs. */
function VariableMappingRow({
  row, mapping, onChange, customFields, hasContact,
}: {
  row: VarRow;
  mapping: VarMapping;
  onChange: (next: VarMapping) => void;
  customFields: CustomField[];
  hasContact: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{row.label}</label>
      <div className="flex gap-1">
        {MAPPING_TILES.map((tile) => {
          const selected = mapping.type === tile.type;
          const TileIcon = tile.icon;
          const disabled = (tile.type === "contact_field" && !hasContact) || (tile.type === "custom_field" && customFields.length === 0);
          return (
            <button
              key={tile.type}
              type="button"
              disabled={disabled}
              onClick={() => onChange(tile.type === "static" ? { type: "static", staticValue: mapping.type === "static" ? mapping.staticValue : "" } : { type: tile.type, staticValue: "" })}
              className={cn(
                "flex flex-1 items-center justify-center gap-1 rounded-lg border py-1.5 text-[10.5px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40",
                selected ? "border-indigo-400 bg-indigo-50 text-indigo-700 shadow-sm" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300",
              )}
            >
              <TileIcon className="h-3 w-3" /> {tile.label}
            </button>
          );
        })}
      </div>
      {mapping.type === "static" && (
        <Input
          value={mapping.staticValue}
          onChange={(e) => onChange({ ...mapping, staticValue: e.target.value })}
          placeholder={`Value for ${row.label}`}
          className="h-9 border-slate-200 bg-white text-[13px] text-slate-800 placeholder:text-slate-400"
        />
      )}
      {mapping.type === "contact_field" && (
        <div className="flex flex-wrap gap-1.5">
          {CONTACT_FIELD_OPTIONS.map((opt) => (
            <button key={opt.key} type="button"
              onClick={() => onChange({ ...mapping, contactField: opt.key })}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all",
                mapping.contactField === opt.key ? "border-indigo-400 bg-indigo-100 text-indigo-700" : "border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100",
              )}>
              {opt.label}
            </button>
          ))}
        </div>
      )}
      {mapping.type === "custom_field" && (
        <select
          value={mapping.customFieldId ?? ""}
          onChange={(e) => onChange({ ...mapping, customFieldId: e.target.value || undefined })}
          className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        >
          <option value="">Select a custom field…</option>
          {customFields.map((f) => <option key={f.id} value={f.id}>{f.field_name}</option>)}
        </select>
      )}
    </div>
  );
}

export function TemplatePicker({
  open,
  onOpenChange,
  onSelect,
  conversationId,
}: TemplatePickerProps) {
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<MessageTemplate | null>(null);
  const [mappings, setMappings] = useState<Record<string, VarMapping>>({});
  const [headerMediaUrl, setHeaderMediaUrl] = useState<string>("");
  const [mediaPopupOpen, setMediaPopupOpen] = useState(false);
  const [contact, setContact] = useState<Contact | null>(null);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Map<string, string>>(new Map());
  // Collapsed by default — a long template's preview was pushing Header
  // Media / variable inputs below the fold, making them easy to miss
  // entirely. Still one click away, and height-capped with its own scroll
  // even when open so it can never dominate the dialog again.
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/whatsapp/templates?status=APPROVED');
        if (cancelled) return;
        if (!res.ok) {
          setTemplates([]);
        } else {
          const data = await res.json();
          if (!cancelled) setTemplates((data.templates as MessageTemplate[]) ?? []);
        }
      } catch (err) {
        console.error("Failed to fetch templates:", err);
        if (!cancelled) setTemplates([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    fetch('/api/custom-fields', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setCustomFields(d?.fields ?? []); })
      .catch(() => {});

    if (conversationId) {
      fetch(`/api/conversations/${conversationId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then(async (d) => {
          if (cancelled) return;
          const c: Contact | null = d?.contact ?? null;
          setContact(c);
          if (c) {
            const cvRes = await fetch(`/api/contacts/${c.id}/custom-values`, { cache: 'no-store' });
            if (!cancelled && cvRes.ok) {
              const cvJson = await cvRes.json();
              const map = new Map<string, string>();
              for (const row of (cvJson.values ?? []) as { custom_field_id: string; value?: string }[]) {
                map.set(row.custom_field_id, row.value ?? '');
              }
              setCustomValues(map);
            }
          } else {
            setCustomValues(new Map());
          }
        })
        .catch(() => { if (!cancelled) { setContact(null); setCustomValues(new Map()); } });
    } else {
      setContact(null);
      setCustomValues(new Map());
    }

    return () => {
      cancelled = true;
    };
  }, [open, conversationId]);

  const rows: VarRow[] = useMemo(() => {
    if (!selected) return [];
    const slots = collectVariableSlots(selected);
    const list: VarRow[] = [];
    if (slots.headerVarCount > 0) list.push({ id: "header", label: "Header {{1}}" });
    if (slots.isBodyNamed) {
      for (const key of slots.bodyNamedKeys) list.push({ id: `body:${key}`, label: `Variable {{${key}}}` });
    } else {
      for (const v of slots.bodyVars) list.push({ id: `body:${v}`, label: `Body {{${v}}}` });
    }
    for (const slot of slots.urlButtonSlots) list.push({ id: `button:${slot.index}`, label: `URL button "${slot.text}"` });
    return list;
  }, [selected]);

  function resetSelection() {
    setSelected(null);
    setMappings({});
    setHeaderMediaUrl("");
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetSelection();
    onOpenChange(next);
  }

  function pickTemplate(template: MessageTemplate) {
    const slots = collectVariableSlots(template);
    const templateNeedsMedia =
      template.header_type === "image" ||
      template.header_type === "video" ||
      template.header_type === "document";
    const noInputsNeeded =
      slots.bodyVars.length === 0 &&
      slots.bodyNamedKeys.length === 0 &&
      slots.headerVarCount === 0 &&
      slots.urlButtonSlots.length === 0 &&
      !templateNeedsMedia;
    if (noInputsNeeded) {
      onSelect(template, { body: [] });
      handleOpenChange(false);
      return;
    }
    setSelected(template);
    setHeaderMediaUrl("");
    // Seed every placeholder with an empty static mapping — done here
    // (rather than lazily) so canConfirm/resolved values never have to
    // special-case an undefined mapping.
    const seedRows: VarRow[] = [];
    if (slots.headerVarCount > 0) seedRows.push({ id: "header", label: "" });
    if (slots.isBodyNamed) slots.bodyNamedKeys.forEach((k) => seedRows.push({ id: `body:${k}`, label: "" }));
    else slots.bodyVars.forEach((v) => seedRows.push({ id: `body:${v}`, label: "" }));
    slots.urlButtonSlots.forEach((s) => seedRows.push({ id: `button:${s.index}`, label: "" }));
    setMappings(Object.fromEntries(seedRows.map((r) => [r.id, emptyMapping()])));
  }

  const resolved = useMemo(() => {
    const out: Record<string, string> = {};
    for (const row of rows) out[row.id] = resolveMappingValue(mappings[row.id], contact, customValues).trim();
    return out;
  }, [rows, mappings, contact, customValues]);

  function confirm() {
    if (!selected || !slots) return;
    const headerTextResolved = resolved["header"] ?? "";
    const values: TemplateSendValues = slots.isBodyNamed
      ? { body: [], bodyByName: Object.fromEntries(slots.bodyNamedKeys.map((k) => [k, resolved[`body:${k}`] ?? ""])) }
      : { body: slots.bodyVars.map((v) => resolved[`body:${v}`] ?? "") };
    if (headerTextResolved) values.headerText = headerTextResolved;
    if (headerMediaUrl) values.headerMediaUrl = headerMediaUrl;
    if (slots.urlButtonSlots.length > 0) {
      values.buttonParams = Object.fromEntries(slots.urlButtonSlots.map((s) => [s.index, resolved[`button:${s.index}`] ?? ""]));
    }
    onSelect(selected, values);
    handleOpenChange(false);
  }

  const slots = useMemo(
    () => (selected ? collectVariableSlots(selected) : null),
    [selected],
  );

  const headerMediaType =
    selected?.header_type === "image" || selected?.header_type === "video" || selected?.header_type === "document"
      ? selected.header_type
      : null;
  const HeaderMediaIcon = headerMediaType ? HEADER_MEDIA_ICON[headerMediaType] : null;
  // Templates synced from Meta rarely carry a reusable header_media_url —
  // Meta's template API only returns the sample used at approval time, not
  // a sendable one, so most media-header templates need one picked here.
  const hasDefaultMedia = !!selected?.header_media_url;
  const mediaRequired = !!headerMediaType && !hasDefaultMedia;
  const mediaMissing = !!headerMediaType && !headerMediaUrl && !selected?.header_media_url;
  const previewMediaUrl = headerMediaUrl || selected?.header_media_url || "";

  const canConfirm =
    !!selected &&
    !!slots &&
    !mediaMissing &&
    rows.every((row) => (resolved[row.id] ?? "").length > 0);

  // Preview needs the header/body values in their original shapes.
  const previewHeaderText = resolved["header"] ?? "";
  const previewParams = slots && !slots.isBodyNamed ? slots.bodyVars.map((v) => resolved[`body:${v}`] ?? "") : [];
  const previewNamedValues = slots && slots.isBodyNamed
    ? Object.fromEntries(slots.bodyNamedKeys.map((k) => [k, resolved[`body:${k}`] ?? ""]))
    : {};

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="gap-0 overflow-hidden rounded-3xl bg-white p-0 sm:max-w-lg">
        <DialogHeader className={cn(
          "bg-gradient-to-br px-6 pb-4 pt-5",
          mediaMissing ? "from-amber-50 to-white" : "from-indigo-50 to-white",
        )}>
          <div className={cn(
            "mb-1 flex h-9 w-9 items-center justify-center rounded-xl",
            mediaMissing ? "bg-amber-100" : "bg-indigo-100",
          )}>
            <LayoutTemplate className={cn("h-4.5 w-4.5", mediaMissing ? "text-amber-600" : "text-indigo-600")} />
          </div>
          <DialogTitle className="truncate text-[16px] font-bold text-slate-800">
            {selected ? selected.name : "Send a template"}
          </DialogTitle>
          <p className="mt-0.5 text-[11.5px] text-slate-400">
            {selected
              ? "Fill in what this template needs before it can send."
              : "Pick an approved WhatsApp template to send to this contact."}
          </p>
        </DialogHeader>

        {!selected ? (
          <div className="max-h-[65vh] space-y-2 overflow-y-auto px-6 pb-6 pt-1 scroll-styled">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
              </div>
            ) : templates.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-6 text-center">
                <p className="text-[13px] font-medium text-slate-600">No approved templates</p>
                <p className="mt-1 text-[12px] text-slate-400">
                  Approve a template in Meta WhatsApp Manager, then sync it
                  from Settings → Templates.
                </p>
              </div>
            ) : (
              templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => pickTemplate(t)}
                  className="w-full rounded-2xl border border-slate-200 bg-white p-3.5 text-left transition-all hover:border-indigo-300 hover:shadow-sm"
                >
                  <div className="flex items-start gap-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="truncate text-[13.5px] font-semibold text-slate-800">
                          {t.name}
                        </p>
                        <Badge className="border border-indigo-200 bg-indigo-50 text-[10px] text-indigo-600">
                          {t.category}
                        </Badge>
                        {t.language && (
                          <span className="text-[10px] uppercase text-slate-400">
                            {t.language}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-[12px] text-slate-500">
                        {t.body_text}
                      </p>
                    </div>
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  </div>
                </button>
              ))
            )}
          </div>
        ) : (
          <div className="max-h-[68vh] space-y-3 overflow-y-auto px-6 pb-2 pt-1 scroll-styled">
            {/* WhatsApp-style live preview — collapsed by default so it
                never dominates the dialog; shows actual header media,
                rendered body, footer, and buttons when opened. */}
            <div>
              <button
                type="button"
                onClick={() => setPreviewOpen((v) => !v)}
                className="mb-1.5 flex w-full items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-600"
              >
                <Eye className="h-3 w-3" /> Preview
                {previewOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              </button>
              {previewOpen && (
              <div className="max-h-44 overflow-y-auto rounded-2xl p-3 scroll-styled" style={{
                backgroundColor: '#e5ddd5',
                backgroundImage: 'radial-gradient(circle at 12% 22%, rgba(255,255,255,0.35) 0, transparent 40%), radial-gradient(circle at 82% 72%, rgba(255,255,255,0.3) 0, transparent 45%)',
              }}>
                <div className="ml-auto max-w-[92%] overflow-hidden rounded-lg rounded-tr-none bg-[#d9fdd3] shadow-sm">
                  {headerMediaType === "image" && (
                    <div className="flex h-24 items-center justify-center overflow-hidden bg-slate-200">
                      {previewMediaUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={previewMediaUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <ImageIcon className="h-6 w-6 text-slate-400" />
                      )}
                    </div>
                  )}
                  {headerMediaType === "video" && (
                    <div className="flex h-20 items-center justify-center bg-black">
                      <Film className="h-6 w-6 text-white/70" />
                    </div>
                  )}
                  {headerMediaType === "document" && (
                    <div className="mx-2 mt-2 flex items-center gap-2 rounded-lg bg-black/5 p-2">
                      <FileText className="h-4 w-4 shrink-0 text-rose-500" />
                      <span className="truncate text-[12px] text-[#111b21]">
                        {previewMediaUrl ? previewMediaUrl.split("/").pop() : "Document"}
                      </span>
                    </div>
                  )}
                  <div className="px-3 pb-1.5 pt-2">
                    {selected.header_type === "text" && selected.header_content && (
                      <p className="mb-1 whitespace-pre-wrap text-[14px] font-bold leading-snug text-[#111b21]">
                        {renderHeaderPreview(selected.header_content, previewHeaderText)}
                      </p>
                    )}
                    <p className="whitespace-pre-wrap text-[13.5px] leading-snug text-[#111b21]">
                      {renderBodyPreview(selected.body_text, slots?.isBodyNamed ?? false, previewParams, previewNamedValues)}
                    </p>
                    {selected.footer_text && (
                      <p className="mt-1 text-[12px] text-[#667781]">{selected.footer_text}</p>
                    )}
                  </div>
                </div>
                {selected.buttons && selected.buttons.length > 0 && (
                  <div className="ml-auto mt-0.5 max-w-[92%] overflow-hidden rounded-lg bg-white shadow-sm">
                    {selected.buttons.map((b, i) => (
                      <div key={i} className={cn(
                        "py-2 text-center text-[13px] font-medium text-[#00a5f4]",
                        i > 0 && "border-t border-slate-100",
                      )}>
                        {b.text}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              )}
            </div>

            {/* Header media — first among the "fill this in" controls when
                it's a hard blocker, since that's the thing most likely to
                stop the send outright. */}
            {headerMediaType && (
              <button
                type="button"
                onClick={() => setMediaPopupOpen(true)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-all hover:shadow-sm",
                  mediaRequired && !headerMediaUrl ? "border-amber-300 bg-amber-50/60 hover:border-amber-400" : "border-slate-200 bg-white hover:border-indigo-300",
                )}
              >
                {headerMediaUrl ? (
                  headerMediaType === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={headerMediaUrl} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50">
                      {HeaderMediaIcon && <HeaderMediaIcon className="h-4.5 w-4.5 text-indigo-500" />}
                    </div>
                  )
                ) : (
                  <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", mediaRequired ? "bg-amber-100" : "bg-indigo-50")}>
                    {HeaderMediaIcon && <HeaderMediaIcon className={cn("h-4.5 w-4.5", mediaRequired ? "text-amber-600" : "text-indigo-500")} />}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-[13px] font-semibold text-slate-800">Header Media</p>
                    {mediaRequired && !headerMediaUrl && (
                      <span className="rounded-full bg-amber-200 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-800">Required</span>
                    )}
                  </div>
                  <p className="truncate text-[12px] text-slate-500">
                    {headerMediaUrl ? headerMediaUrl.split("/").pop() : mediaRequired ? "Not attached — send will fail without one" : "Optional — uses the template's sample media"}
                  </p>
                </div>
                {headerMediaUrl ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : mediaRequired ? <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
              </button>
            )}

            {/* Variables — one uniform mapping row per placeholder (header,
                body, URL buttons alike), same Static/Contact Field/Custom
                Field source model as the broadcast composer. */}
            {rows.length > 0 && (
              <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-3.5">
                {rows.map((row) => (
                  <VariableMappingRow
                    key={row.id}
                    row={row}
                    mapping={mappings[row.id] ?? emptyMapping()}
                    onChange={(next) => setMappings((prev) => ({ ...prev, [row.id]: next }))}
                    customFields={customFields}
                    hasContact={!!contact}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        <div className={cn("flex items-center gap-2 px-6 py-3.5", selected && "border-t border-slate-100")}>
          {selected ? (
            <>
              <Button
                variant="outline"
                onClick={resetSelection}
                className="h-9 border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              <Button
                disabled={!canConfirm}
                onClick={confirm}
                className="h-9 flex-1 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                Send Template
                <ArrowRight className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              className="ml-auto h-9 border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </Button>
          )}
        </div>
      </DialogContent>

      {headerMediaType && (
        <HeaderMediaPicker
          open={mediaPopupOpen}
          onOpenChange={setMediaPopupOpen}
          mediaType={headerMediaType}
          headerMediaUrl={headerMediaUrl}
          onHeaderMediaChange={setHeaderMediaUrl}
          required={mediaRequired}
        />
      )}
    </Dialog>
  );
}
