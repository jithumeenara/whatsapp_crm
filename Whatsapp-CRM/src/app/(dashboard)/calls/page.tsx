"use client";

/**
 * Call history.
 *
 * Built around the question a call list is actually opened to answer —
 * "what did I miss?" — so missed sits in the tab bar with a count on it
 * rather than being something you filter your way to.
 *
 * A missed call shows how long the caller waited before giving up, which
 * is the number that says whether the ring timeout is set sensibly, and
 * an answered one shows talk time. They are deliberately different
 * measurements and are never shown in the same column.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Bot,
  User as UserIcon,
  Search,
  Loader2,
  MessageSquare,
  ArrowRightLeft,
  Phone,
} from "lucide-react";

type CallRow = {
  id: string;
  channel: string;
  direction: string;
  status: string;
  from_number: string | null;
  to_number: string | null;
  handled_by: string | null;
  transferred_at: string | null;
  transfer_reason: string | null;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  end_reason: string | null;
  conversation_id: string | null;
  contact: { id: string; name: string | null; phone: string | null } | null;
  agent: { id: string; profile: { full_name: string } | null } | null;
};

type Payload = {
  calls: CallRow[];
  total: number;
  status_counts: Record<string, number>;
  talk_time: { total_seconds: number; average_seconds: number; answered_calls: number };
};

const TABS = [
  { key: "all", label: "All" },
  { key: "missed", label: "Missed" },
  { key: "received", label: "Received" },
  { key: "made", label: "Made" },
  { key: "ai", label: "Answered by AI" },
  { key: "agent", label: "Answered by a person" },
] as const;

function cn(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

/** m:ss, or h:mm:ss once a call runs past the hour. */
function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds < 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return time;
  return `${d.toLocaleDateString([], { day: "numeric", month: "short" })}, ${time}`;
}

/** How long they waited before giving up. Only meaningful unanswered. */
function waitedFor(call: CallRow): string | null {
  if (call.answered_at || !call.ended_at) return null;
  const waited = Math.round(
    (new Date(call.ended_at).getTime() - new Date(call.started_at).getTime()) / 1000,
  );
  return waited > 0 ? formatDuration(waited) : null;
}

export default function CallsPage() {
  const [filter, setFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ filter, limit: "50" });
      if (query.trim()) params.set("q", query.trim());
      const res = await fetch(`/api/calls?${params}`);
      if (!res.ok) return;
      setData(await res.json());
    } catch {
      /* the page renders empty rather than breaking */
    } finally {
      setLoading(false);
    }
  }, [filter, query]);

  useEffect(() => {
    // Debounced so typing in the search box does not fire a request per
    // keystroke; the tab change goes through the same path.
    const t = setTimeout(load, 220);
    return () => clearTimeout(t);
  }, [load]);

  const missedCount =
    (data?.status_counts.missed ?? 0) + (data?.status_counts.rejected ?? 0);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-slate-900">Calls</h1>
          <p className="mt-0.5 text-[13px] text-slate-500">
            Calls to and from your WhatsApp number, and who answered them.
          </p>
        </div>

        {data && data.talk_time.answered_calls > 0 && (
          <div className="flex gap-5 rounded-xl border border-slate-200 bg-white px-4 py-2.5">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Answered
              </p>
              <p className="mt-0.5 text-[16px] font-semibold tabular-nums text-slate-900">
                {data.talk_time.answered_calls}
              </p>
            </div>
            <div className="border-l border-slate-100 pl-5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Average
              </p>
              <p className="mt-0.5 text-[16px] font-semibold tabular-nums text-slate-900">
                {formatDuration(data.talk_time.average_seconds)}
              </p>
            </div>
            <div className="border-l border-slate-100 pl-5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Total talk time
              </p>
              <p className="mt-0.5 text-[16px] font-semibold tabular-nums text-slate-900">
                {formatDuration(data.talk_time.total_seconds)}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100/80 p-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setFilter(tab.key)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                filter === tab.key
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900",
              )}
            >
              {tab.label}
              {tab.key === "missed" && missedCount > 0 && (
                <span className="rounded-full bg-rose-100 px-1.5 text-[10.5px] font-bold text-rose-700">
                  {missedCount}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="relative ml-auto min-w-[180px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or number"
            className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-[13px] outline-none focus:border-primary/50"
          />
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {loading && !data ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading calls…
          </div>
        ) : !data || data.calls.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 text-slate-400">
              <Phone className="h-5 w-5" />
            </span>
            <p className="mt-3 text-[14px] font-medium text-slate-800">
              {query || filter !== "all" ? "Nothing matches that" : "No calls yet"}
            </p>
            <p className="mx-auto mt-1 max-w-sm text-[12.5px] leading-relaxed text-slate-500">
              {query || filter !== "all"
                ? "Try a different tab, or clear the search."
                : "Calls to your WhatsApp number will appear here once calling is switched on for it."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.calls.map((call) => {
              const missed = call.status === "missed" || call.status === "rejected";
              const outbound = call.direction === "outbound";
              const Icon = missed ? PhoneMissed : outbound ? PhoneOutgoing : PhoneIncoming;
              const who =
                call.contact?.name ||
                call.contact?.phone ||
                (outbound ? call.to_number : call.from_number) ||
                "Unknown number";
              const waited = waitedFor(call);

              return (
                <li key={call.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50/70">
                  <span
                    className={cn(
                      "grid h-9 w-9 shrink-0 place-items-center rounded-xl",
                      missed
                        ? "bg-rose-50 text-rose-600"
                        : outbound
                          ? "bg-sky-50 text-sky-600"
                          : "bg-emerald-50 text-emerald-600",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <p className="truncate text-[13.5px] font-medium text-slate-900">{who}</p>
                      {call.handled_by === "ai" && !call.transferred_at && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                          <Bot className="h-2.5 w-2.5" />
                          AI
                        </span>
                      )}
                      {call.transferred_at && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
                          title={call.transfer_reason ?? undefined}
                        >
                          <ArrowRightLeft className="h-2.5 w-2.5" />
                          Transferred
                        </span>
                      )}
                      {call.agent?.profile?.full_name && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                          <UserIcon className="h-2.5 w-2.5" />
                          {call.agent.profile.full_name}
                        </span>
                      )}
                      {call.channel === "sip" && (
                        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                          SIP
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-[11.5px] text-slate-500">
                      {formatWhen(call.started_at)}
                      {/* Two different measurements, never in one column:
                          how long they talked, or how long they waited. */}
                      {missed
                        ? waited
                          ? ` · rang for ${waited}`
                          : " · missed"
                        : call.duration_seconds !== null
                          ? ` · ${formatDuration(call.duration_seconds)}`
                          : call.status === "in_progress"
                            ? " · in progress"
                            : ""}
                      {call.end_reason ? ` · ${call.end_reason}` : ""}
                    </p>
                  </div>

                  {call.conversation_id && (
                    <Link
                      href={`/inbox?conversation=${call.conversation_id}`}
                      title="Open the conversation"
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                    >
                      <MessageSquare className="h-4 w-4" />
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {data && data.total > data.calls.length && (
        <p className="mt-3 text-center text-[12px] text-slate-500">
          Showing {data.calls.length} of {data.total}
        </p>
      )}
    </div>
  );
}
