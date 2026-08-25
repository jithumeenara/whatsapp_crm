"use client";

import { useEffect, useMemo, useState } from "react";
import type { MessageTemplate, Contact } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { HeaderMediaPicker } from "@/components/shared/header-media-picker";
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Image as ImageIcon,
  Film,
  File as FileIcon,
  LayoutTemplate,
  Loader2,
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
      <DialogContent className="border-slate-200 bg-white sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-800">
            <LayoutTemplate className="h-4 w-4 text-primary" />
            {selected ? selected.name : "Send template"}
          </DialogTitle>
          <DialogDescription className="text-slate-500">
            {selected
              ? "Fill in the placeholders to render this template. Meta requires every variable to be set."
              : "Pick an approved WhatsApp template to send to this contact."}
          </DialogDescription>
        </DialogHeader>

        {!selected ? (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto scroll-styled">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : templates.length === 0 ? (
              <div className="rounded-md border border-slate-200 bg-white/50 p-6 text-center">
                <p className="text-sm text-slate-800/80">No approved templates</p>
                <p className="mt-1 text-xs text-slate-500">
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
                  className="w-full rounded-md border border-slate-200 bg-white/50 p-3 text-left transition-colors hover:border-primary/40 hover:bg-white"
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium text-slate-800">
                          {t.name}
                        </p>
                        <Badge className="border border-primary/30 bg-primary/20 text-[10px] text-primary">
                          {t.category}
                        </Badge>
                        {t.language && (
                          <span className="text-[10px] uppercase text-slate-500">
                            {t.language}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                        {t.body_text}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-500" />
                  </div>
                </button>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border border-slate-200 bg-white/50 p-3">
              <p className="mb-1 text-xs text-slate-500">Preview</p>
              <p className="whitespace-pre-wrap text-sm text-slate-800/80">
                {renderBodyPreview(selected.body_text, params)}
              </p>
              {selected.footer_text && (
                <p className="mt-2 text-xs italic text-slate-500">
                  {selected.footer_text}
                </p>
              )}
            </div>
            {headerMediaType && (
              <button
                type="button"
                onClick={() => setMediaPopupOpen(true)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-all hover:shadow-sm",
                  mediaRequired && !headerMediaUrl ? "border-amber-300 bg-amber-50/60 hover:border-amber-400" : "border-slate-200 bg-white hover:border-primary/40",
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
                {headerMediaUrl ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : mediaRequired ? <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" /> : null}
              </button>
            )}
            {slots && slots.headerVarCount > 0 && (
              <div className="space-y-1">
                <Label className="text-xs text-slate-800/80">
                  {`Header {{1}}`}
                </Label>
                <Input
                  value={headerText}
                  onChange={(e) => setHeaderText(e.target.value)}
                  placeholder="Value for the header variable"
                  className="border-slate-200 bg-slate-100 text-slate-800 placeholder:text-slate-500"
                />
                {fillOptions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {fillOptions.map((opt) => (
                      <button key={opt.label} type="button" onClick={() => setHeaderText(opt.value)}
                        className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/20">
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {slots?.bodyVars.map((v, i) => (
              <div key={v} className="space-y-1">
                <Label className="text-xs text-slate-800/80">{`Body {{${v}}}`}</Label>
                <Input
                  value={params[i] ?? ""}
                  onChange={(e) => {
                    const next = [...params];
                    next[i] = e.target.value;
                    setParams(next);
                  }}
                  placeholder={`Value for {{${v}}}`}
                  className="border-slate-200 bg-slate-100 text-slate-800 placeholder:text-slate-500"
                />
                {fillOptions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {fillOptions.map((opt) => (
                      <button key={opt.label} type="button"
                        onClick={() => { const next = [...params]; next[i] = opt.value; setParams(next); }}
                        className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/20">
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {slots?.urlButtonSlots.map((slot) => (
              <div key={slot.index} className="space-y-1">
                <Label className="text-xs text-slate-800/80">
                  {`URL button "${slot.text}" — value for `}{`{{1}}`}
                </Label>
                <Input
                  value={buttonParams[slot.index] ?? ""}
                  onChange={(e) =>
                    setButtonParams((prev) => ({
                      ...prev,
                      [slot.index]: e.target.value,
                    }))
                  }
                  placeholder="URL suffix value"
                  className="border-slate-200 bg-slate-100 text-slate-800 placeholder:text-slate-500"
                />
                <p className="text-[10px] text-slate-500 break-all">
                  Final URL: {slot.url.replace(/\{\{1\}\}/g, buttonParams[slot.index] || "{{1}}")}
                </p>
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2">
          {selected ? (
            <>
              <Button
                variant="outline"
                onClick={resetSelection}
                className="border-slate-200 text-slate-800/80 hover:bg-slate-100"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              <Button
                disabled={!canConfirm}
                onClick={confirm}
                className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Send template
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              className="border-slate-200 text-slate-800/80 hover:bg-slate-100"
            >
              Cancel
            </Button>
          )}
        </DialogFooter>
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
