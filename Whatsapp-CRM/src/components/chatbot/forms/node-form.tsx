"use client";

/**
 * Per-node configuration forms for the chatbot builder.
 * Dispatches to the correct sub-form based on node_type.
 */

import { useId, useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Type,
  Hash,
  Mail,
  Globe,
  Calendar,
  Clock,
  Phone,
  Paperclip,
  MapPin,
  Link2,
  Upload,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Copy,
  Code2,
  FolderOpen,
  AlertTriangle,
} from "lucide-react";
import { FileManagerPicker } from "@/components/inbox/file-manager-picker";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { RichTextArea } from "./rich-text-area";
import type { ChatbotBuilderNode, ChatbotNodeType } from "@/lib/chatbot/types";
import { NODE_META, NODE_NAME_MAX, nodeDisplayName } from "@/lib/chatbot/node-meta";

// ─── Variable helpers ────────────────────────────────────────────

/**
 * Extract every {{vars.x}} key created anywhere else in this chatbot —
 * collect_input's var_key, set_variable's assignments, and send_buttons /
 * send_list's save_reply_to all write into run.vars at runtime.
 */
function getFlowVars(allNodes: ChatbotBuilderNode[], currentKey: string): string[] {
  const keys = new Set<string>();
  for (const n of allNodes) {
    if (n.node_key === currentKey) continue;
    if (n.node_type === "collect_input") {
      if (typeof n.config.var_key === "string" && n.config.var_key) keys.add(n.config.var_key);
    } else if (n.node_type === "set_variable") {
      const assignments = Array.isArray(n.config.assignments)
        ? (n.config.assignments as Array<Record<string, unknown>>)
        : [];
      for (const a of assignments) {
        if (typeof a.var_key === "string" && a.var_key) keys.add(a.var_key);
      }
    } else if (n.node_type === "send_buttons" || n.node_type === "send_list") {
      if (typeof n.config.save_reply_to === "string" && n.config.save_reply_to) {
        keys.add(n.config.save_reply_to);
      }
    } else if (
      n.node_type === "send_flow" ||
      n.node_type === "wait_flow_submit" ||
      (n.node_type === "start" && n.config.trigger_on === "flow_submitted")
    ) {
      const tokens = Array.isArray(n.config.available_vars)
        ? (n.config.available_vars as unknown[]).filter((t): t is string => typeof t === "string")
        : [];
      for (const t of tokens) keys.add(`flow_${t}`);
    }
  }
  return [...keys];
}

/** Small clickable chips that insert {{vars.x}} into a field. */
function VarChips({
  vars,
  onInsert,
}: {
  vars: string[];
  onInsert: (token: string) => void;
}) {
  if (vars.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 pt-0.5">
      <span className="text-[10px] text-slate-500 self-center">Insert:</span>
      {vars.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onInsert(`{{vars.${v}}}`)}
          className="rounded bg-teal-500/10 px-1.5 py-0.5 font-mono text-[10px] text-teal-600 hover:bg-teal-500/20 transition-colors"
          title={`Insert {{vars.${v}}}`}
        >
          {`{{vars.${v}}}`}
        </button>
      ))}
    </div>
  );
}

// ─── Shared field components ─────────────────────────────────────

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-slate-700">
        {label}
      </label>
      {children}
      {hint && <p className="text-[10px] text-slate-500">{hint}</p>}
    </div>
  );
}

