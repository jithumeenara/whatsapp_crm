'use client';

/**
 * Choosing one of four hundred time zones.
 *
 * ── Why this is not a dropdown ──────────────────────────────────────
 *
 * A plain select with four hundred options is a scroll, not a choice.
 * Nobody knows whether their zone is filed under Asia, Indian or a
 * country name, and the ones who do still have to scroll past three
 * hundred they do not want. So: type a city, see the matches.
 *
 * ── Why every row shows the current time ────────────────────────────
 *
 * "Asia/Kolkata" and "Asia/Colombo" are half an hour apart and look
 * identical to somebody who does not already know the answer. The clock
 * is how a person checks they picked the right one without leaving the
 * screen, and a time zone that is wrong by half an hour is exactly the
 * kind of mistake nobody finds for months.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Globe, Search } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  searchTimezones,
  offsetLabel,
  currentTimeIn,
  describeZone,
  detectTimezone,
  hasFullTimezoneList,
} from '@/lib/agents/timezones';
import { useNow } from '@/hooks/use-now';

interface Props {
  value: string | null;
  onChange: (timezone: string) => void;
  disabled?: boolean;
}

export function TimezonePicker({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // A minute, because that is how often the displayed clock can change.
  // See src/hooks/use-now.ts for why it starts undefined.
  const now = useNow(60_000);

  const detected = useMemo(() => detectTimezone(), []);
  const results = useMemo(() => searchTimezones(query), [query]);

  // Focus only. Emptying the box belongs in the open handler below: it
  // happens because somebody opened the picker, which is an event, not
  // because React and the DOM had drifted apart. Doing it here would be
  // a second render every time this mounts, for nothing.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => searchRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // A picker that reopened still showing the last search would hide
    // the zone somebody had just chosen behind a filter they had
    // forgotten typing.
    if (next) setQuery('');
  }

  function choose(timezone: string) {
    onChange(timezone);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        disabled={disabled}
        className="flex h-10 w-full items-center gap-2 rounded-xl border border-slate-200 px-3 text-left text-[13px] text-slate-700 transition-colors hover:border-slate-300 disabled:opacity-50"
      >
        <Globe className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        {value ? (
          <>
            <span className="truncate font-medium">{describeZone(value).city}</span>
            <span className="ml-auto shrink-0 text-[11.5px] tabular-nums text-slate-400">
              {offsetLabel(value, now)}
              {currentTimeIn(value, now) ? ` · ${currentTimeIn(value, now)}` : ''}
            </span>
          </>
        ) : (
          <span className="text-slate-400">Choose a time zone</span>
        )}
      </PopoverTrigger>

      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] gap-0 p-0">
        <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a city or country"
            aria-label="Search time zones"
            className="w-full bg-transparent text-[13px] text-slate-700 placeholder:text-slate-400 focus:outline-none"
          />
        </div>

        <div className="max-h-72 overflow-y-auto py-1">
          {results.length === 0 && (
            <p className="px-3 py-6 text-center text-[12px] text-slate-400">
              Nothing matches &ldquo;{query}&rdquo;. Try the nearest large city.
            </p>
          )}

          {results.map((zone) => {
            const { city, region } = describeZone(zone);
            const selected = zone === value;
            return (
              <button
                key={zone}
                type="button"
                onClick={() => choose(zone)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-slate-50 ${
                  selected ? 'bg-indigo-50/60' : ''
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-slate-700">
                    {city}
                    {zone === detected && (
                      <span className="ml-1.5 text-[10px] font-normal uppercase tracking-wide text-indigo-500">
                        this computer
                      </span>
                    )}
                  </span>
                  {region && (
                    <span className="block truncate text-[11px] text-slate-400">{region}</span>
                  )}
                </span>
                <span className="shrink-0 text-right text-[11px] tabular-nums text-slate-400">
                  <span className="block">{offsetLabel(zone, now)}</span>
                  <span className="block">{currentTimeIn(zone, now)}</span>
                </span>
                {selected && <Check className="h-3.5 w-3.5 shrink-0 text-indigo-600" />}
              </button>
            );
          })}
        </div>

        {/* Said plainly rather than left as a mystery: on a browser that
            cannot list the world, somebody searching for their own city
            and finding nothing deserves to know why. */}
        {!hasFullTimezoneList() && (
          <p className="border-t border-slate-100 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
            This browser cannot list every time zone, so only the common ones are shown. Opening
            this page in an up-to-date browser gives the full list.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
