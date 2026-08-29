"use client";

import { useEffect, useMemo, useState } from "react";
import type { MessageTemplate, Contact } from "@/types";
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
  Image as ImageIcon,
  Film,
  File as FileIcon,
  FileText,
  LayoutTemplate,
  Loader2,
  Eye,
  Send,
} from "lucide-react";
import { extractVariableIndices } from "@/lib/whatsapp/template-validators";

export interface TemplateSendValues {
  body: string[];
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
  /** When set, fetches the conversation's contact and offers "insert from
   *  contact" quick-fill chips (Name/Phone/Email/Company) under each
   *  variable input, instead of typing every value by hand. */
  conversationId?: string;
}

/** Non-empty contact fields worth offering as one-click fill-ins. */
function contactFillOptions(contact: Contact | null): { label: string; value: string }[] {
  if (!contact) return [];
  const options: { label: string; value: string }[] = [];
  if (contact.name) options.push({ label: "Name", value: contact.name });
  if (contact.phone && !contact.phone.startsWith("email:")) options.push({ label: "Phone", value: contact.phone });
  if (contact.email) options.push({ label: "Email", value: contact.email });
  if (contact.company) options.push({ label: "Company", value: contact.company });
  return options;
}

function renderBodyPreview(body: string, params: string[]): string {
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
 * Templates may need values for: body variables, a text-header
 * variable, and per-URL-button suffixes. Collect them all so the
 * send-message path doesn't 400 on missing parameters.
 */
function collectVariableSlots(template: MessageTemplate): {
  bodyVars: number[];
  headerVarCount: number;
  urlButtonSlots: UrlButtonSlot[];
} {
  const bodyVars = extractVariableIndices(template.body_text);
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
  return { bodyVars, headerVarCount, urlButtonSlots };
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
  const [params, setParams] = useState<string[]>([]);
  const [headerText, setHeaderText] = useState<string>("");
  const [headerMediaUrl, setHeaderMediaUrl] = useState<string>("");
  const [mediaPopupOpen, setMediaPopupOpen] = useState(false);
  const [buttonParams, setButtonParams] = useState<Record<number, string>>({});
  const [contact, setContact] = useState<Contact | null>(null);

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

    if (conversationId) {
      fetch(`/api/conversations/${conversationId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (!cancelled) setContact(d?.contact ?? null); })
        .catch(() => { if (!cancelled) setContact(null); });
    } else {
      setContact(null);
    }

    return () => {
      cancelled = true;
    };
  }, [open, conversationId]);

  function resetSelection() {
    setSelected(null);
    setParams([]);
    setHeaderText("");
    setHeaderMediaUrl("");
    setButtonParams({});
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
      slots.headerVarCount === 0 &&
      slots.urlButtonSlots.length === 0 &&
      !templateNeedsMedia;
    if (noInputsNeeded) {
      onSelect(template, { body: [] });
      handleOpenChange(false);
      return;
    }
    setSelected(template);
    setParams(new Array(slots.bodyVars.length).fill(""));
    setHeaderText("");
    setHeaderMediaUrl("");
    setButtonParams({});
  }

  function confirm() {
    if (!selected) return;
    const values: TemplateSendValues = { body: params };
    if (headerText.trim()) values.headerText = headerText.trim();
    if (headerMediaUrl) values.headerMediaUrl = headerMediaUrl;
    if (Object.keys(buttonParams).length > 0) {
      values.buttonParams = Object.fromEntries(
        Object.entries(buttonParams).map(([k, v]) => [Number(k), v.trim()]),
      );
    }
    onSelect(selected, values);
    handleOpenChange(false);
  }

  const slots = useMemo(
    () => (selected ? collectVariableSlots(selected) : null),
    [selected],
  );
  const fillOptions = useMemo(() => contactFillOptions(contact), [contact]);

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
    slots.bodyVars.every((_, i) => (params[i] ?? "").trim().length > 0) &&
    (slots.headerVarCount === 0 || headerText.trim().length > 0) &&
    slots.urlButtonSlots.every(
      (s) => (buttonParams[s.index] ?? "").trim().length > 0,
    );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="gap-0 overflow-hidden rounded-3xl bg-white p-0 sm:max-w-lg">
        <DialogHeader className={cn(
          "bg-gradient-to-br px-6 pb-5 pt-6",
          mediaMissing ? "from-amber-50 to-white" : "from-indigo-50 to-white",
        )}>
          <div className={cn(
            "mb-1 flex h-11 w-11 items-center justify-center rounded-2xl",
            mediaMissing ? "bg-amber-100" : "bg-indigo-100",
          )}>
            <LayoutTemplate className={cn("h-5 w-5", mediaMissing ? "text-amber-600" : "text-indigo-600")} />
          </div>
          <DialogTitle className="truncate text-[17px] font-bold text-slate-800">
            {selected ? selected.name : "Send a template"}
          </DialogTitle>
          <p className="mt-0.5 text-[12px] text-slate-400">
            {selected
              ? "Fill in what this template needs — Meta requires every variable and required media set before it can send."
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
          <div className="max-h-[70vh] space-y-4 overflow-y-auto px-6 pb-2 pt-1 scroll-styled">
            {/* WhatsApp-style live preview — shows the actual header media,
                rendered body (unfilled placeholders left visible as a cue),
                footer, and buttons, not just a bare text dump. */}
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <Eye className="h-3 w-3" /> Preview
              </div>
              <div className="rounded-2xl p-3" style={{
                backgroundColor: '#e5ddd5',
                backgroundImage: 'radial-gradient(circle at 12% 22%, rgba(255,255,255,0.35) 0, transparent 40%), radial-gradient(circle at 82% 72%, rgba(255,255,255,0.3) 0, transparent 45%)',
              }}>
                <div className="ml-auto max-w-[92%] overflow-hidden rounded-lg rounded-tr-none bg-[#d9fdd3] shadow-sm">
                  {headerMediaType === "image" && (
                    <div className="flex h-28 items-center justify-center overflow-hidden bg-slate-200">
                      {previewMediaUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={previewMediaUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <ImageIcon className="h-6 w-6 text-slate-400" />
                      )}
                    </div>
                  )}
                  {headerMediaType === "video" && (
                    <div className="flex h-24 items-center justify-center bg-black">
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
                        {renderHeaderPreview(selected.header_content, headerText)}
                      </p>
                    )}
                    <p className="whitespace-pre-wrap text-[13.5px] leading-snug text-[#111b21]">
                      {renderBodyPreview(selected.body_text, params)}
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
            </div>

            {/* Header media — first among the "fill this in" controls when
                it's a hard blocker, since that's the thing most likely to
                stop the send outright. */}
            {headerMediaType && (
              <button
                type="button"
                onClick={() => setMediaPopupOpen(true)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition-all hover:shadow-sm",
                  mediaRequired && !headerMediaUrl ? "border-amber-300 bg-amber-50/60 hover:border-amber-400" : "border-slate-200 bg-white hover:border-indigo-300",
                )}
              >
                {headerMediaUrl ? (
                  headerMediaType === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={headerMediaUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50">
                      {HeaderMediaIcon && <HeaderMediaIcon className="h-5 w-5 text-indigo-500" />}
                    </div>
                  )
                ) : (
                  <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", mediaRequired ? "bg-amber-100" : "bg-indigo-50")}>
                    {HeaderMediaIcon && <HeaderMediaIcon className={cn("h-5 w-5", mediaRequired ? "text-amber-600" : "text-indigo-500")} />}
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

            {/* Variables */}
            {(slots && (slots.headerVarCount > 0 || slots.bodyVars.length > 0 || slots.urlButtonSlots.length > 0)) && (
              <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                {slots.headerVarCount > 0 && (
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Header {`{{1}}`}
                    </label>
                    <Input
                      value={headerText}
                      onChange={(e) => setHeaderText(e.target.value)}
                      placeholder="Value for the header variable"
                      className="h-9 border-slate-200 bg-white text-[13px] text-slate-800 placeholder:text-slate-400"
                    />
                    {fillOptions.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {fillOptions.map((opt) => (
                          <button key={opt.label} type="button" onClick={() => setHeaderText(opt.value)}
                            className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600 hover:bg-indigo-100">
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {slots.bodyVars.map((v, i) => (
                  <div key={v} className="space-y-1.5">
                    <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{`Body {{${v}}}`}</label>
                    <Input
                      value={params[i] ?? ""}
                      onChange={(e) => {
                        const next = [...params];
                        next[i] = e.target.value;
                        setParams(next);
                      }}
                      placeholder={`Value for {{${v}}}`}
                      className="h-9 border-slate-200 bg-white text-[13px] text-slate-800 placeholder:text-slate-400"
                    />
                    {fillOptions.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {fillOptions.map((opt) => (
                          <button key={opt.label} type="button"
                            onClick={() => { const next = [...params]; next[i] = opt.value; setParams(next); }}
                            className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600 hover:bg-indigo-100">
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {slots.urlButtonSlots.map((slot) => (
                  <div key={slot.index} className="space-y-1.5">
                    <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {`URL button "${slot.text}" — value for `}{`{{1}}`}
                    </label>
                    <Input
                      value={buttonParams[slot.index] ?? ""}
                      onChange={(e) =>
                        setButtonParams((prev) => ({
                          ...prev,
                          [slot.index]: e.target.value,
                        }))
                      }
                      placeholder="URL suffix value"
                      className="h-9 border-slate-200 bg-white text-[13px] text-slate-800 placeholder:text-slate-400"
                    />
                    <p className="break-all text-[10px] text-slate-400">
                      Final URL: {slot.url.replace(/\{\{1\}\}/g, buttonParams[slot.index] || "{{1}}")}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className={cn("flex items-center gap-2 px-6 py-4", selected && "border-t border-slate-100")}>
          {selected ? (
            <>
              <Button
                variant="outline"
                onClick={resetSelection}
                className="h-10 border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              <Button
                disabled={!canConfirm}
                onClick={confirm}
                className="h-10 flex-1 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
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
              className="ml-auto h-10 border-slate-200 text-slate-600 hover:bg-slate-50"
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
