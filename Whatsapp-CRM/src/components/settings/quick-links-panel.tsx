'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Compass, Loader2, Plus, X, ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  NAV_SECTIONS,
  MAX_QUICK_LINKS,
  DEFAULT_QUICK_LINKS,
  navItemFor,
  sanitizeQuickLinks,
} from '@/lib/navigation/sections';

/**
 * Choosing the shortcuts that appear on the dashboard.
 *
 * Personal rather than account-wide, for the same reason the
 * chat-translation setting beside it is: what somebody reaches for all
 * day is a fact about them, not about the business.
 *
 * ── Why a dropdown rather than a wall of chips ──────────────────────
 *
 * The first version laid all nineteen destinations out as toggle chips.
 * It was honest about what exists and it made a settings panel that was
 * mostly a map of the sidebar — four hundred pixels of options to choose
 * at most six things from, with the six you had chosen lost among them.
 * Adding is now one dropdown of what is left, and the panel is the list
 * you actually have.
 *
 * Saves on each change rather than behind a button. There is no
 * half-finished state to protect, and a Save button on a panel this
 * small is mostly a way to lose the change you just made.
 */

const ADD_PLACEHOLDER = '__add__';

export function QuickLinksPanel() {
  const [chosen, setChosen] = useState<string[]>([]);
  const [on, setOn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/me');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const saved = sanitizeQuickLinks(data.profile?.quick_links);
        if (cancelled) return;
        // An empty list means "has not chosen", and the dashboard shows
        // the default — so this shows the same thing, rather than an
        // empty panel contradicting what is on screen elsewhere.
        setChosen(saved.length > 0 ? saved : DEFAULT_QUICK_LINKS);
        setTouched(saved.length > 0);
        setOn(data.profile?.quick_links_enabled !== false);
      } catch {
        /* usable without a saved value */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(patch: Record<string, unknown>) {
    setSaving(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.error ?? `Could not save (${res.status})`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save your quick links.');
    } finally {
      setSaving(false);
    }
  }

  function persistLinks(next: string[]) {
    setChosen(next);
    setTouched(true);
    void save({ quick_links: next });
  }

  function move(href: string, delta: number) {
    const from = chosen.indexOf(href);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= chosen.length) return;
    const next = [...chosen];
    next.splice(to, 0, ...next.splice(from, 1));
    persistLinks(next);
  }

  const remaining = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((i) => !chosen.includes(i.href)),
  })).filter((section) => section.items.length > 0);

  const full = chosen.length >= MAX_QUICK_LINKS;

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white">
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#EEF0FF] text-[#5B6CF9]">
            <Compass className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[15px] font-semibold text-slate-900">Quick links</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-500">
              The round button on your dashboard opens these — up to {MAX_QUICK_LINKS} places, yours
              alone.
              {!touched && ' Until you choose, it shows a sensible default.'}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
          <Switch
            checked={on}
            onCheckedChange={(v) => {
              setOn(v);
              void save({ quick_links_enabled: v });
            }}
            aria-label="Show the quick links button on the dashboard"
          />
        </div>
      </div>

      {!on ? (
        <p className="px-6 py-5 text-[12.5px] text-slate-500">
          The button is hidden. Your list is kept — turn this back on to use it again.
        </p>
      ) : (
        <div className="space-y-3 px-6 py-5">
          {loading ? (
            <div className="h-9 animate-pulse rounded-lg bg-slate-100" />
          ) : (
            <>
              {chosen.map((href, i) => {
                const item = navItemFor(href);
                if (!item) return null;
                return (
                  <div
                    key={href}
                    className={cn(
                      // h-10, not a padded card: six of these should read
                      // as one list, not six panels.
                      'flex h-10 items-center gap-2.5 rounded-xl bg-slate-50/70 px-3',
                      'ring-1 ring-slate-200/60',
                    )}
                  >
                    <span className="w-4 shrink-0 text-center text-[11px] tabular-nums text-slate-400">
                      {i + 1}
                    </span>
                    <item.icon className="h-4 w-4 shrink-0 text-[#5B6CF9]" strokeWidth={1.9} />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-slate-700">
                      {item.label}
                    </span>
                    {/* Arrows rather than drag: six rows, and a drag
                        handle that small is harder to hit than a button —
                        on a phone, considerably. */}
                    <button
                      type="button"
                      onClick={() => move(href, -1)}
                      disabled={i === 0}
                      aria-label={`Move ${item.label} up`}
                      className="rounded-md p-1 text-slate-400 transition-colors hover:bg-white hover:text-slate-600 disabled:opacity-25 disabled:hover:bg-transparent"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(href, 1)}
                      disabled={i === chosen.length - 1}
                      aria-label={`Move ${item.label} down`}
                      className="rounded-md p-1 text-slate-400 transition-colors hover:bg-white hover:text-slate-600 disabled:opacity-25 disabled:hover:bg-transparent"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => persistLinks(chosen.filter((h) => h !== href))}
                      aria-label={`Remove ${item.label}`}
                      className="rounded-md p-1 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-500"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}

              {full ? (
                <p className="pt-0.5 text-[11.5px] text-slate-400">
                  That is all {MAX_QUICK_LINKS}. Remove one to add another.
                </p>
              ) : (
                <Select
                  value={ADD_PLACEHOLDER}
                  onValueChange={(v) => {
                    if (!v || v === ADD_PLACEHOLDER) return;
                    persistLinks([...chosen, v]);
                  }}
                >
                  <SelectTrigger className="h-10 w-full rounded-xl border-dashed border-slate-300 bg-white text-[13px] text-slate-500">
                    <span className="flex items-center gap-2">
                      <Plus className="h-3.5 w-3.5" />
                      <SelectValue placeholder="Add a link" />
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ADD_PLACEHOLDER}>Add a link</SelectItem>
                    {remaining.map((section) =>
                      section.items.map((item) => (
                        <SelectItem key={item.href} value={item.href}>
                          {section.label} · {item.label}
                        </SelectItem>
                      )),
                    )}
                  </SelectContent>
                </Select>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
