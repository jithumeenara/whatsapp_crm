'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Compass, Check, Loader2, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
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
 * Lives on the Profile screen rather than in an account-wide setting
 * because the answer is genuinely personal: an agent spends the day in
 * Inbox and Leads, an owner in Reports and Broadcasts, and one shared
 * list would be wrong for both.
 *
 * Saves on each change rather than behind a button. There is no
 * half-finished state to protect — a list of up to six links is either
 * what you want or one click from it — and a Save button on a panel
 * this small is mostly a way to lose the change you just made.
 */
export function QuickLinksPanel() {
  const [chosen, setChosen] = useState<string[]>([]);
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
        // the default — so the screen shows the same thing, rather than
        // an empty panel that contradicts what is on screen elsewhere.
        setChosen(saved.length > 0 ? saved : DEFAULT_QUICK_LINKS);
        setTouched(saved.length > 0);
      } catch {
        /* the panel is usable without a saved value */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function persist(next: string[]) {
    setChosen(next);
    setTouched(true);
    setSaving(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quick_links: next }),
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

  function toggle(href: string) {
    if (chosen.includes(href)) {
      void persist(chosen.filter((h) => h !== href));
      return;
    }
    if (chosen.length >= MAX_QUICK_LINKS) {
      toast.error(`Pick up to ${MAX_QUICK_LINKS}. Remove one first.`);
      return;
    }
    void persist([...chosen, href]);
  }

  function move(href: string, delta: number) {
    const from = chosen.indexOf(href);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= chosen.length) return;
    const next = [...chosen];
    next.splice(to, 0, ...next.splice(from, 1));
    void persist(next);
  }

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white">
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#EEF0FF] text-[#5B6CF9]">
            <Compass className="h-4.5 w-4.5" />
          </span>
          <div>
            <p className="text-[15px] font-semibold text-slate-900">Quick links</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-500">
              The round button on your dashboard opens these. Pick the {MAX_QUICK_LINKS} places you
              actually go — they are yours, not the whole team&apos;s.
              {!touched && ' Until you choose, it shows a sensible default.'}
            </p>
          </div>
        </div>
        {saving && <Loader2 className="mt-1 h-4 w-4 shrink-0 animate-spin text-slate-400" />}
      </div>

      {/* The chosen ones, in the order they will appear. */}
      {!loading && chosen.length > 0 && (
        <div className="border-b border-slate-100 px-6 py-4">
          <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-slate-400">
            In this order
          </p>
          <div className="space-y-1.5">
            {chosen.map((href, i) => {
              const item = navItemFor(href);
              if (!item) return null;
              return (
                <div
                  key={href}
                  className="flex items-center gap-2.5 rounded-xl bg-slate-50/80 px-3 py-2 ring-1 ring-slate-200/60"
                >
                  <GripVertical className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                  <item.icon className="h-4 w-4 shrink-0 text-[#5B6CF9]" strokeWidth={1.9} />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-slate-700">
                    {item.label}
                  </span>
                  {/* Buttons rather than drag: this list is at most six
                      rows, and a drag target that small is harder to hit
                      than two arrows — on a phone, considerably. */}
                  <button
                    type="button"
                    onClick={() => move(href, -1)}
                    disabled={i === 0}
                    aria-label={`Move ${item.label} up`}
                    className="rounded-md px-1.5 py-0.5 text-[13px] text-slate-400 transition-colors hover:bg-white hover:text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(href, 1)}
                    disabled={i === chosen.length - 1}
                    aria-label={`Move ${item.label} down`}
                    className="rounded-md px-1.5 py-0.5 text-[13px] text-slate-400 transition-colors hover:bg-white hover:text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    ↓
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="px-6 py-5">
        <p className="mb-3 text-[11.5px] font-semibold uppercase tracking-wide text-slate-400">
          Everywhere you can go
        </p>
        <div className="space-y-4">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label}>
              <p className="mb-2 text-[11.5px] text-slate-400">{section.label}</p>
              <div className="flex flex-wrap gap-2">
                {section.items.map((item) => {
                  const on = chosen.includes(item.href);
                  const full = !on && chosen.length >= MAX_QUICK_LINKS;
                  return (
                    <button
                      key={item.href}
                      type="button"
                      onClick={() => toggle(item.href)}
                      disabled={loading}
                      className={cn(
                        'flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12.5px] ring-1 transition-all',
                        on
                          ? 'bg-[#EEF0FF] text-[#5B6CF9] ring-[#5B6CF9]/25'
                          : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50',
                        full && 'opacity-45',
                      )}
                    >
                      <item.icon className="h-3.5 w-3.5" strokeWidth={1.9} />
                      {item.label}
                      {on && <Check className="h-3 w-3" strokeWidth={2.6} />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
