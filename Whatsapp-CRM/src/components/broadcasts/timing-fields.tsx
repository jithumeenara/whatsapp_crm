'use client';

/**
 * Two small inputs shared by automatic follow-ups and event-based
 * broadcasts: "wait this long" and "only send between these hours".
 * Times are the business's own (its time zone in Company profile).
 */

export type WaitUnit = 'minutes' | 'hours' | 'days';

export function WaitField({ id, label, value, unit, onChange, disabled }: {
  id: string;
  label: string;
  value: number;
  unit: WaitUnit;
  onChange: (v: { value: number; unit: WaitUnit }) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[11.5px] font-medium text-slate-600">{label}</label>
      <div className="flex gap-1.5">
        <input id={id} name={id} type="number" inputMode="numeric" min={0} max={unit === 'days' ? 30 : unit === 'hours' ? 720 : 43200}
          value={value} disabled={disabled} autoComplete="off"
          onChange={(e) => onChange({ value: Math.max(0, Number(e.target.value) || 0), unit })}
          className="h-9 w-20 rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
        <select value={unit} disabled={disabled} aria-label={`${label} unit`}
          onChange={(e) => onChange({ value, unit: e.target.value as WaitUnit })}
          className="h-9 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-[13px] text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100">
          <option value="minutes">Minutes</option>
          <option value="hours">Hours</option>
          <option value="days">Days</option>
        </select>
      </div>
    </div>
  );
}

export function SendWindowField({ id, value, onChange, disabled }: {
  id: string;
  /** 'HH:MM-HH:MM' or null for any time. */
  value: string | null;
  onChange: (v: string | null) => void;
  disabled?: boolean;
}) {
  const [from, to] = (value ?? '09:00-21:00').split('-');
  return (
    <div className="space-y-2">
      <label className="flex cursor-pointer items-start gap-2.5">
        <input type="checkbox" checked={value !== null} disabled={disabled}
          onChange={(e) => onChange(e.target.checked ? '09:00-21:00' : null)}
          className="mt-0.5 h-4 w-4 accent-indigo-600" />
        <span className="text-[12.5px] text-slate-700">
          Only send during these hours
          <span className="block text-[11.5px] text-slate-500">Anything due outside them waits until they start — no messages at night.</span>
        </span>
      </label>
      {value !== null && (
        <div className="flex flex-wrap items-center gap-2 pl-6">
          <label htmlFor={`${id}-from`} className="sr-only">From</label>
          <input id={`${id}-from`} name={`${id}-from`} type="time" value={from} disabled={disabled} autoComplete="off"
            onChange={(e) => e.target.value && onChange(`${e.target.value}-${to}`)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
          <span className="text-[12.5px] text-slate-500">to</span>
          <label htmlFor={`${id}-to`} className="sr-only">To</label>
          <input id={`${id}-to`} name={`${id}-to`} type="time" value={to} disabled={disabled} autoComplete="off"
            onChange={(e) => e.target.value && onChange(`${from}-${e.target.value}`)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
        </div>
      )}
    </div>
  );
}
