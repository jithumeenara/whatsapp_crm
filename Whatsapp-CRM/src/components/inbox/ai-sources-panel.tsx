"use client";

/**
 * "Where did this reply come from?" — under a bot message in the Inbox.
 *
 * Shows what the AI was given to answer from (knowledge entries with the
 * passages retrieved, the company profile, the instructions, look-ups),
 * which of them the reply's lines were actually found in, and — first,
 * because it is what to check — any line found in none of them.
 */

import { useEffect, useState } from "react";
import {
  AlertTriangle, BookOpen, Building2, ChevronDown, Database, ExternalLink, FileText, Globe, Loader2,
  MessageSquareQuote, MessagesSquare, ScrollText, Search, Sheet, ShieldCheck, Workflow, X,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Source {
  id: string | null;
  name: string;
  kind: string;
  table_id: string | null;
  url: string | null;
  passages: string[];
  used_lines: number;
  given?: number;
  total?: number;
}

interface Meta {
  v: number;
  origin: "chatbot" | "auto_reply";
  retrieval: "semantic" | "keyword" | "none";
  match: number;
  sources: Source[];
  tools: string[];
  checked_lines: number;
  unsupported: string[];
  corrected?: string[];
}

const KIND: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  qa: { label: "Q&A", icon: MessageSquareQuote },
  document: { label: "Document", icon: FileText },
  text: { label: "Text", icon: FileText },
  website: { label: "Website", icon: Globe },
  database: { label: "Data Store table", icon: Database },
  sheet: { label: "Google Sheet", icon: Sheet },
  chatbot: { label: "Chatbot", icon: Workflow },
  company_profile: { label: "Settings → Profile → Company profile", icon: Building2 },
  instructions: { label: "AI Config → instructions", icon: ScrollText },
  lookup: { label: "Customer's records", icon: Search },
  conversation: { label: "From the chat", icon: MessagesSquare },
};

function whereToOpen(s: Source): { href: string; external: boolean } | null {
  if (s.table_id) return { href: `/data/${s.table_id}`, external: false };
  if (s.url && /^https?:\/\//i.test(s.url)) return { href: s.url, external: true };
  if (s.id) return { href: "/settings?tab=ai", external: false };
  if (s.kind === "company_profile") return { href: "/settings?tab=profile", external: false };
  if (s.kind === "instructions") return { href: "/settings?tab=ai", external: false };
  return null;
}

/** The small "Sources" toggle in a bot message's label row. */
export function AiSourcesToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        "flex items-center gap-0.5 rounded px-1 text-[10px] font-medium transition-colors",
        open ? "bg-teal-50 text-teal-700" : "text-slate-400 hover:text-teal-700",
      )}
      title="Where did this reply come from?"
    >
      <BookOpen className="h-3 w-3" />
      Sources
    </button>
  );
}