function NodeSelect({
  label,
  value,
  allNodes,
  currentKey,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  allNodes: ChatbotBuilderNode[];
  currentKey: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  const opts = allNodes.filter((n) => n.node_key !== currentKey);
  return (
    <Field label={label} hint={hint}>
      <Select
        value={value || "__none__"}
        onValueChange={(v) => onChange(!v || v === "__none__" ? "" : v)}
      >
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Select a node…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__" className="text-xs text-slate-500">
            — none —
          </SelectItem>
          {opts.map((n) => (
            <SelectItem key={n.node_key} value={n.node_key} className="text-xs">
              {nodeDisplayName(n)} · {n.node_key}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

// ─── Media URL picker ────────────────────────────────────────────

type MediaInputMode = "url" | "upload";

/** WhatsApp's real accepted formats per media type — shown as a hint so a
 * mismatched URL (e.g. a CDN that quietly serves WebP behind a .jpg-looking
 * path) can be self-diagnosed before a send fails. */
const WHATSAPP_FORMAT_HINT: Record<string, string> = {
  image: "JPEG or PNG only (not WebP/GIF) · max 5MB",
  video: "MP4 or 3GPP (H.264 + AAC) · max 16MB",
  audio: "AAC, MP4, MPEG, AMR, or OGG (Opus) · max 16MB",
  document: "PDF, Office docs (doc/docx/ppt/pptx/xls/xlsx), or text · max 100MB",
};

/** Live preview of the current media URL — catches broken links, wrong
 * domains, and content that doesn't actually load, right in the editor
 * instead of only surfacing as a failed send later. Note: this can't catch
 * every WhatsApp-specific rejection (e.g. a browser renders WebP fine even
 * though WhatsApp's image type doesn't accept it) — the format hint below
 * covers that gap. */
function MediaPreview({ url, mediaType }: { url: string; mediaType: string }) {
  // No effect needed to reset `failed` when `url` changes — the caller
  // passes `key={url}`, so React remounts this component (fresh state)
  // whenever the URL changes instead.
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] text-amber-700">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        Couldn&apos;t load a preview — double-check the URL is public and reachable.
      </div>
    );
  }
  if (mediaType === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- arbitrary user-pasted/uploaded URL, not a static asset next/image can optimize
      <img
        src={url}
        alt="Preview"
        className="h-24 w-auto max-w-full rounded-lg border border-slate-200 object-cover"
        onError={() => setFailed(true)}
      />
    );
  }
  if (mediaType === "video") {
    return (
      <video
        src={url}
        controls
        className="h-24 w-auto max-w-full rounded-lg border border-slate-200"
        onError={() => setFailed(true)}
      />
    );
  }
  if (mediaType === "audio") {
    return <audio src={url} controls className="w-full" onError={() => setFailed(true)} />;
  }
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-emerald-600">
      <ImageIcon className="h-3 w-3" />
      <span className="max-w-[240px] truncate font-mono">{url}</span>
    </div>
  );
}

function MediaUrlField({
  value,
  mediaType,
  onChange,
}: {
  value: string;
  mediaType: string;
  onChange: (url: string) => void;
}) {
  const [mode, setMode] = useState<MediaInputMode>("url");
  const [uploading, setUploading] = useState(false);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [fileManagerOpen, setFileManagerOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const accept =
    mediaType === "image"
      ? "image/*"
      : mediaType === "video"
        ? "video/*"
        : mediaType === "audio"
          ? "audio/*"
          : "*/*";

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      if (!res.ok) throw new Error("Upload failed");
      const json = (await res.json()) as { url: string };
      onChange(json.url);
      setMode("url");
    } catch {
      toast.error("Upload failed — please try again");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      {/* Mode toggle */}
      <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-100 p-0.5 w-fit">
        <button
          type="button"
          onClick={() => { setMode("url"); setUploadMenuOpen(false); }}
          className={cn(
            "flex items-center gap-1 rounded px-2.5 py-1 text-[10px] font-medium transition-colors",
            mode === "url"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-900",
          )}
        >
          <Link2 className="h-3 w-3" />
          URL
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setUploadMenuOpen((o) => !o)}
            className={cn(
              "flex items-center gap-1 rounded px-2.5 py-1 text-[10px] font-medium transition-colors",
              mode === "upload"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-900",
            )}
          >
            <Upload className="h-3 w-3" />
            Upload
          </button>
          {uploadMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setUploadMenuOpen(false)} />
              <div className="absolute left-0 top-8 z-20 w-48 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    setUploadMenuOpen(false);
                    setMode("upload");
                    setTimeout(() => fileRef.current?.click(), 50);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
                >
                  <Upload className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  From my device
                </button>
                <div className="border-t border-slate-100" />
                <button
                  type="button"
                  onClick={() => { setUploadMenuOpen(false); setFileManagerOpen(true); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
                >
                  <FolderOpen className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
                  From File Manager
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* URL input */}
      {mode === "url" && (
        <Input
          className="h-8 text-xs"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://example.com/file.jpg"
        />
      )}

      {/* Hidden file input — device upload */}
      <input autoComplete="off"
        ref={fileRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleFile}
      />

      {/* File Manager picker */}
      <FileManagerPicker
        open={fileManagerOpen}
        onClose={() => setFileManagerOpen(false)}
        onSelect={(file) => { onChange(file.url); setMode("url"); }}
      />

      {/* Upload progress */}
      {uploading && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Uploading…
        </div>
      )}

      {/* Live preview + format hint — catches a bad/wrong-format URL before
          it fails silently at send time. */}
      {!uploading && value && (
        <div className="space-y-1">
          <MediaPreview key={value} url={value} mediaType={mediaType} />
          {WHATSAPP_FORMAT_HINT[mediaType] && (
            <p className="text-[10px] text-slate-400">
              WhatsApp accepts: {WHATSAPP_FORMAT_HINT[mediaType]}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Per-type forms ──────────────────────────────────────────────

function StartForm({ cfg, allNodes, nodeKey, onChange }: FormProps) {
  const keyword = String(cfg.trigger_keyword ?? "");
  const match = String(cfg.trigger_match ?? "exact");
  const onFlow = cfg.trigger_on === "flow_submitted";

  return (
    <div className="space-y-4">
      <Field label="Start this chatbot when">
        <div className="grid grid-cols-2 gap-2">
          {([
            ["message", "A message arrives"],
            ["flow_submitted", "A WhatsApp Flow is submitted"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => onChange({ ...cfg, trigger_on: value })}
              className={`rounded-md border px-2 py-1.5 text-[11px] font-medium leading-tight transition-colors ${
                (value === "flow_submitted") === onFlow
                  ? "border-indigo-500 bg-indigo-50 text-indigo-600"
                  : "border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-slate-900"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </Field>

      {onFlow ? (
        <FlowSubmittedTrigger cfg={cfg} onChange={onChange} />
      ) : (
        <>
          {/* Trigger keyword */}
          <Field
            label="Trigger keyword"
            hint={
              keyword
                ? `Chatbot starts when a message or button reply ${match === "exact" ? "exactly matches" : match === "contains" ? "contains" : "starts with"} any keyword. Separate multiple keywords with |.`
                : "Leave blank to trigger on every message (always-on)."
            }
          >
            <Input
              className="h-8 text-xs"
              value={keyword}
              onChange={(e) => onChange({ ...cfg, trigger_keyword: e.target.value })}
              placeholder='e.g. "Hi" or "Know More|Start|Hello"'
            />
          </Field>

          {keyword && (
            <Field label="Match type">
              <div className="flex gap-2">
                {(["exact", "contains", "starts_with"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => onChange({ ...cfg, trigger_match: m })}
                    className={`flex-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                      match === m
                        ? "border-indigo-500 bg-indigo-50 text-indigo-600"
                        : "border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-slate-900"
                    }`}
                  >
                    {m === "exact" ? "Exact" : m === "contains" ? "Contains" : "Starts with"}
                  </button>
                ))}
              </div>
            </Field>
          )}
        </>
      )}

      <NodeSelect
        label="First node"
        value={String(cfg.next_node_key ?? "")}
        allNodes={allNodes}
        currentKey={nodeKey}
        onChange={(v) => onChange({ ...cfg, next_node_key: v })}
        hint={onFlow
          ? "Runs right after the customer submits the Flow. Their answers are ready as {{vars.flow_<field>}}."
          : "The first node that runs when this chatbot starts."}
      />
    </div>
  );
}

/**
 * Which submitted Flow starts this chatbot. For Flows sent inside a
 * template — a broadcast, or a template sent from the Inbox — which no
 * chatbot was waiting on. A Flow a chatbot sends itself (Send Flow node)
 * carries on in that chatbot instead.
 */
function FlowSubmittedTrigger({ cfg, onChange }: { cfg: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const [flows, setFlows] = useState<MetaFlowOption[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/flows?flow_type=whatsapp_flow&status=active")
      .then((r) => r.json())
      .then((j: { flows?: Array<{ id: string; name: string; trigger_config: Record<string, unknown> }> }) => {
        setFlows(
          (j.flows ?? [])
            .filter((f) => f.trigger_config?.meta_flow_id)
            .map((f) => ({
              metaFlowId: String(f.trigger_config.meta_flow_id),
              name: f.name,
              variableTokens: extractAllFlowVariables(f.trigger_config?.screens),
            })),
        );
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  // Keep the chosen Flow's field names on the Start node, so later nodes
  // can offer {{vars.flow_x}} without fetching the Flow again.
  useEffect(() => {
    const found = flows.find((f) => f.metaFlowId === String(cfg.trigger_flow_id ?? ""));
    const next = found?.variableTokens ?? [];
    const current = Array.isArray(cfg.available_vars) ? (cfg.available_vars as string[]) : [];
    const same = current.length === next.length && current.every((v, i) => v === next[i]);
    if (loaded && !same) onChange({ ...cfg, available_vars: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flows, loaded, cfg.trigger_flow_id]);

  return (
    <div className="space-y-2">
      <Field
        label="Which Flow"
        hint="Starts when a customer submits this Flow from a template message — a broadcast, or a template sent from the Inbox."
      >
        <Select
          value={String(cfg.trigger_flow_id || "__any__")}
          onValueChange={(v) => {
            const found = flows.find((f) => f.metaFlowId === v);
            onChange({
              ...cfg,
              trigger_flow_id: v === "__any__" ? "" : v,
              trigger_flow_name: found?.name ?? "",
            });
          }}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Any Flow" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__any__" className="text-xs">Any Flow</SelectItem>
            {flows.map((f) => (
              <SelectItem key={f.metaFlowId} value={f.metaFlowId} className="text-xs">
                {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {loaded && flows.length === 0 && (
        <p className="text-[10px] text-amber-600">
          No published Flows yet. Publish one under WhatsApp Flows, or use Sync from Meta on a Send Flow node.
        </p>
      )}
      <div className="rounded-lg border border-sky-200 bg-sky-50 p-2.5 text-[10px] leading-relaxed text-sky-800">
        The template must have a Flow button for this Flow, and be synced in Templates — that is how the
        submission is matched to it. A chatbot tied to a specific Flow is chosen before one set to Any Flow.
      </div>
    </div>
  );
}

function SendTextForm({ cfg, allNodes, nodeKey, onChange }: FormProps) {
  const vars = getFlowVars(allNodes, nodeKey);
  return (
    <div className="space-y-4">
      {vars.length > 0 && (
        <div className="rounded-lg border border-teal-500/30 bg-teal-500/5 p-3 space-y-1">
          <p className="text-[10px] font-semibold text-teal-700">Collected variables available</p>
          <p className="text-[10px] text-teal-600 leading-relaxed">
            Use <span className="font-mono bg-teal-100 px-1 rounded">{"{{name}}"}</span> or <span className="font-mono bg-teal-100 px-1 rounded">{"{{vars.name}}"}</span> in your message to insert a collected value.
          </p>
          <p className="text-[10px] text-teal-500 italic">e.g. &quot;Hello {"{{name}}"}, how can I help?&quot; → &quot;Hello Jithu, how can I help?&quot;</p>
        </div>
      )}
      <Field label="Header text (optional)" hint="Bold text above the message body.">
        <Input
          className="h-8 text-xs"
          value={String(cfg.header_text ?? "")}
          onChange={(e) => onChange({ ...cfg, header_text: e.target.value })}
          placeholder="e.g. Welcome!"
        />
      </Field>
      <Field label="Message text *">
        <RichTextArea
          value={String(cfg.text ?? "")}
          onChange={(v) => onChange({ ...cfg, text: v })}
          placeholder="Type your message…"
          vars={vars}
          minHeight={80}
        />
      </Field>
      <Field label="Footer text (optional)">
        <Input
          className="h-8 text-xs"
          value={String(cfg.footer_text ?? "")}
          onChange={(e) => onChange({ ...cfg, footer_text: e.target.value })}
          placeholder="e.g. Reply STOP to unsubscribe"
        />
      </Field>
      <NodeSelect
        label="Next node"
        value={String(cfg.next_node_key ?? "")}
        allNodes={allNodes}
        currentKey={nodeKey}
        onChange={(v) => onChange({ ...cfg, next_node_key: v })}
      />
    </div>
  );
}

function SendButtonsForm({ cfg, allNodes, nodeKey, onChange }: FormProps) {
  const vars = getFlowVars(allNodes, nodeKey);
  const isCta = cfg.mode === "cta";
  const buttons = Array.isArray(cfg.buttons)
    ? (cfg.buttons as Array<Record<string, unknown>>)
    : [];
  const cta = (cfg.cta_button ?? {}) as Record<string, unknown>;

  const updateButton = (i: number, key: string, val: string) => {
    const updated = buttons.map((b, idx) => (idx === i ? { ...b, [key]: val } : b));
    onChange({ ...cfg, buttons: updated });
  };
  const addButton = () => {
    if (buttons.length >= 3) return;
    const id = `btn_${buttons.length + 1}`;
    onChange({ ...cfg, buttons: [...buttons, { reply_id: id, title: "", next_node_key: "" }] });
  };
  const removeButton = (i: number) => {
    onChange({ ...cfg, buttons: buttons.filter((_, idx) => idx !== i) });
  };
  const updateCta = (key: string, val: string) => {
    onChange({ ...cfg, cta_button: { ...cta, [key]: val } });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-[10px] text-indigo-700 leading-relaxed">
        <span className="font-semibold">Instagram:</span> sent as Button Template (postback) — up to 3 buttons, max 20 chars per label, text up to 640 chars.
        <br/>
        <span className="font-semibold">WhatsApp:</span> sent as interactive buttons — up to 3 buttons.
      </div>

      <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
        <div>
          <p className="text-xs font-medium">CTA URL button</p>
          <p className="text-[10px] text-slate-500">
            Send a single &quot;open link&quot; button instead of quick-reply buttons. WhatsApp never reports a tap — the flow auto-advances immediately.
          </p>
        </div>
        <Switch
          checked={isCta}
          onCheckedChange={(v) =>
            onChange({
              ...cfg,
              mode: v ? "cta" : "normal",
              cta_button: v ? (cfg.cta_button ?? { title: "", url: "", next_node_key: "" }) : cfg.cta_button,
            })
          }
        />
      </div>

      <Field label="Message text *" hint="Shown above the button(s).">
        <RichTextArea
          value={String(cfg.text ?? "")}
          onChange={(v) => onChange({ ...cfg, text: v })}
          placeholder="Choose an option:"
          vars={vars}
          minHeight={60}
        />
      </Field>

      {!isCta && (() => {
        // Single source of truth for which header mode is active, used
        // both for the tab highlighting and the conditional content below
        // — keeps the two from ever disagreeing (e.g. tab shows "Text"
        // highlighted while the media editor is actually rendered).
        const headerIsMedia = cfg.header_media_type !== undefined;
        return (
        <div className="rounded-lg border border-slate-200 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-slate-700">Header (optional)</p>
            <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-100 p-0.5">
              <button
                type="button"
                onClick={() => onChange({ ...cfg, header_media_url: undefined, header_media_type: undefined })}
                className={cn(
                  "rounded px-2.5 py-1 text-[10px] font-medium transition-colors",
                  !headerIsMedia ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900",
                )}
              >
                Text
              </button>
              <button
                type="button"
                onClick={() => onChange({ ...cfg, header_text: undefined, header_media_type: "image" })}
                className={cn(
                  "rounded px-2.5 py-1 text-[10px] font-medium transition-colors",
                  headerIsMedia ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900",
                )}
              >
                Media
              </button>
            </div>
          </div>
          {headerIsMedia ? (
            <>
              <Select
                value={String(cfg.header_media_type ?? "image")}
                onValueChange={(v) => onChange({ ...cfg, header_media_type: v })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["image", "video", "document"].map((t) => (
                    <SelectItem key={t} value={t} className="text-xs capitalize">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <MediaUrlField
                value={String(cfg.header_media_url ?? "")}
                mediaType={String(cfg.header_media_type ?? "image")}
                onChange={(url) => onChange({ ...cfg, header_media_url: url })}
              />
            </>
          ) : (
            <Input
              className="h-8 text-xs"
              value={String(cfg.header_text ?? "")}
              onChange={(e) => onChange({ ...cfg, header_text: e.target.value })}
              placeholder="e.g. Welcome!"
              maxLength={60}
            />
          )}
        </div>
        );
      })()}

      {isCta ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
          <Input
            className="h-7 text-xs"
            value={String(cta.title ?? "")}
            onChange={(e) => updateCta("title", e.target.value)}
            placeholder="Button label (max 20 chars), e.g. Visit our site"
            maxLength={20}
          />
          <Input
            className="h-7 text-xs font-mono"
            value={String(cta.url ?? "")}
            onChange={(e) => updateCta("url", e.target.value)}
            placeholder="https://example.com"
          />
          <p className="text-[10px] text-slate-500">URL must start with https:// (or http://).</p>
          <NodeSelect
            label="Next node"
            value={String(cta.next_node_key ?? "")}
            allNodes={allNodes}
            currentKey={nodeKey}
            onChange={(v) => updateCta("next_node_key", v)}
          />
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-700">
              Buttons ({buttons.length}/3)
            </p>
            {buttons.map((btn, i) => (
              <div key={i} className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Button {i + 1}
                  </span>
                  {buttons.length > 1 && (
                    <button
                      onClick={() => removeButton(i)}
                      className="text-slate-400 hover:text-rose-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <Input
                  className="h-7 text-xs"
                  value={String(btn.title ?? "")}
                  onChange={(e) => updateButton(i, "title", e.target.value)}
                  placeholder="Button label (max 20 chars)"
                  maxLength={20}
                />
                <NodeSelect
                  label="Go to node"
                  value={String(btn.next_node_key ?? "")}
                  allNodes={allNodes}
                  currentKey={nodeKey}
                  onChange={(v) => updateButton(i, "next_node_key", v)}
                />
              </div>
            ))}
            {buttons.length < 3 && (
              <button
                type="button"
                className="flex h-7 w-full items-center justify-center gap-1 rounded-md border border-slate-200 text-xs text-slate-600 hover:bg-slate-50 transition-colors"
                onClick={addButton}
              >
                <Plus className="h-3.5 w-3.5" /> Add button
              </button>
            )}
          </div>

          <Field
            label="Save reply to variable"
            hint="The tapped button's label is stored in this variable for use in later nodes."
          >
            <Input
              className="h-8 text-xs font-mono"
              value={String(cfg.save_reply_to ?? "")}
              onChange={(e) =>
                onChange({ ...cfg, save_reply_to: e.target.value.replace(/[^a-z0-9_]/gi, "_") || undefined })
              }
              placeholder="e.g. selected_option (optional)"
            />
          </Field>
        </>
      )}
    </div>
  );
}

function SendListForm({ cfg, allNodes, nodeKey, onChange }: FormProps) {
  const vars = getFlowVars(allNodes, nodeKey);
  const sections = Array.isArray(cfg.sections)
    ? (cfg.sections as Array<Record<string, unknown>>)
    : [{ title: "", rows: [] }];

  const totalRows = sections.reduce(
    (n, s) => n + ((s.rows as unknown[]) ?? []).length,
    0,
  );

  const updateRow = (si: number, ri: number, key: string, val: string) => {
    const updated = sections.map((sec, sIdx) => {
      if (sIdx !== si) return sec;
      const rows = [...((sec.rows as Array<Record<string, unknown>>) ?? [])];
      rows[ri] = { ...rows[ri], [key]: val };
      return { ...sec, rows };
    });
    onChange({ ...cfg, sections: updated });
  };
  const addRow = (si: number) => {
    if (totalRows >= 10) return;
    const id = `row_${totalRows + 1}`;
    const updated = sections.map((sec, sIdx) => {
      if (sIdx !== si) return sec;
      return {
        ...sec,
        rows: [
          ...((sec.rows as Array<Record<string, unknown>>) ?? []),
          { reply_id: id, title: "", next_node_key: "" },
        ],
      };
    });
    onChange({ ...cfg, sections: updated });
  };
  const removeRow = (si: number, ri: number) => {
    const updated = sections.map((sec, sIdx) => {
      if (sIdx !== si) return sec;
      const rows = ((sec.rows as Array<Record<string, unknown>>) ?? []).filter(
        (_, i) => i !== ri,
      );
      return { ...sec, rows };
    });
    onChange({ ...cfg, sections: updated });
  };

  return (
    <div className="space-y-4">
      <Field label="Message text *">
        <RichTextArea
          value={String(cfg.text ?? "")}
          onChange={(v) => onChange({ ...cfg, text: v })}
          placeholder="Select from the list below:"
          vars={vars}
          minHeight={60}
        />
      </Field>
      <Field label="Button label" hint="Text on the 'tap to open' button.">
        <Input
          className="h-8 text-xs"
          value={String(cfg.button_label ?? "View options")}
          onChange={(e) => onChange({ ...cfg, button_label: e.target.value })}
          placeholder="View options"
        />
      </Field>

      {sections.map((sec, si) => (
        <div key={si} className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
          <Input
            className="h-7 text-xs"
            value={String(sec.title ?? "")}
            onChange={(e) => {
              const updated = sections.map((s, i) =>
                i === si ? { ...s, title: e.target.value } : s,
              );
              onChange({ ...cfg, sections: updated });
            }}
            placeholder="Section title (optional)"
          />
          {((sec.rows as Array<Record<string, unknown>>) ?? []).map((row, ri) => (
            <div key={ri} className="rounded border border-slate-200 bg-white p-2 space-y-1.5">
              <div className="flex gap-1.5">
                <Input
                  className="h-7 flex-1 text-xs"
                  value={String(row.title ?? "")}
                  onChange={(e) => updateRow(si, ri, "title", e.target.value)}
                  placeholder="Row title (max 24 chars)"
                  maxLength={24}
                />
                <button
                  onClick={() => removeRow(si, ri)}
                  className="text-slate-400 hover:text-rose-500"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <Input
                className="h-7 text-xs"
                value={String(row.description ?? "")}
                onChange={(e) => updateRow(si, ri, "description", e.target.value)}
                placeholder="Description (optional, max 72 chars)"
                maxLength={72}
              />
              <NodeSelect
                label="Go to node"
                value={String(row.next_node_key ?? "")}
                allNodes={allNodes}
                currentKey={nodeKey}
                onChange={(v) => updateRow(si, ri, "next_node_key", v)}
              />
            </div>
          ))}
          {totalRows < 10 && (
            <button
              type="button"
              className="flex h-7 w-full items-center justify-center gap-1 rounded-md border border-slate-200 text-xs text-slate-600 hover:bg-slate-50 transition-colors"
              onClick={() => addRow(si)}
            >
              <Plus className="h-3.5 w-3.5" /> Add row
            </button>
          )}
        </div>
      ))}

      <Field
        label="Save reply to variable"
        hint="The selected row's title is stored in this variable for use in later nodes (e.g. condition checks)."
      >
        <Input
          className="h-8 text-xs font-mono"
          value={String(cfg.save_reply_to ?? "")}
          onChange={(e) =>
            onChange({ ...cfg, save_reply_to: e.target.value.replace(/[^a-z0-9_]/gi, "_") || undefined })
          }
          placeholder="e.g. menu_choice (optional)"
        />
      </Field>
    </div>
  );
}

function SendMediaForm({ cfg, allNodes, nodeKey, onChange }: FormProps) {
  const vars = getFlowVars(allNodes, nodeKey);
  return (
    <div className="space-y-4">
      <Field label="Media type">
        <Select
          value={String(cfg.media_type ?? "image")}
          onValueChange={(v) => onChange({ ...cfg, media_type: v })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {["image", "video", "audio", "document"].map((t) => (
              <SelectItem key={t} value={t} className="text-xs capitalize">
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Media *" hint="Paste a public URL or upload a file from your device.">
        <MediaUrlField
          value={String(cfg.media_url ?? "")}
          mediaType={String(cfg.media_type ?? "image")}
          onChange={(url) => onChange({ ...cfg, media_url: url })}
        />
      </Field>
      {cfg.media_type === "document" && (
        <Field label="Filename">
          <Input
            className="h-8 text-xs"
            value={String(cfg.filename ?? "")}
            onChange={(e) => onChange({ ...cfg, filename: e.target.value })}
            placeholder="document.pdf"
          />
        </Field>
      )}
      <Field label="Caption (optional)">
        <RichTextArea
          value={String(cfg.caption ?? "")}
          onChange={(v) => onChange({ ...cfg, caption: v })}
          placeholder="Optional caption text…"
          vars={vars}
          minHeight={60}
        />
      </Field>
      <NodeSelect
        label="Next node"
        value={String(cfg.next_node_key ?? "")}
        allNodes={allNodes}
        currentKey={nodeKey}
        onChange={(v) => onChange({ ...cfg, next_node_key: v })}
      />
    </div>
  );
}

// ─── Input type definitions for collect_input ────────────────────

const INPUT_TYPES: Array<{
  value: string;
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: React.ComponentType<any>;
  hint: string;
}> = [
  { value: "text", label: "Text", icon: Type, hint: "Any free-text reply" },
  { value: "number", label: "Number", icon: Hash, hint: "Numeric value" },
  { value: "email", label: "Email", icon: Mail, hint: "Valid email address" },
  { value: "website", label: "Website", icon: Globe, hint: "URL / website link" },
  { value: "date", label: "Date", icon: Calendar, hint: "Date (YYYY-MM-DD)" },
  { value: "time", label: "Time", icon: Clock, hint: "Time (HH:MM)" },
  { value: "phone", label: "Phone", icon: Phone, hint: "Phone number" },
  { value: "file", label: "File", icon: Paperclip, hint: "File attachment" },
  { value: "location", label: "Location", icon: MapPin, hint: "Shared location pin" },
];

function CollectInputForm({ cfg, allNodes, nodeKey, onChange }: FormProps) {
  const vars = getFlowVars(allNodes, nodeKey);
  const selectedType = String(cfg.input_type ?? "text");
  const selectedMeta = INPUT_TYPES.find((t) => t.value === selectedType);

  return (
    <div className="space-y-4">
      <Field label="Prompt text *" hint="The question you ask the user.">
        <RichTextArea
          value={String(cfg.prompt_text ?? "")}
          onChange={(v) => onChange({ ...cfg, prompt_text: v })}
          placeholder="What's your full name?"
          vars={vars}
          minHeight={70}
        />
      </Field>
      <Field label="Variable key *" hint="Letters, numbers, underscores only. Used to reference the answer in later nodes.">
        <Input
          className="h-8 text-xs font-mono"
          value={String(cfg.var_key ?? "")}
          onChange={(e) =>
            onChange({ ...cfg, var_key: e.target.value.replace(/[^a-z0-9_]/gi, "_") })
          }
          placeholder="customer_name"
        />
      </Field>

      {/* How-to callout */}
      {String(cfg.var_key ?? "").length > 0 && (
        <div className="rounded-lg border border-teal-500/30 bg-teal-500/5 p-3 space-y-1">
          <p className="text-[10px] font-semibold text-teal-700">How to use this answer in other nodes</p>
          <p className="text-[10px] text-teal-600 leading-relaxed">
            In any Send Text, Send Buttons, or other message node, type:
          </p>
          <code className="block text-[11px] font-mono bg-teal-100 text-teal-800 rounded px-2 py-1">
            {`{{${String(cfg.var_key ?? "key")}}}`}
          </code>
          <p className="text-[10px] text-teal-500 italic">
            e.g. message &quot;Hello {"{{" + String(cfg.var_key || "name") + "}}"}&quot; → &quot;Hello Jithu&quot; (user&apos;s answer)
          </p>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-slate-700">Input type</label>
        <div className="grid grid-cols-3 gap-1.5">
          {INPUT_TYPES.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => onChange({ ...cfg, input_type: value })}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg border p-2.5 text-[10px] font-medium transition-colors",
                selectedType === value
                  ? "border-indigo-500 bg-indigo-50 text-indigo-600"
                  : "border-slate-200 bg-slate-50 text-slate-500 hover:border-indigo-200 hover:text-slate-900",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
        {selectedMeta && (
          <p className="text-[10px] text-slate-500">{selectedMeta.hint}</p>
        )}
      </div>

      {/* Validation error message — shown for types that have meaningful validation */}
      {selectedType !== "text" && selectedType !== "file" && selectedType !== "location" && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Validation
          </p>
          <Field
            label="Error message"
            hint={`Sent to the user when their reply is not a valid ${selectedType}. Leave blank to use the default message.`}
          >
            <Input
              className="h-8 text-xs"
              value={String(
                ((cfg.validation as Record<string, unknown> | undefined)?.error_message) ?? ""
              )}
              onChange={(e) =>
                onChange({
                  ...cfg,
                  validation: {
                    ...((cfg.validation as Record<string, unknown>) ?? {}),
                    error_message: e.target.value,
                  },
                })
              }
              placeholder={`e.g. Please enter a valid ${selectedType}`}
            />
          </Field>
          {selectedType === "number" && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Min value">
                <Input
                  type="number"
                  className="h-8 text-xs"
                  value={String(
                    ((cfg.validation as Record<string, unknown> | undefined)?.min) ?? ""
                  )}
                  onChange={(e) =>
                    onChange({
                      ...cfg,
                      validation: {
                        ...((cfg.validation as Record<string, unknown>) ?? {}),
                        min: e.target.value === "" ? undefined : Number(e.target.value),
                      },
                    })
                  }
                  placeholder="no min"
                />
              </Field>
              <Field label="Max value">
                <Input
                  type="number"
                  className="h-8 text-xs"
                  value={String(
                    ((cfg.validation as Record<string, unknown> | undefined)?.max) ?? ""
                  )}
                  onChange={(e) =>
                    onChange({
                      ...cfg,
                      validation: {
                        ...((cfg.validation as Record<string, unknown>) ?? {}),
                        max: e.target.value === "" ? undefined : Number(e.target.value),
                      },
                    })
                  }
                  placeholder="no max"
                />
              </Field>
            </div>
          )}
        </div>
      )}

      <NodeSelect
        label="Next node"
        value={String(cfg.next_node_key ?? "")}
        allNodes={allNodes}
        currentKey={nodeKey}
        onChange={(v) => onChange({ ...cfg, next_node_key: v })}
      />
    </div>
  );
}

function ConditionForm({ cfg, allNodes, nodeKey, onChange }: FormProps) {
  const operators = [
    "equals", "not_equals", "contains", "starts_with", "ends_with",
    "present", "absent", "gt", "lt", "gte", "lte",
  ];
  const needsValue = !["present", "absent"].includes(String(cfg.operator ?? "equals"));
  const subject = String(cfg.subject ?? "var");

  // All var_key values from collect_input nodes in this flow
  const collectInputVars = allNodes
    .filter((n) => n.node_key !== nodeKey && n.node_type === "collect_input")
    .map((n) => (typeof n.config.var_key === "string" ? n.config.var_key : ""))
    .filter(Boolean);

  return (
    <div className="space-y-4">
      <Field label="Subject type">
        <Select
          value={subject}
          onValueChange={(v) => onChange({ ...cfg, subject: v, subject_key: "" })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="var" className="text-xs">Variable</SelectItem>
            <SelectItem value="tag" className="text-xs">Tag</SelectItem>
            <SelectItem value="contact_field" className="text-xs">Contact field</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field
        label={subject === "tag" ? "Tag" : subject === "contact_field" ? "Field" : "Variable key"}
      >
        {subject === "var" ? (
          <Select
            value={String(cfg.subject_key ?? "")}
            onValueChange={(v) => onChange({ ...cfg, subject_key: v })}
            disabled={collectInputVars.length === 0}
          >
            <SelectTrigger className="h-8 text-xs font-mono">
              <SelectValue placeholder={collectInputVars.length === 0 ? "No Collect Input nodes yet…" : "Pick a variable…"} />
            </SelectTrigger>
            <SelectContent>
              {collectInputVars.map((key) => (
                <SelectItem key={key} value={key} className="font-mono text-xs">
                  {key}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : subject === "contact_field" ? (
          <Select
            value={String(cfg.subject_key ?? "")}
            onValueChange={(v) => onChange({ ...cfg, subject_key: v })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Pick a field…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name" className="text-xs">name</SelectItem>
              <SelectItem value="email" className="text-xs">email</SelectItem>
              <SelectItem value="phone" className="text-xs">phone</SelectItem>
              <SelectItem value="company" className="text-xs">company</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <Input
            className="h-8 text-xs font-mono"
            value={String(cfg.subject_key ?? "")}
            onChange={(e) => onChange({ ...cfg, subject_key: e.target.value })}
            placeholder="Tag name or UUID"
          />
        )}
      </Field>
      <Field label="Operator">
        <Select
          value={String(cfg.operator ?? "equals")}
          onValueChange={(v) => onChange({ ...cfg, operator: v })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {operators.map((op) => (
              <SelectItem key={op} value={op} className="text-xs">
                {op.replace("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {needsValue && (
        <Field label="Compare value">
          <Input
            className="h-8 text-xs"
            value={String(cfg.value ?? "")}
            onChange={(e) => onChange({ ...cfg, value: e.target.value })}
            placeholder="expected value…"
          />
        </Field>
      )}

      {/* Case sensitivity toggle — only relevant for text operators */}
      {needsValue && !["gt", "lt", "gte", "lte"].includes(String(cfg.operator ?? "equals")) && (
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input autoComplete="off"
            type="checkbox"
            className="h-3.5 w-3.5 rounded border-slate-200 accent-indigo-600"
            checked={cfg.case_sensitive !== false}
            onChange={(e) => onChange({ ...cfg, case_sensitive: e.target.checked })}
          />
          <span className="text-xs text-slate-500">Case sensitive</span>
          <span className="text-[10px] text-slate-400">
            {cfg.case_sensitive !== false
              ? '("Jithu" ≠ "jithu")'
              : '("Jithu" = "jithu")'}
          </span>
        </label>
      )}

      <div className="grid grid-cols-2 gap-3">
        <NodeSelect
          label="✓ True → node"
          value={String(cfg.true_next ?? "")}
          allNodes={allNodes}
          currentKey={nodeKey}
          onChange={(v) => onChange({ ...cfg, true_next: v })}
        />
        <NodeSelect
          label="✗ False → node"
          value={String(cfg.false_next ?? "")}
          allNodes={allNodes}
          currentKey={nodeKey}
          onChange={(v) => onChange({ ...cfg, false_next: v })}
        />
      </div>
    </div>
  );
}

/**
 * Settings this node inherits from Settings -> AI Config.
 *
 * Fetched rather than hardcoded, because the last version hardcoded them
 * and was wrong about every one: it offered a 300-token cap against an
 * account default of 2048, so editing the field quietly made replies
 * five times shorter than the account intended.
 */
type AccountAiDefaults = {
  max_tokens: number;
  history_depth_default: number;
  model: string | null;
  has_system_prompt: boolean;
  knowledge_base_enabled: boolean;
  /** So a step left unset can say which way the account currently
   *  decides, instead of showing a switch whose position means nothing. */
  customer_context_enabled: boolean;
};

function useAccountAiDefaults(): AccountAiDefaults | null {
  const [defaults, setDefaults] = useState<AccountAiDefaults | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/ai-config');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setDefaults({
          max_tokens: data.max_tokens ?? 2048,
          history_depth_default: data.history_depth_default ?? 6,
          model: data.provider_keys?.gemini?.model ?? null,
          has_system_prompt: Boolean(data.system_prompt?.trim()),
          knowledge_base_enabled: data.knowledge_base_enabled !== false,
          customer_context_enabled: data.customer_context_enabled !== false,
        });
      } catch {
        /* the form still works; it just cannot name the numbers */
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return defaults;
}

function AiReplyForm({ cfg, allNodes, nodeKey, onChange }: FormProps) {
  const vars = getFlowVars(allNodes, nodeKey);
  const defaults = useAccountAiDefaults();

  const overridesTokens = cfg.max_tokens !== undefined && cfg.max_tokens !== null;
  const overridesHistory = cfg.history_depth !== undefined && cfg.history_depth !== null;

  return (
    <div className="space-y-4">
      {/* What this node does without any configuration at all. Stated
          first because it is the answer to the question somebody opening
          this panel is actually asking. */}
      <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-3">
        <p className="text-xs font-semibold text-indigo-900">Uses your AI settings</p>
        <p className="mt-0.5 text-[10.5px] leading-relaxed text-indigo-800/80">
          This step answers with the assistant you set up in Settings &rarr; AI Config: the same persona,
          knowledge base, guardrails and language handling a customer gets anywhere else. Nothing below is
          required — it is all for changing this one step.
        </p>
        {defaults && (
          <ul className="mt-2 space-y-0.5 text-[10.5px] text-indigo-900/80">
            <li>Model: <span className="font-mono">{defaults.model ?? 'account default'}</span></li>
            <li>Reply length: up to {defaults.max_tokens} tokens</li>
            <li>History: last {defaults.history_depth_default} messages</li>
            <li>
              Knowledge base:{' '}
              {defaults.knowledge_base_enabled ? 'on — answers are grounded in your entries' : 'off'}
            </li>
            {!defaults.has_system_prompt && (
              <li className="font-semibold text-amber-800">
                No customer prompt is set on the account — set one, or replies fall back to a generic assistant.
              </li>
            )}
          </ul>
        )}
      </div>

      <Field
        label="Extra instructions for this step"
        hint="Optional. Added on top of your AI settings — it does not replace them."
      >
        <RichTextArea
          value={String(cfg.system_prompt ?? "")}
          onChange={(v) => onChange({ ...cfg, system_prompt: v })}
          placeholder="e.g. Only discuss admissions here. If they ask about fees, send them to the fees step."
          vars={vars}
          minHeight={80}
        />
      </Field>

      <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
        <div>
          <p className="text-xs font-medium">Include conversation history</p>
          <p className="text-[10px] text-slate-500">Sends recent messages as context</p>
        </div>
        <Switch
          checked={cfg.include_history !== false}
          onCheckedChange={(v) => onChange({ ...cfg, include_history: v })}
        />
      </div>

      {/* Left unset on purpose until somebody touches it, so the account
          setting keeps deciding for every chatbot built before this
          existed. Only a deliberate change pins it to this step. */}
      <div className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 p-3">
        <div className="min-w-0">
          <p className="text-xs font-medium">Look the customer up first</p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
            Reads their record before answering — their lead and its stage, what was discussed before, and any
            follow-up due. Worth it where the answer depends on who is asking; unnecessary for a step that just
            states opening hours.
            {cfg.use_customer_context === undefined && defaults && (
              <span className="mt-0.5 block text-slate-400">
                Following your AI settings: currently{' '}
                {defaults.customer_context_enabled ? 'on' : 'off'} for every step.
              </span>
            )}
          </p>
        </div>
        <Switch
          checked={(cfg.use_customer_context as boolean | undefined) ?? defaults?.customer_context_enabled ?? true}
          onCheckedChange={(v) => onChange({ ...cfg, use_customer_context: v })}
        />
      </div>

      {cfg.include_history !== false && (
        <OverrideField
          label="History depth"
          defaultLabel={defaults ? `${defaults.history_depth_default} messages` : 'account default'}
          overriding={overridesHistory}
          onUseDefault={() => {
            // Deleted, never set to the account's number: copying the
            // value here would freeze it, and changing the account
            // setting later would silently skip this node.
            const next = { ...cfg };
            delete next.history_depth;
            onChange(next);
          }}
          onOverride={() => onChange({ ...cfg, history_depth: defaults?.history_depth_default ?? 6 })}
        >
          <Input
            type="number"
            className="h-8 text-xs"
            min={1}
            max={20}
            value={Number(cfg.history_depth ?? defaults?.history_depth_default ?? 6)}
            onChange={(e) => onChange({ ...cfg, history_depth: Number(e.target.value) })}
          />
        </OverrideField>
      )}

      <OverrideField
        label="Reply length"
        defaultLabel={defaults ? `${defaults.max_tokens} tokens` : 'account default'}
        overriding={overridesTokens}
        onUseDefault={() => {
          const next = { ...cfg };
          delete next.max_tokens;
          onChange(next);
        }}
        onOverride={() => onChange({ ...cfg, max_tokens: defaults?.max_tokens ?? 2048 })}
      >
        <Input
          type="number"
          className="h-8 text-xs"
          min={50}
          // Matches the account's own ceiling. The old 1000 here capped
          // replies below what the account allowed, with no sign that it
          // had.
          max={8192}
          step={50}
          value={Number(cfg.max_tokens ?? defaults?.max_tokens ?? 2048)}
          onChange={(e) => onChange({ ...cfg, max_tokens: Number(e.target.value) })}
        />
      </OverrideField>

      <Field
        label="Save response to variable (optional)"
        hint="Store AI reply in {{vars.key}}"
      >
        <Input
          className="h-8 text-xs font-mono"
          value={String(cfg.save_response_to ?? "")}
          onChange={(e) => onChange({ ...cfg, save_response_to: e.target.value })}
          placeholder="ai_reply"
        />
      </Field>

      <NodeSelect
        label="Next node"
        value={String(cfg.next_node_key ?? "")}
        allNodes={allNodes}
        currentKey={nodeKey}
        onChange={(v) => onChange({ ...cfg, next_node_key: v })}
      />
    </div>
  );
}

/**
 * A setting that follows the account unless somebody decides otherwise.
 *
 * The distinction matters more than it looks: a field pre-filled with a
 * copy of the account's value looks identical to one that is inheriting
 * it, and the two behave completely differently when the account setting
 * is later changed. Showing which state it is in is the whole point.
 */
function OverrideField({
  label, defaultLabel, overriding, onUseDefault, onOverride, children,
}: {
  label: string;
  defaultLabel: string;
  overriding: boolean;
  onUseDefault: () => void;
  onOverride: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-slate-700">{label}</span>
        {overriding ? (
          <button
            type="button"
            onClick={onUseDefault}
            className="text-[10px] font-medium text-indigo-600 hover:underline"
          >
            Use account default
          </button>
        ) : (
          <button
            type="button"
            onClick={onOverride}
            className="text-[10px] font-medium text-slate-500 hover:text-indigo-600 hover:underline"
          >
            Override for this step
          </button>
        )}
      </div>
      {overriding ? (
        children
      ) : (
        <p className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-[11px] text-slate-500">
          Following your AI settings &mdash; {defaultLabel}
        </p>
      )}
    </div>
  );
}

function HttpRequestForm({ cfg, allNodes, nodeKey, onChange }: FormProps) {
  const vars = getFlowVars(allNodes, nodeKey);
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Field label="Method">
          <Select
            value={String(cfg.method ?? "GET")}
            onValueChange={(v) => onChange({ ...cfg, method: v })}
          >
            <SelectTrigger className="h-8 w-24 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                <SelectItem key={m} value={m} className="text-xs font-mono">
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="flex-1">
          <Field label="URL *" hint="Supports {{vars.x}} interpolation">
            <Input
              className="h-8 text-xs"
              value={String(cfg.url ?? "")}
              onChange={(e) => onChange({ ...cfg, url: e.target.value })}
              placeholder="https://api.example.com/endpoint"
            />
          </Field>
        </div>
      </div>
      {cfg.method !== "GET" && cfg.method !== "DELETE" && (
        <Field label="Request body (JSON)" hint="Use {{vars.x}} for dynamic values">
          <Textarea
            className="min-h-[80px] resize-none font-mono text-xs"
            value={String(cfg.body ?? "")}
            onChange={(e) => onChange({ ...cfg, body: e.target.value })}
            placeholder='{"key": "{{vars.my_var}}"}'
          />
          <VarChips
            vars={vars}
            onInsert={(v) => onChange({ ...cfg, body: String(cfg.body ?? "") + v })}
          />
        </Field>
      )}
      <Field
        label="Save response to variable"
        hint="JSONPath e.g. $.data.id, or blank for full JSON"
      >
        <Input
          className="h-8 text-xs font-mono"
          value={String(cfg.response_var ?? "")}
          onChange={(e) => onChange({ ...cfg, response_var: e.target.value })}
          placeholder="api_result"
        />
      </Field>
      <NodeSelect
        label="Success → next node"
        value={String(cfg.next_node_key ?? "")}
        allNodes={allNodes}
        currentKey={nodeKey}
        onChange={(v) => onChange({ ...cfg, next_node_key: v })}
      />
      <NodeSelect
        label="Error → node (optional)"
        value={String(cfg.error_node_key ?? "")}
        allNodes={allNodes}
        currentKey={nodeKey}
        onChange={(v) => onChange({ ...cfg, error_node_key: v })}
        hint="Goes here on 4xx/5xx response"
      />
    </div>
  );
}

function DelayForm({ cfg, allNodes, nodeKey, onChange }: FormProps) {
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Field label="Duration">
          <Input
            type="number"
            className="h-8 w-20 text-xs"
            min={1}
            max={1440}
            value={Number(cfg.duration ?? 3)}
            onChange={(e) => onChange({ ...cfg, duration: Number(e.target.value) })}
          />
        </Field>
        <Field label="Unit">
          <Select
            value={String(cfg.unit ?? "seconds")}
            onValueChange={(v) => onChange({ ...cfg, unit: v })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="seconds" className="text-xs">
                Seconds
              </SelectItem>
              <SelectItem value="minutes" className="text-xs">
                Minutes
              </SelectItem>
              <SelectItem value="hours" className="text-xs">
                Hours
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
        <div>
          <p className="text-xs font-medium">Show typing indicator</p>
          <p className="text-[10px] text-slate-500">
            Displays &quot;...&quot; to the user during delay
          </p>
        </div>
        <Switch
          checked={cfg.show_typing !== false}
          onCheckedChange={(v) => onChange({ ...cfg, show_typing: v })}
        />
      </div>
      <NodeSelect
        label="Next node"
        value={String(cfg.next_node_key ?? "")}
        allNodes={allNodes}
        currentKey={nodeKey}
        onChange={(v) => onChange({ ...cfg, next_node_key: v })}
      />
    </div>
  );
}

function SetVariableForm({ cfg, allNodes, nodeKey, onChange }: FormProps) {
  const vars = getFlowVars(allNodes, nodeKey);
  const assignments = Array.isArray(cfg.assignments)
    ? (cfg.assignments as Array<Record<string, unknown>>)
    : [];
  const update = (i: number, key: string, val: string) => {
    onChange({
      ...cfg,
      assignments: assignments.map((a, idx) => (idx === i ? { ...a, [key]: val } : a)),
    });
  };
  const add = () =>
    onChange({ ...cfg, assignments: [...assignments, { var_key: "", value: "" }] });
  const remove = (i: number) =>
    onChange({ ...cfg, assignments: assignments.filter((_, idx) => idx !== i) });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-xs font-medium text-slate-700">Assignments</p>
        {assignments.map((a, i) => (
          <div key={i} className="space-y-1">
            <div className="flex gap-1.5">
              <Input
                className="h-7 flex-1 font-mono text-xs"
                value={String(a.var_key ?? "")}
                onChange={(e) => update(i, "var_key", e.target.value)}
                placeholder="var_key"
              />
              <span className="flex items-center text-xs text-slate-500">=</span>
              <Input
                className="h-7 flex-1 text-xs"
                value={String(a.value ?? "")}
                onChange={(e) => update(i, "value", e.target.value)}
                placeholder="value or {{vars.x}}"
              />
              {assignments.length > 1 && (
                <button
                  onClick={() => remove(i)}
                  className="text-slate-500 hover:text-rose-500"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <VarChips
              vars={vars}
              onInsert={(v) => update(i, "value", String(a.value ?? "") + v)}
            />
          </div>
        ))}
        <button
          type="button"
          className="flex h-7 w-full items-center justify-center gap-1 rounded-md border border-slate-200 text-xs text-slate-600 hover:bg-slate-50 transition-colors"
          onClick={add}
        >
          <Plus className="h-3.5 w-3.5" /> Add assignment
        </button>
      </div>
      <NodeSelect
        label="Next node"
        value={String(cfg.next_node_key ?? "")}
        allNodes={allNodes}
        currentKey={nodeKey}
        onChange={(v) => onChange({ ...cfg, next_node_key: v })}
      />
    </div>
  );
}

function SetTagForm({ cfg, allNodes, nodeKey, onChange }: FormProps) {
  return (
    <div className="space-y-4">
      <Field label="Action">
        <Select
          value={String(cfg.mode ?? "add")}
          onValueChange={(v) => onChange({ ...cfg, mode: v })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="add" className="text-xs">
              Add tag
            </SelectItem>
            <SelectItem value="remove" className="text-xs">
              Remove tag
            </SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="Tag ID" hint="Enter the tag's ID from your Tags settings.">
        <Input
          className="h-8 text-xs"
          value={String(cfg.tag_id ?? "")}
          onChange={(e) => onChange({ ...cfg, tag_id: e.target.value })}
          placeholder="tag_id_here"
        />
      </Field>
      <NodeSelect
        label="Next node"
        value={String(cfg.next_node_key ?? "")}
        allNodes={allNodes}
        currentKey={nodeKey}
        onChange={(v) => onChange({ ...cfg, next_node_key: v })}
      />
    </div>
  );
}

function UpdateContactForm({ cfg, allNodes, nodeKey, onChange }: FormProps) {
  const vars = getFlowVars(allNodes, nodeKey);
  return (
    <div className="space-y-4">
      <Field label="Field" hint="Standard fields: name, email, phone. Or a custom field key.">
        <Input
          className="h-8 text-xs"
          value={String(cfg.field ?? "")}
          onChange={(e) => onChange({ ...cfg, field: e.target.value })}
          placeholder="e.g. email or custom_field"
        />
      </Field>
      <Field label="Value" hint="Supports {{vars.x}} interpolation.">
        <Input
          className="h-8 text-xs"
          value={String(cfg.value ?? "")}
          onChange={(e) => onChange({ ...cfg, value: e.target.value })}
          placeholder="{{vars.collected_email}}"
        />
        <VarChips
          vars={vars}
          onInsert={(v) => onChange({ ...cfg, value: String(cfg.value ?? "") + v })}
        />
      </Field>
      <NodeSelect
        label="Next node"
        value={String(cfg.next_node_key ?? "")}
        allNodes={allNodes}
        currentKey={nodeKey}
        onChange={(v) => onChange({ ...cfg, next_node_key: v })}
      />
    </div>
  );
}

/** Roles that can actually reply. A viewer cannot send a message, so
 *  offering one here would only ever route a customer into silence.
 *  This used to list role 'agent' alone, which left out the owners and
 *  supervisors who usually cover. */
const TRANSFERABLE_ROLES = ['owner', 'supervisor', 'admin', 'agent'];

function HandoffForm({ cfg, onChange }: FormProps) {
  const [agents, setAgents] = useState<{ user_id: string; full_name: string; role: string }[]>([]);

  useEffect(() => {
    fetch('/api/account/members')
      .then((r) => r.ok ? r.json() : { members: [] })
      .then((d) => {
        const members = (d.members ?? []) as { user_id: string; full_name: string; role: string }[];
        setAgents(members.filter((m) => TRANSFERABLE_ROLES.includes(m.role)));
      })
      .catch(() => {});
  }, []);

  const strategy = String(cfg.routing_strategy ?? 'specific');

  // The default differs by strategy, and the switch has to show the
  // default it will actually get. Naming one person is a decision, so
  // that route honours them whether or not they are signed in unless
  // asked otherwise; "whoever is free" means nothing if it can pick
  // somebody who went home, so there it is on unless turned off.
  const onlyOnline =
    strategy === 'specific' ? cfg.only_online === true : cfg.only_online !== false;

  return (
    <div className="space-y-4">
      {/* Who takes it */}
      <Field
        label="Who takes the conversation"
        hint="Choose one person, or let it go to whoever is working at the time."
      >
        <Select
          value={strategy}
          onValueChange={(v) => onChange({ ...cfg, routing_strategy: v })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="specific">A specific person</SelectItem>
            <SelectItem value="least_busy">Whoever has the fewest open chats</SelectItem>
            <SelectItem value="round_robin">Take it in turns</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {strategy === 'specific' && (
        <Field
          label="Assign to"
          hint="The conversation will be assigned to this person when handoff occurs."
        >
          <Select
            value={String(cfg.assign_to ?? "")}
            onValueChange={(v) => onChange({ ...cfg, assign_to: v || undefined })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select someone (optional)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Unassigned</SelectItem>
              {agents.map((a) => (
                <SelectItem key={a.user_id} value={a.user_id}>
                  {a.full_name || a.user_id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      {/* Presence. Worth stating the window: somebody who reads "signed
          in" as "this second" and finds transfers going to people who
          stepped away has been told something untrue. */}
      <div className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-700">Only transfer to people who are signed in</p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
            {strategy === 'specific'
              ? 'If they are not signed in, the fallback below is used instead.'
              : 'Counts anyone active in the last 15 minutes.'}
          </p>
        </div>
        <Switch
          checked={onlyOnline}
          onCheckedChange={(v) => onChange({ ...cfg, only_online: v })}
        />
      </div>

      <Field
        label="If nobody is available"
        hint="Used when the choice above finds no one. Left unassigned in the inbox otherwise, where everybody can see it."
      >
        <Select
          value={String(cfg.fallback_assign_to ?? "")}
          onValueChange={(v) => onChange({ ...cfg, fallback_assign_to: v || undefined })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Leave unassigned" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Leave unassigned</SelectItem>
            {agents.map((a) => (
              <SelectItem key={a.user_id} value={a.user_id}>
                {a.full_name || a.user_id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <div className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-700">Send them an app notification</p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
            A push notification, if they have allowed them in their browser.
          </p>
        </div>
        <Switch
          checked={cfg.notify_push !== false}
          onCheckedChange={(v) => onChange({ ...cfg, notify_push: v })}
        />
      </div>

      {/* What the customer is told. Placed before the agent-facing
          settings because it is the half they actually experience. */}
      <Field
        label="What the customer is told"
        hint="Sent as soon as the conversation reaches a person. Leave empty to say nothing."
      >
        <RichTextArea
          value={String(cfg.customer_message ?? "")}
          onChange={(v) => onChange({ ...cfg, customer_message: v })}
          placeholder={"Thanks {{name}} — I'm passing you to one of our team now. They'll reply here shortly."}
          minHeight={64}
        />
      </Field>

      <Field
        label="What they are told if nobody is available"
        hint="Everyone signed out, or all busy. Kept separate because “someone is with you now” is a promise you cannot keep at eleven at night."
      >
        <RichTextArea
          value={String(cfg.unavailable_message ?? "")}
          onChange={(v) => onChange({ ...cfg, unavailable_message: v })}
          placeholder={"Thanks {{name}} — our team is away from their desks at the moment. Your message is saved and someone will reply here as soon as they are back."}
          minHeight={64}
        />
        <p className="mt-1 text-[10px] text-slate-500">
          Left empty, the message above is used for both.
        </p>
      </Field>

      {/* Notification message to agent's WhatsApp */}
      <Field
        label="Notify them on WhatsApp"
        hint="Sent to the number on their own profile. Someone with no number saved gets nothing — leave this empty to skip it."
      >
        <RichTextArea
          value={String(cfg.notify_message ?? "")}
          onChange={(v) => onChange({ ...cfg, notify_message: v })}
          placeholder={`New chat assigned for you\nName: {{name}} | Number: {{number}}\nLast message: {{last_message}}`}
          minHeight={80}
        />
        <p className="mt-1 text-[10px] text-slate-500">
          Variables: <code className="rounded bg-slate-100 px-1">{"{{name}}"}</code> customer name · <code className="rounded bg-slate-100 px-1">{"{{number}}"}</code> customer number · <code className="rounded bg-slate-100 px-1">{"{{last_message}}"}</code>
        </p>
      </Field>

      {/* Internal note */}
      <Field
        label="Handoff note (optional)"
        hint="Internal note visible to the agent in the conversation."
      >
        <RichTextArea
          value={String(cfg.note ?? "")}
          onChange={(v) => onChange({ ...cfg, note: v })}
          placeholder="Summarize why this was escalated…"
          minHeight={60}
        />
      </Field>

      {/* Auto-reopen timeout */}
      <Field
        label="Auto-reopen after (optional)"
        hint="If the agent doesn't respond, reopen the conversation after this many hours. Leave empty to disable."
      >
        <div className="flex items-center gap-2">
          <input autoComplete="off"
            type="number"
            min={1}
            max={720}
            className="w-24 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="e.g. 24"
            value={(cfg.timeout_hours as number | undefined) ?? ""}
            onChange={(e) => {
              const v = e.target.value === "" ? undefined : Math.max(1, parseInt(e.target.value, 10) || 1);
              onChange({ ...cfg, timeout_hours: v });
            }}
          />
          <span className="text-xs text-slate-500">hours</span>
          {(cfg.timeout_hours as number | undefined) && (cfg.timeout_hours as number) >= 24 && (
            <span className="text-xs text-slate-500">
              ({Math.round((cfg.timeout_hours as number) / 24)} day{Math.round((cfg.timeout_hours as number) / 24) !== 1 ? "s" : ""})
            </span>
          )}
        </div>
      </Field>
    </div>
  );
}

function MemberSelectField({
  label,
  hint,
  value,
  members,
  onValueChange,
}: {
  label: string;
  hint?: string;
  value: string;
  members: { user_id: string; full_name: string }[];
  onValueChange: (v: string) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <Select value={value} onValueChange={(v) => onValueChange(v ?? "")}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Unassigned" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="" className="text-xs text-slate-500">Unassigned</SelectItem>
          {members.map((m) => (
            <SelectItem key={m.user_id} value={m.user_id} className="text-xs">
              {m.full_name || m.user_id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function CrmActionForm({ cfg, allNodes, nodeKey, onChange }: FormProps) {
  const vars = getFlowVars(allNodes, nodeKey);
  const action = String(cfg.action ?? "create_lead");

  const [members, setMembers] = useState<{ user_id: string; full_name: string }[]>([]);
  const [segments, setSegments] = useState<{ id: string; name: string }[]>([]);
  const [leadSources, setLeadSources] = useState<{ icon: string; label: string }[]>([
    { icon: "", label: "WhatsApp" }, { icon: "", label: "Instagram" },
    { icon: "🌐", label: "Website" }, { icon: "📣", label: "Campaign" },
    { icon: "🔗", label: "Referral" }, { icon: "👤", label: "Manual" }, { icon: "📝", label: "Other" },
  ]);

  useEffect(() => {
    fetch("/api/account/members")
      .then((r) => r.ok ? r.json() : { members: [] })
      .then((d) => setMembers((d.members ?? []) as { user_id: string; full_name: string }[]))
      .catch(() => {});
    fetch("/api/segments")
      .then((r) => r.ok ? r.json() : { segments: [] })
      .then((d) => setSegments((d.segments ?? []) as { id: string; name: string }[]))
      .catch(() => {});
    fetch("/api/leads/settings")
      .then((r) => r.ok ? r.json() : {})
      .then((d: Record<string, unknown>) => {
        if (Array.isArray(d.lead_sources) && d.lead_sources.length > 0) {
          setLeadSources(d.lead_sources.map((v: unknown) =>
            typeof v === "string" ? { icon: "", label: v } : v as { icon: string; label: string }
          ));
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-4">
      {/* Action type */}
      <Field label="CRM Action">
        <Select
          value={action}
          onValueChange={(v) => onChange({ action: v, next_node_key: cfg.next_node_key ?? "" })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="create_lead" className="text-xs">Create Lead</SelectItem>
            <SelectItem value="add_to_segment" className="text-xs">Add to Segment</SelectItem>
            <SelectItem value="create_followup" className="text-xs">Create Follow-up</SelectItem>
            <SelectItem value="create_task" className="text-xs">Create Task</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {/* ── CREATE LEAD ── */}
      {action === "create_lead" && (
        <>
          {/* Mode: upsert vs always-new */}
          <Field
            label="Mode"
            hint={
              (cfg.lead_mode ?? "upsert") === "upsert"
                ? "If the contact already has a lead, update it. Otherwise create a new one."
                : "Always create a new lead, even if one already exists for this contact."
            }
          >
            <div className="flex gap-1.5">
              {(
                [
                  { value: "upsert", label: "Create or Update" },
                  { value: "create_new", label: "Always Create New" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChange({ ...cfg, lead_mode: opt.value })}
                  className={`flex-1 rounded-md border px-2 py-1.5 text-[11px] font-medium transition-colors ${
                    (cfg.lead_mode ?? "upsert") === opt.value
                      ? "border-indigo-500 bg-indigo-50 text-indigo-600"
                      : "border-slate-200 text-slate-500 hover:border-indigo-200 hover:text-slate-900"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Lead title" hint="Supports {{vars.x}}. Defaults to contact name if empty.">
            <Input
              className="h-8 text-xs"
              value={String(cfg.lead_title ?? "")}
              onChange={(e) => onChange({ ...cfg, lead_title: e.target.value })}
              placeholder="e.g. Interested in product A"
            />
            <VarChips vars={vars} onInsert={(v) => onChange({ ...cfg, lead_title: String(cfg.lead_title ?? "") + v })} />
          </Field>
          <Field label="Source">
            <Select
              value={String(cfg.lead_source ?? leadSources[0]?.label ?? "WhatsApp")}
              onValueChange={(v) => onChange({ ...cfg, lead_source: v })}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {leadSources.map(({ icon, label }) => {
                  const isUrl = icon.startsWith("data:") || icon.startsWith("http") || icon.startsWith("/")
                  return (
                    <SelectItem key={label} value={label} className="text-xs">
                      <span className="flex items-center gap-1.5">
                        {icon && (isUrl
                          ? <img src={icon} alt="" className="h-3.5 w-3.5 object-contain shrink-0" />
                          : <span className="leading-none">{icon}</span>
                        )}
                        {label}
                      </span>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <Select
                value={String(cfg.lead_status ?? "new")}
                onValueChange={(v) => onChange({ ...cfg, lead_status: v })}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new" className="text-xs">New</SelectItem>
                  <SelectItem value="call_not_connected" className="text-xs">Not Connected</SelectItem>
                  <SelectItem value="visited" className="text-xs">Visited</SelectItem>
                  <SelectItem value="appointment_fixed" className="text-xs">Appointment Fixed</SelectItem>
                  <SelectItem value="follow_up" className="text-xs">Follow-up</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Score">
              <Select
                value={String(cfg.lead_score ?? "warm")}
                onValueChange={(v) => onChange({ ...cfg, lead_score: v })}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["hot", "warm", "cold"].map((s) => (
                    <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <MemberSelectField
            label="Assign to"
            hint="Optional — assign lead to a team member."
            value={String(cfg.lead_assigned_to ?? "")}
            members={members}
            onValueChange={(v) => onChange({ ...cfg, lead_assigned_to: v || undefined })}
          />
        </>
      )}

      {/* ── ADD TO SEGMENT ── */}
      {action === "add_to_segment" && (
        <Field label="Segment" hint="The contact will be tagged with this segment.">
          <Select
            value={String(cfg.segment_id ?? "")}
            onValueChange={(v) => onChange({ ...cfg, segment_id: v || undefined })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select a segment…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="" className="text-xs text-slate-500">— select —</SelectItem>
              {segments.map((s) => (
                <SelectItem key={s.id} value={s.id} className="text-xs">{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      {/* ── CREATE FOLLOW-UP ── */}
      {action === "create_followup" && (
        <>
          <Field label="Title" hint="Supports {{vars.x}}. Defaults to 'Follow up with <name>'.">
            <Input
              className="h-8 text-xs"
              value={String(cfg.followup_title ?? "")}
              onChange={(e) => onChange({ ...cfg, followup_title: e.target.value })}
              placeholder="e.g. Call back {{vars.name}}"
            />
            <VarChips vars={vars} onInsert={(v) => onChange({ ...cfg, followup_title: String(cfg.followup_title ?? "") + v })} />
          </Field>
          <Field label="Note (optional)">
            <Input
              className="h-8 text-xs"
              value={String(cfg.followup_note ?? "")}
              onChange={(e) => onChange({ ...cfg, followup_note: e.target.value })}
              placeholder="e.g. Customer showed interest"
            />
          </Field>
          <Field label="Due in (hours)" hint="Hours from now when the follow-up is due. Default: 24 hours.">
            <input autoComplete="off"
              type="number"
              min={1}
              className="h-8 w-24 rounded-md border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
              value={(cfg.followup_due_hours as number | undefined) ?? 24}
              onChange={(e) => onChange({ ...cfg, followup_due_hours: Math.max(1, parseInt(e.target.value, 10) || 24) })}
            />
          </Field>
          <MemberSelectField
            label="Assign to"
            value={String(cfg.followup_assigned_to ?? "")}
            members={members}
            onValueChange={(v) => onChange({ ...cfg, followup_assigned_to: v || undefined })}
          />
        </>
      )}

      {/* ── CREATE TASK ── */}
      {action === "create_task" && (
        <>
          <Field label="Title" hint="Supports {{vars.x}}. Defaults to 'Task for <name>'.">
            <Input
              className="h-8 text-xs"
              value={String(cfg.task_title ?? "")}
              onChange={(e) => onChange({ ...cfg, task_title: e.target.value })}
              placeholder="e.g. Send quote to {{vars.name}}"
            />
            <VarChips vars={vars} onInsert={(v) => onChange({ ...cfg, task_title: String(cfg.task_title ?? "") + v })} />
          </Field>
          <Field label="Description (optional)">
            <Input
              className="h-8 text-xs"
              value={String(cfg.task_description ?? "")}
              onChange={(e) => onChange({ ...cfg, task_description: e.target.value })}
              placeholder="Additional context…"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Priority">
              <Select
                value={String(cfg.task_priority ?? "medium")}
                onValueChange={(v) => onChange({ ...cfg, task_priority: v })}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["low", "medium", "high", "urgent"].map((p) => (
                    <SelectItem key={p} value={p} className="text-xs capitalize">{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Due in (days)" hint="Days from now.">
              <input autoComplete="off"
                type="number"
                min={1}
                className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                value={(cfg.task_due_days as number | undefined) ?? 1}
                onChange={(e) => onChange({ ...cfg, task_due_days: Math.max(1, parseInt(e.target.value, 10) || 1) })}
              />
            </Field>
          </div>
          <MemberSelectField
            label="Assign to"
            value={String(cfg.task_assigned_to ?? "")}
            members={members}
            onValueChange={(v) => onChange({ ...cfg, task_assigned_to: v || undefined })}
          />
        </>
      )}

      <NodeSelect
        label="Next node"
        value={String(cfg.next_node_key ?? "")}
        allNodes={allNodes}
        currentKey={nodeKey}
        onChange={(v) => onChange({ ...cfg, next_node_key: v })}
      />
    </div>
  );
}

function EndForm({ cfg, onChange }: FormProps) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
      <div>
        <p className="text-xs font-medium">Close conversation</p>
        <p className="text-[10px] text-slate-500">
          Mark as resolved when flow ends
        </p>
      </div>
      <Switch
        checked={cfg.close_conversation === true}
        onCheckedChange={(v) => onChange({ ...cfg, close_conversation: v })}
      />
    </div>
  );
}

// ─── New node type forms ─────────────────────────────────────────

function LinkChatbotForm({ cfg, onChange }: FormProps) {
  const [chatbots, setChatbots] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    fetch("/api/chatbot")
      .then((r) => r.json())
      .then((j: { chatbots?: Array<{ id: string; name: string }> }) =>
        setChatbots(j.chatbots ?? []),
      )
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-4">
      <Field
        label="Target chatbot *"
        hint="When this node is reached, the current chatbot ends and the selected one starts."
      >
        <Select
          value={String(cfg.target_chatbot_id ?? "__none__")}
          onValueChange={(v) => {
            const found = chatbots.find((c) => c.id === v);
            onChange({
              ...cfg,
              target_chatbot_id: v === "__none__" ? "" : v,
              target_chatbot_name: found?.name ?? "",
            });
          }}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Select chatbot…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__" className="text-xs text-slate-500">
              — none —
            </SelectItem>
            {chatbots.map((c) => (
              <SelectItem key={c.id} value={c.id} className="text-xs">
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3">
        <p className="text-[10px] text-sky-600">
          The conversation context and collected variables are not transferred to the linked chatbot — it starts fresh.
        </p>
      </div>
    </div>
  );
}

interface MetaFlowOption {
  metaFlowId: string;
  name: string;
  /** Every named field across every screen of this flow — a field mapped
   *  in Field Mapping shows its DataStore field_key (more meaningful,
   *  stable); everything else shows its own component name (or
   *  componentName__tokenId for one token inside a multi-source Label).
   *  This mirrors exactly what upload/route.ts populates onto the
   *  terminal screen's 'complete' action payload — the ONLY thing that
   *  becomes nfm_reply.response_json, which is how the chatbot reads
   *  these back (see saveFieldLiveOrCarriedRef / flowFieldLiveOrCarriedRef). */
  variableTokens: string[];
}

function extractAllFlowVariables(screens: unknown): string[] {
  if (!Array.isArray(screens)) return [];
  const result = new Set<string>();
  for (const screen of screens) {
    const comps = (screen as Record<string, unknown> | null)?.components;
    if (!Array.isArray(comps)) continue;
    for (const comp of comps) {
      const c = comp as Record<string, unknown>;
      const name = typeof c.name === "string" ? c.name : undefined;
      if (c.type === "TextLabel" && name) {
        const sources = c._sources as Array<{ id: string; table_id?: string; field_key?: string; _save_field_key?: string }> | undefined;
        const validSources = Array.isArray(sources) ? sources.filter((s) => s.table_id && s.field_key) : [];
        if (validSources.length > 0) {
          for (const s of validSources) result.add(s._save_field_key || `${name}__${s.id}`);
        } else if (c._source_table_id && c._source_field_key) {
          result.add((c._save_field_key as string | undefined) || name);
        }
      } else if (c.type !== "TextLabel" && c.type !== "Footer" && c.type !== "Image" && name) {
        result.add((c._save_field_key as string | undefined) || name);
      }
    }
  }
  return Array.from(result);
}

/**
 * Holds the chatbot until the customer submits a WhatsApp Flow — put it
 * after a Send Template whose template has a Flow button, and the steps
 * after it (a delay, a thank-you, a lead) only run for someone who
 * actually filled the form in. Messages in the meantime go to the
 * assistant and the Inbox; the chatbot keeps waiting.
 */
function WaitFlowSubmitForm({ cfg, allNodes, nodeKey, onChange }: FormProps) {
  const [flows, setFlows] = useState<MetaFlowOption[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/flows?flow_type=whatsapp_flow&status=active")
      .then((r) => r.json())
      .then((j: { flows?: Array<{ id: string; name: string; trigger_config: Record<string, unknown> }> }) => {
        setFlows(
          (j.flows ?? [])
            .filter((f) => f.trigger_config?.meta_flow_id)
            .map((f) => ({
              metaFlowId: String(f.trigger_config.meta_flow_id),
              name: f.name,
              variableTokens: extractAllFlowVariables(f.trigger_config?.screens),
            })),
        );
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  // The chosen Flow's field names, kept on the node so later steps can
  // offer {{vars.flow_x}}.
  useEffect(() => {
    const found = flows.find((f) => f.metaFlowId === String(cfg.flow_id ?? ""));
    const next = found?.variableTokens ?? [];
    const current = Array.isArray(cfg.available_vars) ? (cfg.available_vars as string[]) : [];
    const same = current.length === next.length && current.every((v, i) => v === next[i]);
    if (loaded && !same) onChange({ ...cfg, available_vars: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flows, loaded, cfg.flow_id]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-[11px] leading-relaxed text-violet-800">
        Place this right after a <b>Send Template</b> whose template has a Flow button. The chatbot stops here
        and goes on to the next step <b>only after the customer submits the form</b>. Anything they type meanwhile
        is answered by the assistant or the team, and the chatbot keeps waiting.
      </div>

      <Field label="Which Flow" hint="Choose the Flow in the template, or Any Flow.">
        <Select
          value={String(cfg.flow_id || "__any__")}
          onValueChange={(v) => {
            const found = flows.find((f) => f.metaFlowId === v);
            onChange({ ...cfg, flow_id: v === "__any__" ? "" : v, flow_name: found?.name ?? "" });
          }}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Any Flow" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__any__" className="text-xs">Any Flow</SelectItem>
            {flows.map((f) => (
              <SelectItem key={f.metaFlowId} value={f.metaFlowId} className="text-xs">
                {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {loaded && flows.length === 0 && (
        <p className="text-[10px] text-amber-600">No published Flows found — Any Flow will still work.</p>
      )}

      <Field label="How long to wait">
        <div className="grid grid-cols-2 gap-2">
          {([
            ["until_submitted", "Until submitted", "No time limit"],
            ["time_limit", "Time limit", "Give up after some hours"],
          ] as const).map(([value, title, sub]) => {
            const current = cfg.wait_mode === "until_submitted" ? "until_submitted" : "time_limit";
            return (
              <button
                key={value}
                type="button"
                onClick={() => onChange({ ...cfg, wait_mode: value })}
                className={`rounded-md border px-2 py-1.5 text-left transition-colors ${
                  current === value
                    ? "border-indigo-500 bg-indigo-50"
                    : "border-slate-200 hover:border-indigo-300"
                }`}
              >
                <span className={`block text-[11px] font-semibold ${current === value ? "text-indigo-600" : "text-slate-700"}`}>{title}</span>
                <span className="block text-[10px] text-slate-500">{sub}</span>
              </button>
            );
          })}
        </div>
      </Field>

      {cfg.wait_mode === "until_submitted" ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[10px] leading-relaxed text-slate-600">
          The chatbot waits as long as it takes and continues the moment the form is submitted — the
          chatbot&apos;s No-reply timer does not end it. If the customer types a keyword that starts
          another chatbot meanwhile, that chatbot takes over.
        </p>
      ) : (
        <Field
          label="Wait up to (hours)"
          hint="If the form is not submitted in this time, the chatbot ends (and sends its no-reply message, if one is set). 1 to 168 hours."
        >
          <Input
            id={`wait-hours-${nodeKey}`}
            type="number"
            min={1}
            max={168}
            className="h-8 text-xs"
            value={String(cfg.wait_hours ?? 24)}
            onChange={(e) => {
              const n = Number(e.target.value)
              onChange({ ...cfg, wait_hours: Number.isFinite(n) ? Math.min(Math.max(Math.round(n), 1), 168) : 24 })
            }}
          />
        </Field>
      )}

      <NodeSelect
        label="After the form is submitted *"
        value={String(cfg.next_node_key ?? "")}
        allNodes={allNodes}
        currentKey={nodeKey}
        onChange={(v) => onChange({ ...cfg, next_node_key: v })}
        hint="Runs only once the Flow is submitted. The answers are ready as {{vars.flow_<field>}}."
      />
    </div>
  );
}

function SendFlowForm({ cfg, allNodes, nodeKey, onChange }: FormProps) {
  const [flows, setFlows] = useState<MetaFlowOption[]>([]);
  const [syncing, setSyncing] = useState(false);

  const loadFlows = () => {
    fetch("/api/flows?flow_type=whatsapp_flow&status=active")
      .then((r) => r.json())
      .then((j: { flows?: Array<{ id: string; name: string; trigger_config: Record<string, unknown> }> }) => {
        const opts: MetaFlowOption[] = (j.flows ?? [])
          .filter((f) => f.trigger_config?.meta_flow_id)
          .map((f) => ({
            metaFlowId: String(f.trigger_config.meta_flow_id),
            name: f.name,
            variableTokens: extractAllFlowVariables(f.trigger_config?.screens),
          }));
        setFlows(opts);
      })
      .catch(() => {});
  };

  useEffect(() => { loadFlows(); }, []);

  // Cache the selected flow's variable tokens onto this node's own config so
  // other nodes (getFlowVars) can offer {{vars.flow_x}} autocomplete without
  // re-fetching the flow. Also backfills older nodes configured before this
  // caching existed, once flows finish loading.
  useEffect(() => {
    if (!cfg.flow_id) return;
    const found = flows.find((f) => f.metaFlowId === String(cfg.flow_id));
    if (!found) return;
    const current = Array.isArray(cfg.available_vars) ? (cfg.available_vars as string[]) : [];
    const next = found.variableTokens;
    const same = current.length === next.length && current.every((v, i) => v === next[i]);
    if (!same) onChange({ ...cfg, available_vars: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flows, cfg.flow_id]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await fetch("/api/flows/sync", { method: "POST" });
      loadFlows();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-4">
      <Field
        label="WhatsApp Flow *"
        hint="Only published flows from your Meta WABA are listed."
      >
        <div className="space-y-1.5">
          <Select
            value={String(cfg.flow_id ?? "__none__")}
            onValueChange={(v) => {
              const found = flows.find((f) => f.metaFlowId === v);
              onChange({
                ...cfg,
                flow_id: v === "__none__" ? "" : v,
                flow_name: found?.name ?? "",
              });
            }}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select published flow…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__" className="text-xs text-slate-500">
                — none —
              </SelectItem>
              {flows.map((f) => (
                <SelectItem key={f.metaFlowId} value={f.metaFlowId} className="text-xs">
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {flows.length === 0 && (
            <p className="text-[10px] text-amber-500">
              No published flows found. Sync from Meta to load them.
            </p>
          )}
          <button
            type="button"
            className="flex h-6 items-center gap-1 rounded border border-slate-200 px-2 text-[10px] text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Sync from Meta
          </button>
        </div>
      </Field>
      <Field
        label="Request data on first screen"
        hint="Turn this on when the form's dropdowns or details are filled from a table. Off, WhatsApp opens the form from the message alone and never asks this server for anything — so those fields arrive empty on a real phone, while looking perfectly fine in Meta's preview."
      >
        <label className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 px-2.5 py-2 hover:bg-slate-50 transition-colors">
          <input
            type="checkbox"
            className="mt-0.5 h-3.5 w-3.5 accent-teal-600"
            checked={cfg.request_data === true}
            onChange={(e) => onChange({ ...cfg, request_data: e.target.checked })}
          />
          <span className="text-[11px] leading-relaxed text-slate-700">
            Ask the endpoint for the first screen&apos;s data
            <span className="block text-[10px] text-slate-500">
              The same choice Meta offers under &ldquo;Request data on first
              screen&rdquo; when you send a flow by hand.
            </span>
          </span>
        </label>
      </Field>
      <Field label="Button text *" hint="Text on the button the user taps to open the flow.">
        <Input
          className="h-8 text-xs"
          value={String(cfg.button_text ?? "")}
          onChange={(e) => onChange({ ...cfg, button_text: e.target.value })}
          placeholder="Open form"
        />
      </Field>
      <NodeSelect
        label="Next node"
        value={String(cfg.next_node_key ?? "")}
        allNodes={allNodes}
        currentKey={nodeKey}
        onChange={(v) => onChange({ ...cfg, next_node_key: v })}
        hint="Runs after the user submits the flow, with the customer's answers already loaded — see variables below."
      />
      {(() => {
        const selected = flows.find((f) => f.metaFlowId === String(cfg.flow_id ?? ""));
        if (!selected) return null;
        if (selected.variableTokens.length === 0) {
          return (
            <div className="rounded-md border border-amber-200 bg-amber-50/60 px-2.5 py-2 text-[10px] text-amber-800">
              This flow has no named input or Label fields yet, so nothing will be available here.
            </div>
          );
        }
        const tokenFor = (key: string) => `{{vars.flow_${key}}}`;
        const copy = (text: string, label: string) => {
          navigator.clipboard.writeText(text);
          toast.success(`Copied ${label}`);
        };
        return (
          <div className="rounded-md border border-teal-200 bg-teal-50/50 overflow-hidden">
            <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-teal-200">
              <Code2 className="h-3.5 w-3.5 text-teal-700" />
              <span className="text-[11px] font-semibold text-teal-800">Available after this flow completes</span>
            </div>
            <div className="px-2.5 py-2.5 space-y-2">
              <p className="text-[10px] text-slate-600">
                Every field across every screen — inputs and Label (dynamic) fields alike, whether or not it&apos;s also mapped in Field Mapping — once the customer submits this flow, use these in any later step (e.g. a &quot;Send Text&quot; node) to show back what they entered — click a token to copy it.
              </p>
              <div className="flex flex-wrap gap-1">
                {selected.variableTokens.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => copy(tokenFor(key), tokenFor(key))}
                    className="flex items-center gap-1 rounded-full border border-teal-300 bg-white px-2 py-0.5 font-mono text-[10px] text-teal-700 hover:bg-teal-100 transition-colors"
                    title="Click to copy"
                  >
                    <Copy className="h-2.5 w-2.5" />
                    {tokenFor(key)}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  const sample: Record<string, string> = {};
                  for (const key of selected.variableTokens) sample[`flow_${key}`] = "<value the customer entered>";
                  copy(JSON.stringify(sample, null, 2), "sample JSON");
                }}
                className="flex h-7 items-center gap-1 rounded border border-teal-300 bg-white px-2 text-[10px] text-teal-700 hover:bg-teal-100 transition-colors"
              >
                <Code2 className="h-3 w-3" /> Copy sample JSON
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

interface MetaTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  body_text: string;
}

const STATUS_BADGE: Record<string, string> = {
  APPROVED: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  PENDING:  "bg-amber-500/10 text-amber-700 border-amber-500/30",
  REJECTED: "bg-red-500/10 text-red-700 border-red-500/30",
  PAUSED:   "bg-orange-500/10 text-orange-700 border-orange-500/30",
};

function SendTemplateForm({ cfg, allNodes, nodeKey, onChange }: FormProps) {
  const vars = getFlowVars(allNodes, nodeKey);
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [loadingTpl, setLoadingTpl] = useState(true);

  useEffect(() => {
    fetch("/api/whatsapp/templates")
      .then((r) => r.json())
      .then((j: { templates?: MetaTemplate[] }) => setTemplates(j.templates ?? []))
      .catch(() => {})
      .finally(() => setLoadingTpl(false));
  }, []);

  // Unique key: "name|language" — same template name can exist in multiple languages
  const selectedKey =
    cfg.template_name && cfg.language_code
      ? `${String(cfg.template_name)}|${String(cfg.language_code)}`
      : "__none__";

  const selected = templates.find(
    (t) => t.name === String(cfg.template_name ?? "") && t.language === String(cfg.language_code ?? ""),
  );

  function handleSelect(key: string | null) {
    if (!key || key === "__none__") {
      onChange({ ...cfg, template_name: "", language_code: "" });
      return;
    }
    const [name, language] = key.split("|");
    onChange({ ...cfg, template_name: name, language_code: language });
  }

  return (
    <div className="space-y-4">
      <Field
        label="Template *"
        hint={
          templates.length === 0 && !loadingTpl
            ? "No templates found. Go to Templates → Sync from Meta first."
            : "Select an approved WhatsApp message template."
        }
      >
        {loadingTpl ? (
          <div className="flex h-8 items-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading templates…
          </div>
        ) : templates.length === 0 ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-1">
            <p className="text-[10px] font-semibold text-amber-700">No templates yet</p>
            <p className="text-[10px] text-amber-600 leading-relaxed">
              Go to <span className="font-semibold">Templates</span> in the sidebar and click{" "}
              <span className="font-semibold">Sync from Meta</span> to import your approved templates.
            </p>
          </div>
        ) : (
          <Select value={selectedKey} onValueChange={handleSelect}>
            <SelectTrigger className="h-auto min-h-[34px] py-1.5 text-xs">
              <SelectValue placeholder="Choose a template…" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="__none__" className="text-xs text-slate-500">
                — none —
              </SelectItem>
              {templates.map((t) => (
                <SelectItem
                  key={`${t.name}|${t.language}`}
                  value={`${t.name}|${t.language}`}
                  className="text-xs"
                >
                  <div className="flex items-center gap-2 py-0.5">
                    <span className="font-mono font-medium">{t.name}</span>
                    <span className="text-slate-500">({t.language})</span>
                    <span
                      className={cn(
                        "ml-auto rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                        STATUS_BADGE[t.status] ?? "bg-slate-100 text-slate-500 border-slate-200",
                      )}
                    >
                      {t.status}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>

      {/* Body preview */}
      {selected && selected.body_text && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Template body
          </p>
          <p className="text-[11px] leading-relaxed text-slate-900 whitespace-pre-wrap">
            {selected.body_text}
          </p>
          <p className="text-[10px] text-slate-500">
            Category: <span className="capitalize font-medium">{selected.category}</span>
          </p>
        </div>
      )}

      <Field
        label="Body parameters (optional)"
        hint="Comma-separated values to fill {{1}}, {{2}} etc. in the template body. {{vars.x}} tokens (including {{vars.flow_x}} from an earlier Send Flow node) are substituted with the real value before sending."
      >
        <RichTextArea
          value={String(cfg.body_params ?? "")}
          onChange={(v) => onChange({ ...cfg, body_params: v })}
          placeholder="John Doe, Order #12345"
          vars={vars}
          minHeight={60}
        />
      </Field>
      <NodeSelect
        label="Next node"
        value={String(cfg.next_node_key ?? "")}
        allNodes={allNodes}
        currentKey={nodeKey}
        onChange={(v) => onChange({ ...cfg, next_node_key: v })}
      />
    </div>
  );
}

interface CatalogFormProduct {
  id: string;
  retailer_id: string;
  name: string;
  price: number | null;
  currency: string | null;
}

const CATALOG_MODES: { value: string; label: string }[] = [
  { value: "catalog", label: "Whole catalog" },
  { value: "single_product", label: "One product" },
  { value: "multi_product", label: "Product picks (up to 30)" },
];

function SendCatalogForm({ cfg, allNodes, nodeKey, onChange }: FormProps) {
  const vars = getFlowVars(allNodes, nodeKey);
  const [products, setProducts] = useState<CatalogFormProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);

  useEffect(() => {
    fetch("/api/catalog/products")
      .then((r) => r.json())
      .then((j: { products?: CatalogFormProduct[] }) => setProducts(j.products ?? []))
      .catch(() => {})
      .finally(() => setLoadingProducts(false));
  }, []);

  const mode = String(cfg.mode ?? "catalog");
  const selectedIds: string[] = Array.isArray(cfg.product_retailer_ids) ? (cfg.product_retailer_ids as string[]) : [];

  function toggleMultiSelect(retailerId: string) {
    const next = selectedIds.includes(retailerId)
      ? selectedIds.filter((id) => id !== retailerId)
      : selectedIds.length < 30
        ? [...selectedIds, retailerId]
        : selectedIds;
    onChange({ ...cfg, product_retailer_ids: next });
  }

  return (
    <div className="space-y-4">
      <Field label="Send *" hint="What to send from your connected catalog.">
        <Select value={mode} onValueChange={(v) => onChange({ ...cfg, mode: v })}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATALOG_MODES.map((m) => (
              <SelectItem key={m.value} value={m.value} className="text-xs">
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {products.length === 0 && !loadingProducts && mode !== "catalog" && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-1">
          <p className="text-[10px] font-semibold text-amber-700">No products yet</p>
          <p className="text-[10px] text-amber-600 leading-relaxed">
            Go to <span className="font-semibold">Catalog</span> in the sidebar and add products first.
          </p>
        </div>
      )}

      {mode === "single_product" && products.length > 0 && (
        <Field label="Product *">
          <Select
            value={String(cfg.product_retailer_id ?? "__none__")}
            onValueChange={(v) => onChange({ ...cfg, product_retailer_id: v === "__none__" ? "" : v })}
          >
            <SelectTrigger className="h-auto min-h-[34px] py-1.5 text-xs">
              <SelectValue placeholder="Choose a product…" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="__none__" className="text-xs text-slate-500">— none —</SelectItem>
              {products.map((p) => (
                <SelectItem key={p.id} value={p.retailer_id} className="text-xs">
                  {p.name}{p.price != null ? ` — ${p.price} ${p.currency ?? ""}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      {mode === "multi_product" && products.length > 0 && (
        <Field label={`Products * (${selectedIds.length}/30 selected)`}>
          <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
            {products.map((p) => {
              const checked = selectedIds.includes(p.retailer_id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggleMultiSelect(p.retailer_id)}
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors",
                    checked ? "bg-sky-50 text-sky-800" : "hover:bg-slate-50 text-slate-700",
                  )}
                >
                  <span className="truncate">{p.name}</span>
                  <span className={cn("ml-2 h-3.5 w-3.5 shrink-0 rounded-sm border", checked ? "border-sky-500 bg-sky-500" : "border-slate-300")} />
                </button>
              );
            })}
          </div>
        </Field>
      )}

      {mode === "multi_product" && (
        <Field label="Header *" hint="Required by WhatsApp for a product-picks message.">
          <Input
            value={String(cfg.header_text ?? "")}
            onChange={(e) => onChange({ ...cfg, header_text: e.target.value })}
            maxLength={60}
            className="h-8 text-xs"
          />
        </Field>
      )}

      <Field label={mode === "single_product" ? "Message (optional)" : "Message *"}>
        <RichTextArea
          value={String(cfg.body_text ?? "")}
          onChange={(v) => onChange({ ...cfg, body_text: v })}
          placeholder="Have a look at what we've got!"
          vars={vars}
          minHeight={60}
        />
      </Field>

      <Field label="Footer (optional)">
        <Input
          value={String(cfg.footer_text ?? "")}
          onChange={(e) => onChange({ ...cfg, footer_text: e.target.value })}
          maxLength={60}
          className="h-8 text-xs"
        />
      </Field>

      <NodeSelect
        label="Next node"
        value={String(cfg.next_node_key ?? "")}
        allNodes={allNodes}
        currentKey={nodeKey}
        onChange={(v) => onChange({ ...cfg, next_node_key: v })}
      />
    </div>
  );
}

function JoinForm({ cfg, allNodes, nodeKey, onChange }: FormProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3 space-y-1">
        <p className="text-[10px] font-semibold text-indigo-700">Merge node</p>
        <p className="text-[10px] text-indigo-600 leading-relaxed">
          Connect multiple nodes to this node&apos;s input handle. Every branch that
          reaches here will continue to the single next node below.
        </p>
      </div>
      <Field label="Label (optional)" hint="Describe what branches are merging here.">
        <Input
          className="h-8 text-xs"
          value={String(cfg.label ?? "")}
          onChange={(e) => onChange({ ...cfg, label: e.target.value })}
          placeholder="e.g. After user answers question"
        />
      </Field>
      <NodeSelect
        label="Next node"
        value={String(cfg.next_node_key ?? "")}
        allNodes={allNodes}
        currentKey={nodeKey}
        onChange={(v) => onChange({ ...cfg, next_node_key: v })}
        hint="All incoming branches continue here."
      />
    </div>
  );
}

// ─── Switch / Case form ──────────────────────────────────────────

function SwitchCaseForm({ cfg, allNodes, nodeKey, onChange }: FormProps) {
  const collectInputVars = allNodes
    .filter((n) => n.node_key !== nodeKey && n.node_type === "collect_input")
    .map((n) => (typeof n.config.var_key === "string" ? n.config.var_key : ""))
    .filter(Boolean);

  const cases = Array.isArray(cfg.cases)
    ? (cfg.cases as Array<Record<string, unknown>>)
    : [];

  const updateCase = (i: number, key: string, val: string) => {
    const updated = cases.map((c, idx) => (idx === i ? { ...c, [key]: val } : c));
    onChange({ ...cfg, cases: updated });
  };

  const addCase = () => {
    const next = cases.length + 1;
    onChange({
      ...cfg,
      cases: [...cases, { value: String(next), label: `Option ${next}`, next_node_key: "" }],
    });
  };

  const removeCase = (i: number) => {
    onChange({ ...cfg, cases: cases.filter((_, idx) => idx !== i) });
  };

  return (
    <div className="space-y-4">
      <Field
        label="Variable to switch on"
        hint="The collected variable whose value is matched against each case."
      >
        <Select
          value={String(cfg.variable ?? "")}
          onValueChange={(v) => onChange({ ...cfg, variable: v })}
          disabled={collectInputVars.length === 0}
        >
          <SelectTrigger className="h-8 text-xs font-mono">
            <SelectValue
              placeholder={
                collectInputVars.length === 0
                  ? "No Collect Input nodes yet…"
                  : "Pick a variable…"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {collectInputVars.map((key) => (
              <SelectItem key={key} value={key} className="font-mono text-xs">
                {`{{vars.${key}}}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input autoComplete="off"
          type="checkbox"
          className="h-3.5 w-3.5 rounded border-slate-200 accent-indigo-600"
          checked={cfg.case_sensitive === true}
          onChange={(e) => onChange({ ...cfg, case_sensitive: e.target.checked })}
        />
        <span className="text-xs text-slate-500">Case sensitive matching</span>
        <span className="text-[10px] text-slate-400">
          {cfg.case_sensitive === true ? '("Yes" ≠ "yes")' : '("Yes" = "yes")'}
        </span>
      </label>

      <div className="space-y-2">
        <p className="text-xs font-medium text-slate-700">
          Cases ({cases.length}) — each becomes an output handle on the canvas
        </p>
        {cases.map((c, i) => (
          <div
            key={i}
            className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2 last:mb-0"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Case {i + 1}
              </span>
              {cases.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeCase(i)}
                  className="text-slate-500 hover:text-rose-500"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Match value *">
                <Input
                  className="h-7 text-xs font-mono"
                  value={String(c.value ?? "")}
                  onChange={(e) => updateCase(i, "value", e.target.value)}
                  placeholder="e.g. 1"
                />
              </Field>
              <Field label="Label (on handle)">
                <Input
                  className="h-7 text-xs"
                  value={String(c.label ?? "")}
                  onChange={(e) => updateCase(i, "label", e.target.value)}
                  placeholder="e.g. About us"
                />
              </Field>
            </div>
            <NodeSelect
              label="Go to node"
              value={String(c.next_node_key ?? "")}
              allNodes={allNodes}
              currentKey={nodeKey}
              onChange={(v) => updateCase(i, "next_node_key", v)}
            />
          </div>
        ))}
        <button
          type="button"
          className="flex h-7 w-full items-center justify-center gap-1 rounded-md border border-slate-200 text-xs text-slate-600 hover:bg-slate-50 transition-colors"
          onClick={addCase}
        >
          <Plus className="h-3.5 w-3.5" /> Add case
        </button>
      </div>

      <NodeSelect
        label="Default branch (no match)"
        value={String(cfg.default_next ?? "")}
        allNodes={allNodes}
        currentKey={nodeKey}
        onChange={(v) => onChange({ ...cfg, default_next: v })}
        hint="Taken when the variable doesn't match any case above."
      />
    </div>
  );
}

// ─── Send to Number form ──────────────────────────────────────────

function SendToNumberForm({ cfg, allNodes, nodeKey, onChange }: FormProps) {
  const vars = getFlowVars(allNodes, nodeKey)
  return (
    <div className="space-y-4">
      <Field
        label="Destination phone number"
        hint="E.164 format (+919876543210) or use {{vars.x}} to insert a collected number."
      >
        <Input
          value={typeof cfg.phone === 'string' ? cfg.phone : ''}
          onChange={(e) => onChange({ ...cfg, phone: e.target.value })}
          placeholder="+919876543210 or {{vars.admin_phone}}"
          className="h-8 text-xs font-mono"
        />
        <VarChips vars={vars} onInsert={(t) => onChange({ ...cfg, phone: `${cfg.phone ?? ''}${t}` })} />
      </Field>

      <Field
        label="Message text"
        hint="Supports {{name}}, {{phone}}, {{contact.name}}, {{contact.phone}}, and {{vars.x}}."
      >
        <Textarea
          value={typeof cfg.text === 'string' ? cfg.text : ''}
          onChange={(e) => onChange({ ...cfg, text: e.target.value })}
          placeholder="New inquiry from {{contact.name}} ({{contact.phone}})"
          rows={3}
          className="text-xs resize-none"
        />
        <VarChips vars={vars} onInsert={(t) => onChange({ ...cfg, text: `${cfg.text ?? ''}${t}` })} />
      </Field>

      <NodeSelect
        label="Next node"
        value={typeof cfg.next_node_key === 'string' ? cfg.next_node_key : ''}
        allNodes={allNodes}
        currentKey={nodeKey}
        onChange={(v) => onChange({ ...cfg, next_node_key: v })}
        hint="Flow continues here after the notification is sent."
      />
    </div>
  )
}

// ─── Dispatcher ──────────────────────────────────────────────────

interface FormProps {
  node: ChatbotBuilderNode;
  nodeKey: string;
  cfg: Record<string, unknown>;
  allNodes: ChatbotBuilderNode[];
  onChange: (cfg: Record<string, unknown>) => void;
}

interface NodeFormProps {
  node: ChatbotBuilderNode;
  allNodes: ChatbotBuilderNode[];
  onChange: (cfg: Record<string, unknown>) => void;
}

export function NodeForm({ node, allNodes, onChange }: NodeFormProps) {
  const props: FormProps = {
    node,
    nodeKey: node.node_key,
    cfg: node.config,
    allNodes,
    onChange,
  };

  const formMap: Record<ChatbotNodeType, React.FC<FormProps>> = {
    start:          StartForm,
    send_text:      SendTextForm,
    send_buttons:   SendButtonsForm,
    send_list:      SendListForm,
    send_media:     SendMediaForm,
    collect_input:  CollectInputForm,
    condition:      ConditionForm,
    ai_reply:       AiReplyForm,
    http_request:   HttpRequestForm,
    delay:          DelayForm,
    set_variable:   SetVariableForm,
    set_tag:        SetTagForm,
    update_contact: UpdateContactForm,
    crm_action:     CrmActionForm,
    handoff:        HandoffForm,
    end:            EndForm,
    link_chatbot:   LinkChatbotForm,
    send_flow:      SendFlowForm,
    wait_flow_submit: WaitFlowSubmitForm,
    send_template:  SendTemplateForm,
    join:           JoinForm,
    switch_case:    SwitchCaseForm,
    send_to_number: SendToNumberForm,
    send_catalog:   SendCatalogForm,
  };

  const Form = formMap[node.node_type];
  if (!Form)
    return (
      <p className="text-xs text-slate-400 italic">No form for this node type.</p>
    );

  return (
    <div className="space-y-4">
      {/* A name for this step, shown on its card and in every "next
          node" list — so a chatbot with six Send Buttons steps can be
          read without opening each one. */}
      <Field label="Step name" hint="Optional. Shown on the card instead of the step type.">
        <Input
          id={`node-name-${node.node_key}`}
          className="h-8 text-xs"
          maxLength={NODE_NAME_MAX}
          value={String(node.config.node_name ?? "")}
          onChange={(e) => onChange({ ...node.config, node_name: e.target.value })}
          placeholder={NODE_META[node.node_type]?.label ?? "e.g. Ask course"}
        />
      </Field>
      <Form {...props} />
    </div>
  );
}
