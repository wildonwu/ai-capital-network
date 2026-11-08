/** Pure helpers for the CDS chart (kept apart from the component so they can be tested). */
export const CDS_TENORS = ['1Y', '2Y', '3Y', '4Y', '5Y'] as const;
export type Range = 'YTD' | '6M' | '1Y' | '2Y' | 'All';

/** Session-index window [start, end] for a range button, ending at the latest session. */
export function windowFor(r: Range, dates: string[]): [number, number] {
  const last = dates.length - 1;
  if (last < 0) return [0, 0];
  const end = dates[last];
  let from: string;
  if (r === 'All') return [0, last];
  if (r === 'YTD') from = `${end.slice(0, 4)}-01-01`;
  else {
    const d = new Date(`${end}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - (r === '6M' ? 6 : r === '1Y' ? 12 : 24));
    from = d.toISOString().slice(0, 10);
  }
  const i = dates.findIndex((x) => x >= from);
  return [i < 0 ? 0 : i, last];
}

/** Monday of the ISO week containing `d`. */
const weekStart = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`); const w = (t.getUTCDay() + 6) % 7;
  return new Date(t.getTime() - w * 86400000).toISOString().slice(0, 10);
};

/** Weekly sampling: each week's last session. With `starts`, return the week starts instead. */
export function weekly(dates: string[], starts = false): string[] {
  const m = new Map<string, string>();
  for (const d of dates) m.set(weekStart(d), d);
  return starts ? [...m.keys()] : [...m.values()];
}
