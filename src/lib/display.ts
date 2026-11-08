import type { GraphEdge, Release } from './types';
import type { VisibleGraph } from './selection';
import { TICKERS, tickerize } from './tickers';
import { readableLines } from './geometry';
import { categoryOf, type CategoryId } from './categories';

/** What the graph actually draws: project-level nodes can be merged into one box per parent company. */
export interface DisplayNode { id: string; lines: string[]; kind: string; core: boolean; category: CategoryId; combo?: { parent: string; members: string[] } }
export interface DisplayEdge { id: string; source: string; target: string; layer: string; label: string; count: number; ids: string[]; october: boolean }
export interface DisplayGraph { nodes: DisplayNode[]; edges: DisplayEdge[] }

/** Split a long single line near its middle space so boxes stay compact. */
export function wrap(lines: string[], max = 16): string[] {
  return lines.flatMap((l) => {
    if (l.length <= max) return [l];
    const mid = l.length / 2; let best = -1;
    for (let i = 0; i < l.length; i++) if (l[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
    return best < 0 ? [l] : [l.slice(0, best), l.slice(best + 1)];
  }).slice(0, 3);
}

/** "$22.4bn", "14%", "5 GW", "30m shares"; empty when undisclosed. */
export function amountLabel(e: Pick<GraphEdge, 'amount' | 'unit'>): string {
  if (e.amount === null || e.amount === undefined) return '';
  const a = e.amount.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const u = (e.unit || '').toLowerCase();
  if (u.startsWith('usd bn')) return `$${a}bn`;
  if (u.startsWith('percent')) return `${a}%`;
  if (u.startsWith('million shares')) return `${a}m shares`;
  return `${a} ${e.unit}`.trim().slice(0, 16);
}

/** Parent company of each project: the company on the other end of its affiliation edge. */
export function projectParents(r: Release): Map<string, string> {
  const kinds = new Map(r.graph.nodes.map((n) => [n.id, n.kind]));
  const out = new Map<string, string>();
  for (const e of r.graph.edges) {
    if (e.layer !== 'affiliation') continue;
    const [p, c] = kinds.get(e.to) === 'project' ? [e.to, e.from] : kinds.get(e.from) === 'project' ? [e.from, e.to] : [null, null];
    if (p && c && !out.has(p)) out.set(p, c);
  }
  return out;
}

/**
 * Build the drawn graph: projects that share a parent and are not expanded collapse into one combo node;
 * parallel edges with the same endpoints and layer merge into one line labelled with a count.
 */
export function displayGraph(r: Release, vis: VisibleGraph, labelOf: (id: string) => string, expanded: Set<string>, selected: string[], merge = true): DisplayGraph {
  const nm = new Map(r.graph.nodes.map((n) => [n.id, n]));
  const core = new Set(r.graph.core);
  const parents = projectParents(r);
  const sel = new Set(selected);
  const byParent = new Map<string, string[]>();
  for (const id of vis.nodeIds) { const p = parents.get(id); if (p && !sel.has(id)) byParent.set(p, [...(byParent.get(p) ?? []), id]); }
  const mapTo = new Map<string, string>();
  if (merge) for (const [p, members] of byParent) if (members.length >= 2 && !expanded.has(p)) for (const m of members) mapTo.set(m, `combo:${p}`);
  const at = (id: string) => mapTo.get(id) ?? id;

  const nodes = new Map<string, DisplayNode>();
  for (const id of vis.nodeIds) {
    const target = at(id);
    if (nodes.has(target)) continue;
    if (target.startsWith('combo:')) {
      const parent = target.slice(6); const members = byParent.get(parent)!;
      nodes.set(target, { id: target, lines: [`${TICKERS[parent] ?? tickerize(labelOf(parent))} projects ×${members.length}`, 'click to expand'], kind: 'project', core: false, category: 'vehicles', combo: { parent, members } });
    } else {
      const n = nm.get(id)!;
      nodes.set(id, { id, lines: TICKERS[id] ? [TICKERS[id]] : wrap(readableLines(tickerize(n.label_en))), kind: n.kind, core: core.has(id), category: categoryOf(n) });
    }
  }
  const edges = new Map<string, DisplayEdge>();
  for (const e of vis.edges) {
    const s = at(e.from), t = at(e.to);
    if (s === t) continue;
    const key = `${s}|${t}|${e.layer}`;
    const prev = edges.get(key);
    if (prev) { prev.count++; prev.ids.push(e.id); prev.label = `×${prev.count}`; prev.october ||= e.october_change; continue; }
    edges.set(key, { id: e.id, source: s, target: t, layer: e.layer, label: amountLabel(e), count: 1, ids: [e.id], october: e.october_change });
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