/** The explanation, shown under the message. Loads when first opened. */
export function AiSourcesCard({ messageId, onClose }: { messageId: string; onClose: () => void }) {
  const [state, setState] = useState<{ loading: boolean; failed: boolean; data: { meta: Meta | null; bot_source: string | null } | null }>({
    loading: true,
    failed: false,
    data: null,
  });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/messages/${messageId}/ai-sources`)
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!cancelled) setState({ loading: false, failed: false, data });
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, failed: true, data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [messageId]);

  return (
    <SourcesCard
      loading={state.loading}
      failed={state.failed}
      meta={state.data?.meta ?? null}
      loaded={!!state.data}
      botSource={state.data?.bot_source ?? null}
      onClose={onClose}
    />
  );
}

function SourcesCard({
  loading, failed, meta, loaded, botSource, onClose,
}: {
  loading: boolean;
  failed: boolean;
  meta: Meta | null;
  loaded: boolean;
  botSource: string | null;
  onClose: () => void;
}) {
  return (
    <div className="mt-1.5 w-full min-w-[260px] max-w-[440px] rounded-xl border border-slate-200 bg-white p-3 text-left text-[12px] text-slate-700 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <BookOpen className="h-3.5 w-3.5 text-teal-600" />
        <p className="flex-1 text-[12.5px] font-semibold text-slate-800">Where this reply came from</p>
        <button type="button" onClick={onClose} aria-label="Close" className="grid h-5 w-5 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></div>
      ) : failed ? (
        <p className="text-slate-500">Could not load this. Try again in a moment.</p>
      ) : loaded && !meta ? (
        <p className="leading-relaxed text-slate-500">
          {botSource === "ai_auto_reply"
            ? "This AI reply was sent before sources were recorded, so there is nothing to show for it. Replies from now on carry their sources."
            : "Not written by the AI — this is a fixed message from a step in one of your chatbots, word for word as the step has it."}
        </p>
      ) : meta ? (
        <MetaView meta={meta} />
      ) : null}
    </div>
  );
}

function MetaView({ meta }: { meta: Meta }) {
  const knowledge = meta.sources.filter((s) => !["company_profile", "instructions", "lookup", "conversation"].includes(s.kind));
  const other = meta.sources.filter((s) => ["company_profile", "instructions", "lookup", "conversation"].includes(s.kind));
  const retrieval =
    meta.retrieval === "semantic" ? "found by meaning" : meta.retrieval === "keyword" ? "found by keywords" : "no knowledge matched";

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
          {meta.origin === "chatbot" ? "Chatbot AI step" : "AI auto-reply"}
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">Knowledge {retrieval}</span>
        {meta.retrieval !== "none" && (
          <span className={cn("rounded-full px-2 py-0.5", meta.match >= 0.6 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800")}>
            best match {Math.round(meta.match * 100)}%
          </span>
        )}
      </div>

      {meta.unsupported.length > 0 && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900 ring-1 ring-amber-200">
          <p className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="h-3.5 w-3.5" /> Not found in anything it was given
          </p>
          <p className="mt-0.5 text-[11.5px] text-amber-800">The AI may have added these from its own general knowledge — check them.</p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
            {meta.unsupported.map((l, i) => <li key={i} className="break-words">{l}</li>)}
          </ul>
        </div>
      )}

      {meta.corrected && meta.corrected.length > 0 && (
        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-900 ring-1 ring-emerald-200">
          <p className="flex items-center gap-1.5 font-semibold">
            <ShieldCheck className="h-3.5 w-3.5" /> Caught before sending
          </p>
          <p className="mt-0.5 text-[11.5px] text-emerald-800">
            The first draft listed these, which are in none of the sources. They were kept out of the reply.
          </p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
            {meta.corrected.map((l, i) => <li key={i} className="break-words line-through decoration-emerald-400">{l}</li>)}
          </ul>
        </div>
      )}

      {knowledge.length > 0 ? (
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">Knowledge it was given</p>
          <ul className="flex flex-col gap-1.5">{knowledge.map((s, i) => <SourceRow key={`${s.id ?? s.name}-${i}`} source={s} />)}</ul>
        </div>
      ) : (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-slate-500">
          No knowledge entry matched this question, so the AI answered from the context below (or its own knowledge).
        </p>
      )}

      {other.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">Also used</p>
          <ul className="flex flex-col gap-1.5">{other.map((s, i) => <SourceRow key={`${s.kind}-${i}`} source={s} />)}</ul>
        </div>
      )}

      {meta.tools.length > 0 && (
        <p className="text-[11.5px] text-slate-500">
          Looked up: {meta.tools.map((t) => t.replace(/_/g, " ")).join(", ")}
        </p>
      )}

      <p className="text-[11px] text-slate-400">
        {meta.checked_lines > 0
          ? `${meta.checked_lines} line${meta.checked_lines === 1 ? "" : "s"} of the reply were checked against these. Lines written wholly in Malayalam are not checked word for word.`
          : "The reply had no lines that could be checked word for word."}
      </p>
    </div>
  );
}

function SourceRow({ source }: { source: Source }) {
  const [open, setOpen] = useState(false);
  const kind = KIND[source.kind] ?? KIND.document;
  const Icon = kind.icon;
  const target = whereToOpen(source);
  return (
    <li className="rounded-lg ring-1 ring-slate-200">
      <div className="flex items-start gap-2 px-2.5 py-2">
        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
        <div className="min-w-0 flex-1">
          <p className="break-words font-medium text-slate-800">{source.name}</p>
          <p className="text-[11px] text-slate-400">{kind.label}</p>
          {source.given !== undefined && source.total !== undefined && (
            <p className={cn("text-[11px]", source.given >= source.total ? "text-slate-500" : "text-amber-700")}>
              {source.given >= source.total
                ? `Given whole — all ${source.total} part${source.total === 1 ? "" : "s"}`
                : `Given in part — ${source.given} of ${source.total} parts matched the question`}
            </p>
          )}
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-1.5 py-0.5 text-[10.5px] font-medium",
            source.used_lines > 0 ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500",
          )}
        >
          {source.used_lines > 0 ? `used · ${source.used_lines} line${source.used_lines === 1 ? "" : "s"}` : "given, not used"}
        </span>
      </div>
      <div className="flex items-center gap-3 border-t border-slate-100 px-2.5 py-1.5 text-[11px]">
        {source.passages.length > 0 && (
          <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-0.5 text-slate-500 hover:text-slate-800">
            <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
            {open ? "Hide" : "Show"} what it read
          </button>
        )}
        {target && (
          <a
            href={target.href}
            {...(target.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="ml-auto flex items-center gap-0.5 font-medium text-teal-700 hover:underline"
          >
            Open <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      {open && (
        <div className="flex flex-col gap-1.5 border-t border-slate-100 bg-slate-50/60 px-2.5 py-2">
          {source.passages.map((p, i) => (
            <p key={i} className="whitespace-pre-wrap break-words rounded bg-white px-2 py-1.5 text-[11.5px] leading-relaxed text-slate-600 ring-1 ring-slate-100">{p}</p>
          ))}
        </div>
      )}
    </li>
  );
}
