import coreweave from '../../data/delivery/coreweave.json';
import oracle from '../../data/delivery/oracle.json';

/** Hand-curated data-centre delivery timelines, kept outside the hashed release like the market snapshot. */
export const DELIVERY_SCHEMA = 'acn-delivery-1';

/** public = announced; inferred = from backtested lead times; check = a date by which something should be confirmed. */
export type DateKind = 'public' | 'inferred' | 'check';
export type SiteRisk = 'done' | 'watch' | 'risk' | 'cancelled';

export interface Milestone { start: string; end?: string; when: string; kind: DateKind; site?: string; item: string; watch: string; reference: string; slip: string }
export interface SiteEvent { date: string; end?: string; when: string; kind: DateKind; event: string; slip?: string; key?: boolean }
export interface Site {
  id: string; name: string; state: string; landlord: string; capacity: string; delivered: string;
  next: string; next_when: string; risk: SiteRisk; status: string; note: string; events: SiteEvent[];
}
export interface Delivery {
  schema: string; node_id: string; as_of: string; source_note: string; rules: string[];
  company: Milestone[]; recurring: string[]; sites: Site[]; gap: string;
}

const ALL = [coreweave as Delivery, oracle as Delivery];
const KINDS: DateKind[] = ['public', 'inferred', 'check'];

/** Problems with a delivery file; empty when it is usable. */
export function validateDelivery(d: Delivery): string[] {
  const bad: string[] = [];
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (d.schema !== DELIVERY_SCHEMA) bad.push(`schema ${d.schema}`);
  if (!iso.test(d.as_of)) bad.push(`as_of ${d.as_of}`);
  d.company.forEach((m, i) => {
    if (!KINDS.includes(m.kind)) bad.push(`company[${i}] kind ${m.kind}`);
    if (!iso.test(m.start) || (m.end && !iso.test(m.end))) bad.push(`company[${i}] date`);
    else if (m.end && m.end < m.start) bad.push(`company[${i}] end before start`);
  });
  const ids = new Set<string>();
  d.sites.forEach((s) => {
    if (ids.has(s.id)) bad.push(`duplicate site ${s.id}`);
    ids.add(s.id);
    s.events.forEach((e, i) => {
      if (!KINDS.includes(e.kind)) bad.push(`${s.id}.events[${i}] kind ${e.kind}`);
      if (!iso.test(e.date) || (e.end && !iso.test(e.end))) bad.push(`${s.id}.events[${i}] date`);
      else if (e.end && e.end < e.date) bad.push(`${s.id}.events[${i}] end before start`);
    });
  });
  return bad;
}

/** Delivery timelines for a network node, or null when none are curated (or the file is invalid). */
export function deliveryFor(nodeId: string): Delivery | null {
  const d = ALL.find((x) => x.node_id === nodeId);
  return d && validateDelivery(d).length === 0 ? d : null;
}

const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** Calendar axis from the first day of `from`'s quarter to the last day of `to`'s quarter. */
export function quarterDomain(from: string, to: string): [string, string] {
  const q0 = (iso: string) => { const [y, m] = iso.split('-').map(Number); return [y, Math.floor((m - 1) / 3) * 3 + 1] as const; };
  const [y1, m1] = q0(from), [y2, m2] = q0(to);
  const end = new Date(Date.UTC(y2, m2 - 1 + 3, 0));
  return [`${y1}-${String(m1).padStart(2, '0')}-01`, end.toISOString().slice(0, 10)];
}

/** Linear date → x mapping. */
export function timeScale([d0, d1]: [string, string], x0: number, x1: number) {
  const a = ms(d0), b = ms(d1);
  return (iso: string) => x0 + ((Math.min(Math.max(ms(iso), a), b) - a) / (b - a)) * (x1 - x0);
}

/** Quarter-start ticks inside a domain, labelled "Q2"; Q1 ticks show the year, and the first tick is labelled like "Q3 \'24" so it does not collide with the next one. */
export function quarterTicks([d0, d1]: [string, string]) {
  const out: { date: string; label: string; year: boolean }[] = [];
  let [y, m] = d0.split('-').map(Number);
  while (`${y}-${String(m).padStart(2, '0')}-01` <= d1) {
    const date = `${y}-${String(m).padStart(2, '0')}-01`;
    const q = `Q${(m - 1) / 3 + 1}`;
    out.push({ date, label: m === 1 ? String(y) : out.length === 0 ? `${q} '${String(y).slice(2)}` : q, year: m === 1 });
    m += 3; if (m > 12) { m -= 12; y += 1; }
  }
  return out;
}

/** Earliest and latest dates across company milestones or site events. */
export function span(dates: string[]): [string, string] {
  const s = [...dates].sort();
  return [s[0], s[s.length - 1]];
}

/** The site's headline pending event: the first key event on or after the cut-off, else its last key event. */
export function keyEvent(s: Site, asOf: string): SiteEvent | undefined {
  const keys = s.events.filter((e) => e.key);
  return keys.find((e) => (e.end ?? e.date) >= asOf) ?? keys.at(-1);
}

/** The date kinds a delivery file actually uses, so the legend shows only those. */
export function kindsUsed(d: Delivery): Set<DateKind> {
  return new Set([...d.company.map((m) => m.kind), ...d.sites.flatMap((s) => s.events.map((e) => e.kind))]);
}
