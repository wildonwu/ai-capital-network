import type { GraphEdge, Layer, Release } from './types';
import type { VisibleGraph } from './selection';
import { categoryOf, type CategoryId } from './categories';
import { TICKERS, tickerize } from './tickers';

/** Three line families on the page: money, compute and guarantees (plus project affiliation, drawn faint). */
export type Flow = 'money' | 'goods' | 'guar' | 'other';
export const FLOW_OF: Record<Layer, Flow> = {
  capital: 'money', financing: 'money', commercial: 'goods', delivery: 'goods', support: 'guar', warrant: 'guar', affiliation: 'other',
};
export const FLOW_COLOR: Record<Flow, string> = { money: '#B5532F', goods: '#2F6B8F', guar: '#7A5CA8', other: '#A39A90' };
export const FLOW_NAME: Record<Flow, string> = {
  money: 'Money — equity, loans, bonds', goods: 'Compute — purchase and delivery', guar: 'Guarantees & options', other: 'Project affiliation',
};
export const CAT_COLOR: Record<CategoryId, string> = {
  labs: '#C2603C', hyperscalers: '#2F6B8F', chips: '#4F7F5A', neoclouds: '#C08A2E', developers: '#8C6A4F', vehicles: '#9A8FB5', capital: '#6F665D',
};
export const CAT_SHORT: Record<CategoryId, string> = {
  labs: 'AI labs', hyperscalers: 'Hyperscalers', chips: 'Chips', neoclouds: 'Neoclouds', developers: 'Developers', vehicles: 'SPVs', capital: 'Capital',
};
/** Overview columns, in the order money and compute move. */
export const OVERVIEW_COLUMNS: CategoryId[][] = [['capital'], ['labs'], ['hyperscalers'], ['neoclouds'], ['developers', 'vehicles'], ['chips']];
export const MAX_SELECTED = 3;

/** Amount in US$ bn when the record is in dollars, else null (shares, GW and percentages do not set a width). */
export const usdBn = (e: Pick<GraphEdge, 'amount' | 'unit'>) => (e.amount !== null && (e.unit ?? '').startsWith('USD bn') ? e.amount : null);
export const fmtBn = (a: number) => (a >= 1 ? `$${a >= 100 ? Math.round(a) : +a.toFixed(1)}bn` : `$${Math.round(a * 1000)}m`);
/** Who pays in a record: delivery runs provider → recipient, so the recipient is the payer; all other layers run from the payer. */
export const payerOf = (e: Pick<GraphEdge, 'from' | 'to' | 'layer'>) => (e.layer === 'delivery' ? e.to : e.from);
export const lineWidth = (e: Pick<GraphEdge, 'amount' | 'unit'>) => { const a = usdBn(e); return a ? Math.max(1.6, Math.min(16, Math.sqrt(a) * 1.15)) : 1.1; };

export interface FNode { id: string; tick: string | null; name: string; cat: CategoryId; core: boolean; selected: boolean; x: number; y: number; w: number; h: number }
export interface FEdge { e: GraphEdge; flow: Flow; d: string; width: number; opacity: number; arrow: boolean; label: string | null; lx: number; ly: number; between: boolean }
export interface FText { x: number; y: number; text: string; sub?: string; tone?: 'all' | 'some' | 'one' }
export interface FlowLayout { width: number; height: number; nodes: FNode[]; edges: FEdge[]; headers: FText[]; captions: FText[]; groups: Map<string, string[]> }

const nodeText = (id: string, label: string) => {
  const first = label.replace(/\n.*/s, '');
  const tick = TICKERS[id] ?? null;
  return { tick, name: tick ? first : tickerize(first) };
};

/**
 * Positions, line paths and labels for the network. Nothing selected: the company overview in category columns.
 * One to three selected: the selected companies stacked in the middle, payers and funders on the left, payees on
 * the right, counterparties grouped by exactly which selected companies they link to.
 */
