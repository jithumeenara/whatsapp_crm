'use client';

/**
 * Setting one person's week.
 *
 * ── Why a dialog and not a settings page ────────────────────────────
 *
 * A rota is edited from the roster, because that is where somebody is
 * already looking at the person whose hours are wrong. A separate page
 * would mean finding the same list again somewhere else.
 *
 * ── Why the time zone is filled in and still shown ──────────────────
 *
 * It starts from the business's own zone (Settings > Business profile),
 * falling back to this browser's, so the ordinary case is a field
 * nobody has to touch. It is on screen anyway, and editable, because
 * nothing else here would give away a zone that is wrong — every shift
 * would simply be offset, silently, for as long as nobody noticed — and
 * because an agent working from another city is a real arrangement.
 *
 * ── Why three buttons instead of a dropdown ─────────────────────────
 *
 * Full, half, off. Three options read down a column of seven days at a
 * glance, and the shape of the week is the thing the person is actually
 * checking. A dropdown would hide six of those seven answers behind a
 * click each.
 */

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Clock, Loader2, Copy } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { detectTimezone } from '@/lib/agents/timezones';
import { TimezonePicker } from './timezone-picker';
import {
  DAY_KEYS,
  DAY_NAMES,
  DEFAULT_WEEK,
  HALF_DAY_DEFAULT,
  summariseWeek,
  type DayKey,
  type DayMode,
  type DayShift,
  type WorkingHours,
} from '@/lib/agents/working-hours';

const MODES: Array<{ value: DayMode; label: string }> = [
  { value: 'full', label: 'Full' },
  { value: 'half', label: 'Half' },
  { value: 'off', label: 'Off' },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: { user_id: string; full_name: string; working_hours?: WorkingHours | null };
  /** The business's own clock, from Settings > Business profile. Null
   *  when nobody has set one, in which case this browser's zone is the
   *  next best guess. */
  accountTimezone?: string | null;
  /** Called after a successful save so the roster can pick up the change. */
  onSaved: () => void;
}

