import type { DisplayGraph, DisplayNode } from './display';
import { CATEGORIES } from './categories';

export type LayoutMode = 'tiers' | 'ego' | 'bubble' | 'fixed';
export interface Pos { x: number; y: number }
export interface Header { id: string; title: string; x: number; y: number }
export interface Placed { pos: Map<string, Pos>; size: Map<string, { w: number; h: number }>; headers: Header[] }

/** Box size in model units from the label; selected companies and core companies get a larger font. */
export function boxFor(n: DisplayNode, selected: boolean, round = false) {
  const fs = selected ? 30 : n.core ? 24 : 17;
  const longest = Math.max(...n.lines.map((l) => l.length), 1);
  const w = Math.max(64, longest * fs * 0.6 + 26), h = n.lines.length * fs * 1.25 + 16;
  return round ? { w: w * 1.18, h: Math.max(h * 1.45, w * 0.55) } : { w, h };
}

const CAT_ORDER = CATEGORIES.map((c) => c.id) as string[];
const SHORT: Record<string, string> = { labs: 'AI labs', hyperscalers: 'Hyperscalers', chips: 'Chips', neoclouds: 'Neoclouds', developers: 'Developers', vehicles: 'SPVs & projects', capital: 'Capital' };
const byCategory = (labelOf: (n: DisplayNode) => string) => (a: DisplayNode, b: DisplayNode) =>
  CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category) || Number(b.core) - Number(a.core) || labelOf(a).localeCompare(labelOf(b));

/** Stack nodes into one or more columns starting at x0 going in direction dir (±1); returns the x reached. */
function stack(nodes: DisplayNode[], x0: number, dir: number, maxRows: number, size: Map<string, { w: number; h: number }>, pos: Map<string, Pos>, gapX: number, gapY: number) {
  let x = x0;
  for (let c = 0; c * maxRows < nodes.length; c++) {
    const col = nodes.slice(c * maxRows, (c + 1) * maxRows);
    const w = Math.max(...col.map((n) => size.get(n.id)!.w));
    const total = col.reduce((s, n) => s + size.get(n.id)!.h, 0) + gapY * (col.length - 1);
    let y = -total / 2;
    const cx = x + (dir * w) / 2;
    for (const n of col) { const h = size.get(n.id)!.h; pos.set(n.id, { x: cx, y: y + h / 2 }); y += h + gapY; }
    x += dir * (w + gapX);
  }
  return x;
}

/**
 * Layered ego layout: selected companies (and counterparties shared by two or more of them) in the centre column;
 * counterparties that point into the selection on the left, those the selection points to on the right.
 */
export function egoLayout(g: DisplayGraph, selected: string[], shared: Set<string>, labelOf: (n: DisplayNode) => string): Placed {
  const sel = new Set(selected);
  const size = new Map(g.nodes.map((n) => [n.id, boxFor(n, sel.has(n.id))]));
  const pos = new Map<string, Pos>();
  const centre = [...selected.map((id) => g.nodes.find((n) => n.id === id)).filter(Boolean) as DisplayNode[]];
  const sharedNodes = g.nodes.filter((n) => shared.has(n.id) && !sel.has(n.id));
  // Interleave shared counterparties between the selected companies so their links stay short.
  const mid: DisplayNode[] = centre.length > 1 ? [centre[0], ...sharedNodes, ...centre.slice(1)] : [...centre, ...sharedNodes];
  const score = new Map<string, number>();
  for (const e of g.edges) {
    if (sel.has(e.target) && !sel.has(e.source)) score.set(e.source, (score.get(e.source) ?? 0) + 1);
    if (sel.has(e.source) && !sel.has(e.target)) score.set(e.target, (score.get(e.target) ?? 0) - 1);
  }
  const rest = g.nodes.filter((n) => !mid.includes(n)).sort(byCategory(labelOf));
  const left = rest.filter((n) => (score.get(n.id) ?? 0) >= 0), right = rest.filter((n) => (score.get(n.id) ?? 0) < 0);
  const maxRows = Math.max(9, mid.length + 2), gapX = 110, gapY = 18;
  const midW = Math.max(...mid.map((n) => size.get(n.id)!.w), 1);
  stack(mid, -midW / 2, 1, mid.length, size, pos, gapX, gapY * 2.2);
  stack(left, -midW / 2 - gapX, -1, maxRows, size, pos, gapX, gapY);
  stack(right, midW / 2 + gapX, 1, maxRows, size, pos, gapX, gapY);
  const top = Math.min(...[...pos.values()].map((p) => p.y - (size.get([...pos.entries()].find(([, q]) => q === p)![0])?.h ?? 0) / 2)) - 46;
  const leftEdge = (ns: DisplayNode[]) => Math.min(...ns.map((n) => pos.get(n.id)!.x - size.get(n.id)!.w / 2));
  const headers: Header[] = [];
  if (left.length) headers.push({ id: 'in', title: 'Into the selection', x: leftEdge(left), y: top });
  headers.push({ id: 'mid', title: 'Selected', x: leftEdge(mid), y: top });
  if (right.length) headers.push({ id: 'out', title: 'From the selection', x: leftEdge(right), y: top });
  return { pos, size, headers };
}

/**
 * Category bands top to bottom in risk-transmission order (payers → platforms → builders → vehicles → capital).
 * Rows keep the drawing close to the panel's shape, so the fit can zoom in; long rows wrap.
 */
export function tierLayout(g: DisplayGraph, selected: string[], labelOf: (n: DisplayNode) => string): Placed {
  const sel = new Set(selected);
  const size = new Map(g.nodes.map((n) => [n.id, boxFor(n, sel.has(n.id))]));
  const pos = new Map<string, Pos>(); const headers: Header[] = [];
  const perRow = 6, gapX = 40, gapY = 70, headerH = 34;
  let y = 0;
  for (const c of CATEGORIES) {
    const band = g.nodes.filter((n) => n.category === c.id).sort((a, b) => Number(sel.has(b.id)) - Number(sel.has(a.id)) || byCategory(labelOf)(a, b));
    if (!band.length) continue;
    const rows: DisplayNode[][] = [];
    for (let i = 0; i < band.length; i += perRow) rows.push(band.slice(i, i + perRow));
    let bandLeft = Infinity; const bandTop = y;
    for (const row of rows) {
      const h = Math.max(...row.map((n) => size.get(n.id)!.h));
      const total = row.reduce((s, n) => s + size.get(n.id)!.w, 0) + gapX * (row.length - 1);
      let x = -total / 2; bandLeft = Math.min(bandLeft, x);
      for (const n of row) { const w = size.get(n.id)!.w; pos.set(n.id, { x: x + w / 2, y: y + headerH + h / 2 }); x += w + gapX; }
      y += h + 18;
    }
    headers.push({ id: c.id, title: SHORT[c.id] ?? c.title, x: bandLeft, y: bandTop });
    y += gapY - 18 + headerH;
  }
  return { pos, size, headers };
}
