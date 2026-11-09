import type { GraphEdge, Release } from './types';
import { FLOW_OF, payerOf, usdBn, type Flow } from './flow';

/**
 * Records whose amount is already inside another record, taken from the records' own notes. A contained record is
 * listed but left out of totals whenever its container is counted too.
 */
export const OVERLAPS: Record<string, { within: string; why: string }> = {
  R073: { within: 'R201', why: 'CoreWeave book debt (R201) already includes part of the DDTL facilities' },
  R140: { within: 'R201', why: 'CoreWeave book debt (R201) already includes part of the DDTL facilities' },
  R143: { within: 'R201', why: 'CoreWeave book debt (R201) already includes part of the DDTL facilities' },
  R146: { within: 'R201', why: 'CoreWeave book debt (R201) already includes part of the DDTL facilities' },
  R026: { within: 'R196', why: 'AMD and NVIDIA contributions are part of the $37.5bn Meta bond (R196)' },
  R027: { within: 'R196', why: 'AMD and NVIDIA contributions are part of the $37.5bn Meta bond (R196)' },
  R025: { within: 'R024', why: 'the same $42bn note facility appears as purchase (R024) and as funding (R025)' },
};

export type Dir = 'in' | 'out';
/** What "in" and "out" mean for each line family, from the company's side. */
export const DIR_LABEL: Record<Exclude<Flow, 'other'>, Record<Dir, string>> = {
  money: { in: 'Raised — debt and equity it took in', out: 'Invested or lent to others' },
  goods: { in: 'Sold — customers’ contracts with it', out: 'Bought — what it pays suppliers' },
  guar: { in: 'Backing it receives', out: 'Backing it gives (contingent exposure)' },
};
export const FLOWS: Exclude<Flow, 'other'>[] = ['money', 'goods', 'guar'];

/** Statuses that describe something not (yet) firm: options, caps, announcements, unconfirmed attributions. */
const SOFT = /conditional|announced|minimum|unconfirmed|up_to|planned|arrang|draw_unknown|not_settled|backstop|right|pending|attribution|unknown_amount/;
export const isConditional = (status: string) => SOFT.test(status);

export interface ExpRow { e: GraphEdge; dir: Dir; conditional: boolean; usd: number | null; other: string; via: string | null; within: string | null }
export interface ExpSide { rows: ExpRow[]; firm: number; conditional: number; uncounted: number }
export interface Exposure { company: string; projects: string[]; sides: Record<Exclude<Flow, 'other'>, Record<Dir, ExpSide>> }

/**
 * Every money, compute and guarantee record of a company and of its projects (linked by an affiliation record),
 * split by line family and direction, with firm and conditional US$ subtotals. A record already inside another
 * counted record is listed but not added; undisclosed and non-dollar amounts are listed and counted as uncounted.
 */
export function exposure(r: Release, company: string, edges: GraphEdge[] = r.graph.edges): Exposure {
  const kind = new Map(r.graph.nodes.map((n) => [n.id, n.kind]));
  const projects = [...new Set(r.graph.edges.filter((e) => e.layer === 'affiliation' && (e.from === company || e.to === company))
    .map((e) => (e.from === company ? e.to : e.from)).filter((id) => kind.get(id) === 'project'))];
  const rows: ExpRow[] = [];
  for (const e of edges) {
    if (e.layer === 'affiliation') continue;
    const self = e.from === company || e.to === company ? company : projects.find((p) => e.from === p || e.to === p) ?? null;
    if (!self) continue;
    if (self !== company && (e.from === company || e.to === company)) continue; // project ↔ parent: already a direct record
    const flow = FLOW_OF[e.layer] as Exclude<Flow, 'other'>;
    const dir: Dir = flow === 'goods' ? (payerOf(e) === self ? 'out' : 'in') : e.to === self ? 'in' : 'out';
    rows.push({ e, dir, conditional: isConditional(e.status), usd: usdBn(e), other: e.from === self ? e.to : e.from, via: self === company ? null : self, within: null });
  }
  const ids = new Set(rows.map((x) => x.e.id));
  for (const x of rows) { const o = OVERLAPS[x.e.id]; if (o && ids.has(o.within)) x.within = o.within; }
  const empty = (): ExpSide => ({ rows: [], firm: 0, conditional: 0, uncounted: 0 });
  const sides = Object.fromEntries(FLOWS.map((f) => [f, { in: empty(), out: empty() }])) as Exposure['sides'];
  for (const x of rows) {
    const s = sides[FLOW_OF[x.e.layer] as Exclude<Flow, 'other'>][x.dir];
    s.rows.push(x);
    if (x.within) continue;
    if (x.usd === null) s.uncounted++;
    else if (x.conditional) s.conditional += x.usd; else s.firm += x.usd;
  }
  const order = (a: ExpRow, b: ExpRow) => Number(!!a.via) - Number(!!b.via) || (a.via ?? '').localeCompare(b.via ?? '') || (b.usd ?? -1) - (a.usd ?? -1) || a.e.id.localeCompare(b.e.id);
  for (const f of FLOWS) for (const d of ['in', 'out'] as Dir[]) sides[f][d].rows.sort(order);
  return { company, projects, sides };
}