export function flowLayout(r: Release, vis: VisibleGraph, selected: string[], width: number): FlowLayout {
  const nm = new Map(r.graph.nodes.map((n) => [n.id, n]));
  const core = new Set(r.graph.core);
  const sel = selected.slice(0, MAX_SELECTED), isSel = (id: string) => sel.includes(id);
  const SEL = sel.length > 0, MULTI = sel.length > 1;
  const edges = vis.edges.filter((e) => !SEL || isSel(e.from) || isSel(e.to));
  const ids = SEL ? [...new Set([...sel, ...edges.flatMap((e) => [e.from, e.to])])] : vis.nodeIds;
  const base = ids.filter((id) => nm.has(id)).map((id) => { const n = nm.get(id)!; return { id, ...nodeText(id, n.label_en), cat: categoryOf(n), core: core.has(id), selected: isSel(id) }; });

  // Which side and which group each counterparty belongs to.
  const inAmt = new Map<string, number>(), outAmt = new Map<string, number>(), links = new Map<string, Set<string>>();
  for (const e of edges) {
    const payer = payerOf(e), payee = payer === e.from ? e.to : e.from;
    const add = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + (usdBn(e) ?? 0) + 1e-3);
    if (isSel(payee) && !isSel(payer)) add(inAmt, payer);
    if (isSel(payer) && !isSel(payee)) add(outAmt, payee);
    for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) if (isSel(a) && !isSel(b)) { if (!links.has(b)) links.set(b, new Set()); links.get(b)!.add(a); }
  }
  const groupOf = (id: string) => sel.filter((s) => links.get(id)?.has(s));
  const groups = new Map(base.filter((n) => !n.selected).map((n) => [n.id, groupOf(n.id)]));
  const sideOf = (id: string) => (isSel(id) ? 'me' : (inAmt.get(id) ?? 0) >= (outAmt.get(id) ?? 0) ? 'in' : 'out');
  const COLS: string[][] = SEL ? [['in'], ['me'], ['out']] : OVERVIEW_COLUMNS;
  const keyOf = (n: (typeof base)[number]) => (SEL ? sideOf(n.id) : n.cat);
  const cols = COLS.map((c) => base.filter((n) => c.includes(keyOf(n)))).filter((c) => c.length);
  const colKeys = cols.map((c) => keyOf(c[0]));

  const PADX = 24, TOP = SEL ? 82 : 64;
  const BW = SEL ? Math.max(104, Math.min(170, (width - PADX * 2) / 3.6)) : 142;
  const BH = SEL ? 50 : 44, GAPY = SEL ? 20 : 16, GAPG = 34;
  const span = width - PADX * 2 - BW;
  const cx = (i: number) => PADX + (span * i) / Math.max(1, cols.length - 1);
  const size = (id: string) => Math.max(inAmt.get(id) ?? 0, outAmt.get(id) ?? 0);
  const gKey = (id: string) => (groups.get(id) ?? []).join('|');
  const gRank = (id: string) => { const g = groups.get(id) ?? []; return (sel.length - g.length) * 100 + Math.min(...g.map((s) => sel.indexOf(s))) * 10 + Math.max(...g.map((s) => sel.indexOf(s))); };
  const gapIn = (i: number) => (SEL && colKeys[i] === 'me' ? 86 : GAPY);
  const nGroups = (i: number) => (MULTI && colKeys[i] !== 'me' ? new Set(cols[i].map((n) => gKey(n.id))).size : 1);
  const colH = (i: number) => cols[i].length * BH + gapIn(i) * (cols[i].length - 1) + (nGroups(i) - 1) * GAPG;
  const height = Math.max(SEL && !MULTI ? 420 : 0, TOP + Math.max(...cols.map((_, i) => colH(i)), 0) + 36);

  const pos = new Map<string, { x: number; y: number; col: number }>();
  const captions: FText[] = [];
  const place = () => {
    captions.length = 0;
    cols.forEach((c, i) => {
      let y = TOP + (height - TOP - 36 - colH(i)) / 2;
      c.forEach((n, k) => {
        if (MULTI && colKeys[i] !== 'me' && (k === 0 || gKey(c[k - 1].id) !== gKey(n.id))) {
          if (k > 0) y += GAPG;
          const g = groups.get(n.id) ?? [];
          const lbl = (s: string) => base.find((b) => b.id === s)!;
          const text = g.length === sel.length ? (sel.length === 2 ? 'Linked to both' : `Linked to all ${sel.length}`) : g.length > 1 ? g.map((s) => lbl(s).tick ?? lbl(s).name).join(' + ') : `Only ${lbl(g[0]).tick ?? lbl(g[0]).name}`;
          captions.push({ x: cx(i), y: y - 10, text, tone: g.length === sel.length ? 'all' : g.length > 1 ? 'some' : 'one' });
        }
        pos.set(n.id, { x: cx(i), y, col: i }); y += BH + gapIn(i);
      });
    });
  };
  place();
  const nbr = new Map<string, string[]>(base.map((n) => [n.id, []]));
  for (const e of edges) { nbr.get(e.from)?.push(e.to); nbr.get(e.to)?.push(e.from); }
  const bary = (id: string) => { const ys = nbr.get(id)!.map((m) => pos.get(m)?.y).filter((v): v is number => v !== undefined); return ys.length ? ys.reduce((s, v) => s + v, 0) / ys.length : pos.get(id)!.y; };
  if (SEL) {
    cols.forEach((c, i) => { if (colKeys[i] === 'me') c.sort((a, b) => sel.indexOf(a.id) - sel.indexOf(b.id)); else c.sort((a, b) => (MULTI ? gRank(a.id) - gRank(b.id) : 0) || size(b.id) - size(a.id) || a.id.localeCompare(b.id)); });
    place();
  } else {
    for (let it = 0; it < 12; it++) { for (const c of cols) c.sort((a, b) => bary(a.id) - bary(b.id) || a.id.localeCompare(b.id)); place(); }
  }

  // Lines. Ports are spread along each box side in the order of the far end's height, so lines leave without crossing.
  const between = edges.filter((e) => isSel(e.from) && isSel(e.to));
  type G = { e: GraphEdge; a: { x: number; y: number; col: number }; b: { x: number; y: number; col: number }; sa: 'L' | 'R'; sb: 'L' | 'R'; oa: number; ob: number };
  const sides = new Map<string, { g: G; other: { y: number }; end: 'a' | 'b' }[]>();
  const geo: G[] = edges.filter((e) => !between.includes(e)).map((e) => {
    const a = pos.get(e.from)!, b = pos.get(e.to)!;
    const [sa, sb]: ['L' | 'R', 'L' | 'R'] = a.col < b.col ? ['R', 'L'] : a.col > b.col ? ['L', 'R'] : ['R', 'R'];
    const g: G = { e, a, b, sa, sb, oa: 0.5, ob: 0.5 };
    for (const [id, side, other, end] of [[e.from, sa, b, 'a'], [e.to, sb, a, 'b']] as const) {
      const k = id + side; if (!sides.has(k)) sides.set(k, []); sides.get(k)!.push({ g, other, end });
    }
    return g;
  });
  for (const list of sides.values()) {
    list.sort((p, q) => p.other.y - q.other.y || p.g.e.id.localeCompare(q.g.e.id));
    list.forEach((p, i) => { p.g[p.end === 'a' ? 'oa' : 'ob'] = (i + 1) / (list.length + 1); });
  }
  const ranked = edges.filter((e) => usdBn(e)).sort((p, q) => usdBn(q)! - usdBn(p)!);
  const labelled = new Set(SEL ? ranked.slice(0, MULTI ? 14 : 10).map((e) => e.id) : []);
  const out: FEdge[] = geo.map(({ e, a, b, sa, sb, oa, ob }) => {
    const x1 = sa === 'R' ? a.x + BW : a.x, y1 = a.y + BH * oa, x2 = sb === 'R' ? b.x + BW : b.x, y2 = b.y + BH * ob;
    let c: number[];
    if (a.col === b.col) { const bulge = 46 + Math.abs(y2 - y1) * 0.12; c = [x1, y1, x1 + bulge, y1, x2 + bulge, y2, x2 + 4, y2]; }
    else { const dx = (x2 - x1) / 2; c = [x1, y1, x1 + dx, y1, x2 - dx, y2, x2 + (sb === 'L' ? -3 : 3), y2]; }
    // label on the curve; in a selection near the counterparty end, where lines have spread apart
    const t = !SEL ? 0.5 : isSel(e.from) ? 0.78 : 0.22;
    const bz = (p0: number, p1: number, p2: number, p3: number) => (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3;
    const amt = usdBn(e);
    return {
      e, flow: FLOW_OF[e.layer], d: `M${c[0]},${c[1]} C${c[2]},${c[3]} ${c[4]},${c[5]} ${c[6]},${c[7]}`, width: lineWidth(e),
      opacity: SEL ? (amt ? 0.8 : 0.45) : amt ? 0.55 : 0.2, arrow: SEL || !!amt, label: labelled.has(e.id) && amt ? fmtBn(amt) : null,
      lx: bz(c[0], c[2], c[4], c[6]), ly: bz(c[1], c[3], c[5], c[7]), between: false,
    };
  });
  between.sort((p, q) => (usdBn(q) ?? 0) - (usdBn(p) ?? 0) || p.id.localeCompare(q.id));
  const near = between.filter((e) => Math.abs(sel.indexOf(e.from) - sel.indexOf(e.to)) === 1);
  for (const e of between) {
    const a = pos.get(e.from)!, b = pos.get(e.to)!, amt = usdBn(e);
    const common = { e, flow: FLOW_OF[e.layer], width: lineWidth(e), opacity: 0.9, arrow: true, label: amt ? fmtBn(amt) : null, between: true };
    if (Math.abs(sel.indexOf(e.from) - sel.indexOf(e.to)) > 1) { // skips the box in between: bow out to the left
      const ya = a.y + BH / 2, yb = b.y + BH / 2, xo = a.x - 70;
      out.push({ ...common, d: `M${a.x},${ya} C${xo},${ya} ${xo},${yb} ${b.x - 3},${yb}`, lx: a.x - 52, ly: (ya + yb) / 2 });
      continue;
    }
    const pair = near.filter((x) => (x.from === e.from && x.to === e.to) || (x.from === e.to && x.to === e.from));
    const i = pair.indexOf(e), down = a.y < b.y;
    const x = a.x + BW / 2 + (i - (pair.length - 1) / 2) * 34;
    const y1 = down ? a.y + BH : a.y, y2 = down ? b.y - 3 : b.y + BH + 3;
    out.push({ ...common, d: `M${x},${y1} L${x},${y2}`, lx: x + 8 + (common.label ? common.label.length * 3.3 + 6 : 0), ly: (y1 + y2) / 2 });
  }
  // keep labels from sitting on each other
  const placed: [number, number, number][] = [];
  for (const f of out.filter((x) => x.label).sort((p, q) => q.width - p.width)) {
    const w = f.label!.length * 6.6 + 12;
    for (let k = 0; k < 20 && placed.some(([x, y, pw]) => Math.abs(x - f.lx) < (pw + w) / 2 + 4 && Math.abs(y - f.ly) < 21); k++) f.ly += 21;
    placed.push([f.lx, f.ly, w]);
  }
  out.sort((p, q) => p.width - q.width);

  const headers: FText[] = SEL
    ? colKeys.map((k, i) => ({ x: cx(i), y: 30, text: k === 'in' ? (MULTI ? 'Pays, funds or backs them' : 'Pays, funds or backs it') : k === 'out' ? (MULTI ? 'They pay or buy from' : 'It pays or buys from') : MULTI ? 'Selected' : '', sub: k === 'me' && !MULTI ? '' : `${cols[i].length} ${cols[i].length === 1 ? 'company' : 'companies'}` }))
    : cols.map((c, i) => ({ x: cx(i), y: 30, text: OVERVIEW_COLUMNS.find((oc) => oc.includes(c[0].cat))!.map((k) => k === 'developers' ? 'Developers' : CAT_SHORT[k]).join(' & '), sub: `${c.length} companies` }));
  const nodes: FNode[] = base.map((n) => ({ ...n, ...pos.get(n.id)!, w: BW, h: BH }));
  return { width, height, nodes, edges: out, headers, captions, groups };
}