export function WorkingHoursDialog({
  open,
  onOpenChange,
  member,
  accountTimezone,
  onSaved,
}: Props) {
  const [week, setWeek] = useState<Record<DayKey, DayShift>>(DEFAULT_WEEK);
  const [timezone, setTimezone] = useState('UTC');
  const [saving, setSaving] = useState(false);

  // Reset every time it opens, not once on mount: the same dialog
  // component serves whichever row was clicked, and keeping the last
  // person's hours on screen is how somebody overwrites the wrong rota.
  useEffect(() => {
    if (!open) return;
    setWeek(member.working_hours?.week ?? DEFAULT_WEEK);
    // Their own zone if they have hours already; otherwise the
    // business's, which is the right answer for almost everybody and is
    // a decision somebody has actually made. This browser's zone is the
    // last resort — it describes where the person setting up the rota is
    // sitting, which is not necessarily where anyone works.
    setTimezone(
      member.working_hours?.timezone ?? accountTimezone ?? detectTimezone(),
    );
  }, [open, member.working_hours, accountTimezone]);

  const preview = useMemo(() => summariseWeek({ timezone, week }), [timezone, week]);

  function setMode(day: DayKey, mode: DayMode) {
    setWeek((prev) => {
      const current = prev[day];
      // Switching to half offers half-day hours rather than keeping the
      // full day's, because somebody choosing "half" has already said
      // what they mean and should not have to say it twice. Their own
      // times survive if they then edit them.
      if (mode === 'half' && current.mode !== 'half') {
        return { ...prev, [day]: { mode, ...HALF_DAY_DEFAULT } };
      }
      return { ...prev, [day]: { ...current, mode } };
    });
  }

  function setTime(day: DayKey, field: 'from' | 'to', value: string) {
    setWeek((prev) => ({ ...prev, [day]: { ...prev[day], [field]: value } }));
  }

  /** Most weeks are one shift repeated. Typing it seven times is the
   *  kind of work software is supposed to remove. */
  function copyMondayToWorkingDays() {
    setWeek((prev) => {
      const source = prev.mon;
      const next = { ...prev };
      for (const day of DAY_KEYS) {
        if (day === 'mon') continue;
        // Days already marked off stay off — copying hours onto
        // somebody's day off would be the opposite of helpful.
        if (next[day].mode === 'off') continue;
        next[day] = { ...next[day], from: source.from, to: source.to };
      }
      return next;
    });
  }

  async function save(hours: WorkingHours | null) {
    setSaving(true);
    try {
      const res = await fetch(`/api/account/members/${member.user_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ working_hours: hours }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        // The server's message names the day that is wrong, so it is
        // shown as it came rather than replaced with something vaguer.
        toast.error(payload.error || 'Could not save these working hours');
        return;
      }
      toast.success(hours ? 'Working hours saved' : 'Working hours cleared');
      onSaved();
      onOpenChange(false);
    } catch {
      toast.error('Could not reach the server');
    } finally {
      setSaving(false);
    }
  }

  const hasExisting = Boolean(member.working_hours);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-50 text-indigo-600">
              <Clock className="h-3.5 w-3.5" />
            </span>
            Working hours
          </DialogTitle>
          <DialogDescription className="text-[12.5px]">
            {member.full_name || 'This member'} is only given new conversations inside these
            hours. Leave them unset and they are available at any time.
          </DialogDescription>
        </DialogHeader>

        {/* Filled in rather than asked, but changeable.

            It starts from the business's own zone, which is right for
            almost everybody, so the ordinary case is a field nobody has
            to touch. It is still a picker because an agent working from
            another city is a real arrangement, and because a zone that
            can only be read is a zone nobody can fix when it is wrong. */}
        <div className="space-y-1">
          <p className="text-[11.5px] font-medium text-slate-600">These times are in</p>
          <TimezonePicker value={timezone} onChange={setTimezone} disabled={saving} />
        </div>

        <div className="space-y-1.5">
          {DAY_KEYS.map((day) => {
            const shift = week[day];
            const off = shift.mode === 'off';
            return (
              <div
                key={day}
                className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[5rem_auto_minmax(0,1fr)] sm:gap-3"
              >
                <span className="text-[12.5px] font-medium text-slate-700">
                  <span className="sm:hidden">{DAY_NAMES[day].slice(0, 3)}</span>
                  <span className="hidden sm:inline">{DAY_NAMES[day]}</span>
                </span>

                <div className="col-span-1 flex overflow-hidden rounded-lg border border-slate-200">
                  {MODES.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => setMode(day, m.value)}
                      aria-pressed={shift.mode === m.value}
                      className={`px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                        shift.mode === m.value
                          ? 'bg-[#5B6CF9] text-white'
                          : 'bg-white text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                {/* The inputs stay in place on a day off rather than
                    disappearing, so the row does not jump and the hours
                    are still there when the day comes back. */}
                <div
                  className={`col-span-2 flex items-center gap-1.5 sm:col-span-1 ${
                    off ? 'pointer-events-none opacity-40' : ''
                  }`}
                >
                  <input
                    type="time"
                    value={shift.from}
                    disabled={off}
                    onChange={(e) => setTime(day, 'from', e.target.value)}
                    aria-label={`${DAY_NAMES[day]} start time`}
                    className="w-full rounded-lg border border-slate-200 px-2 py-1 text-[12px] text-slate-700 tabular-nums focus:border-[#5B6CF9] focus:outline-none"
                  />
                  <span className="text-[11px] text-slate-400">to</span>
                  <input
                    type="time"
                    value={shift.to}
                    disabled={off}
                    onChange={(e) => setTime(day, 'to', e.target.value)}
                    aria-label={`${DAY_NAMES[day]} end time`}
                    className="w-full rounded-lg border border-slate-200 px-2 py-1 text-[12px] text-slate-700 tabular-nums focus:border-[#5B6CF9] focus:outline-none"
                  />
                </div>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={copyMondayToWorkingDays}
          className="inline-flex items-center gap-1.5 self-start text-[11.5px] font-medium text-indigo-600 hover:text-indigo-700"
        >
          <Copy className="h-3 w-3" />
          Use Monday&rsquo;s times on every working day
        </button>

        {/* The whole week in one sentence, updating as they type. It is
            the sentence that will appear on the roster, so this is a
            preview of the answer rather than a restatement of the form. */}
        <div className="rounded-lg bg-slate-900/[0.03] px-3 py-2 text-[11.5px] text-slate-600">
          {preview}
        </div>

        <p className="text-[11px] leading-relaxed text-slate-500">
          A night shift is fine — set the end time earlier than the start, for example 10:00 PM
          to 6:00 AM, and it carries over into the next morning.
        </p>

        <div className="flex items-center justify-between gap-2 pt-1">
          {hasExisting ? (
            <button
              type="button"
              onClick={() => save(null)}
              disabled={saving}
              className="text-[12px] font-medium text-slate-500 underline underline-offset-2 hover:text-rose-600"
            >
              Clear hours
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => save({ timezone, week })} disabled={saving}>
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
