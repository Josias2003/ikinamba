export interface DateRangeValue {
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD
}

function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

const today = () => new Date().toISOString().slice(0, 10);

export const PRESETS: { label: string; days: number }[] = [
  { label: "This week", days: 7 },
  { label: "This month", days: 30 },
  { label: "This quarter", days: 90 },
];

export function defaultDateRange(days = 30): DateRangeValue {
  return { since: isoDaysAgo(days), until: today() };
}

/** Week/month/quarter presets + a real custom range -- every report in the app shares
 * this instead of each page inventing its own ad hoc days-only control. */
export function DateRangePicker({ value, onChange }: { value: DateRangeValue; onChange: (range: DateRangeValue) => void }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {PRESETS.map((p) => (
        <button
          key={p.label}
          type="button"
          className="btn-secondary text-xs"
          onClick={() => onChange({ since: isoDaysAgo(p.days), until: today() })}
        >
          {p.label}
        </button>
      ))}
      <span className="h-5 w-px bg-ink-800" />
      <input className="input w-auto text-xs py-1" type="date" value={value.since} onChange={(e) => onChange({ ...value, since: e.target.value })} />
      <span className="text-ink-500 text-xs">to</span>
      <input className="input w-auto text-xs py-1" type="date" value={value.until} onChange={(e) => onChange({ ...value, until: e.target.value })} />
    </div>
  );
}
