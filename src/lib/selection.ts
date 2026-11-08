import type { GraphEdge, Layer, Release } from './types';
import type { LayoutMode } from './layouts';
import { LAYERS } from './types';

/** What the graph, table, counts and exports show. One predicate for all of them. */
export interface Selection {
  selected: string[];          // companies picked in the list or on the graph, in click order
  showAll: boolean;            // with nothing selected: company-level network, or a blank canvas
  layers: Layer[];
  octOnly: boolean;
  edge: string | null;
  layout: LayoutMode;
}
export const DEFAULT_SELECTION: Selection = { selected: [], showAll: true, layers: [...LAYERS], octOnly: false, edge: null, layout: 'tiers' };

export const OVERVIEW_VIEW = 'companies-network';
export const POSITION_VIEW = 'full-network';

export interface VisibleGraph {
  nodeIds: string[];
  edges: GraphEdge[];
  /** Counterparties linked to two or more selected companies. */
  shared: string[];
  /** Edges that run directly between two selected companies. */
  between: string[];
  /** Pairs of selected companies with neither a direct edge nor a shared counterparty in this dataset. */
  unlinkedPairs: [string, string][];
}

const keep = (s: Selection) => { const ls = new Set(s.layers); return (e: GraphEdge) => ls.has(e.layer) && (!s.octOnly || e.october_change); };

/**
 * Nothing selected: the company-level overview (or nothing). Something selected: the union of each selected
 * company's direct relationships — the company, its counterparties and the edges between them. Edges among
 * counterparties are not added; click a counterparty to bring its own relationships in.
 */
export function visibleGraph(r: Release, s: Selection): VisibleGraph {
  const ok = keep(s);
  if (!s.selected.length) {
    if (!s.showAll) return { nodeIds: [], edges: [], shared: [], between: [], unlinkedPairs: [] };
    const v = r.views[OVERVIEW_VIEW]; const inView = new Set(v.edge_ids);
    return { nodeIds: [...v.node_ids], edges: r.graph.edges.filter((e) => inView.has(e.id) && ok(e)), shared: [], between: [], unlinkedPairs: [] };
  }
  const sel = new Set(s.selected);
  const edges = r.graph.edges.filter((e) => (sel.has(e.from) || sel.has(e.to)) && ok(e));
  const nodes = new Set(s.selected);
  const touch = new Map<string, Set<string>>();
  for (const e of edges) {
    nodes.add(e.from); nodes.add(e.to);
    for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) if (sel.has(a)) { if (!touch.has(b)) touch.set(b, new Set()); touch.get(b)!.add(a); }
  }
  const shared = [...touch].filter(([id, by]) => !sel.has(id) && by.size >= 2).map(([id]) => id);
  const between = edges.filter((e) => sel.has(e.from) && sel.has(e.to)).map((e) => e.id);
  const unlinkedPairs: [string, string][] = [];
  for (let i = 0; i < s.selected.length; i++) for (let j = i + 1; j < s.selected.length; j++) {
    const a = s.selected[i], b = s.selected[j];
    const direct = edges.some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
    const viaShared = [...touch].some(([id, by]) => !sel.has(id) && by.has(a) && by.has(b));
    if (!direct && !viaShared) unlinkedPairs.push([a, b]);
  }
  return { nodeIds: [...nodes], edges, shared, between, unlinkedPairs };
}

/** Relationship counts per node across the whole release (for the company list). */
export function degree(r: Release): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of r.graph.edges) { m.set(e.from, (m.get(e.from) ?? 0) + 1); m.set(e.to, (m.get(e.to) ?? 0) + 1); }
  return m;
}

export function toggle(sel: string[], id: string): string[] { return sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]; }

// ---------- URL state
export function selectionToQuery(s: Selection, releaseId: string): string {
  const p = new URLSearchParams();
  p.set('release', releaseId);
  if (s.selected.length) p.set('sel', s.selected.join('|'));
  if (!s.showAll) p.set('all', '0');
  if (s.layers.length !== LAYERS.length) p.set('layers', s.layers.join(','));
  if (s.octOnly) p.set('oct', '1');
  if (s.edge) p.set('edge', s.edge);
  if (s.layout !== DEFAULT_SELECTION.layout) p.set('layout', s.layout);
  return p.toString();
}
export function queryToSelection(q: string, r: Release): Selection {
  const p = new URLSearchParams(q);
  const ids = new Set(r.graph.nodes.map((n) => n.id));
  const eids = new Set(r.graph.edges.map((e) => e.id));
  // `node=` is the pre-multi-select parameter; keep old links working.
  const raw = p.get('sel') ?? p.get('node') ?? '';
  const selected = raw.split('|').filter((x) => ids.has(x));
  const layersRaw = p.get('layers');
  const layers = layersRaw === null ? [...LAYERS] : (layersRaw.split(',').filter((l) => (LAYERS as string[]).includes(l)) as Layer[]);
  const edge = p.get('edge');
  return {
    selected: [...new Set(selected)], showAll: p.get('all') !== '0', layers, octOnly: p.get('oct') === '1',
    edge: edge && eids.has(edge) ? edge : null, layout: (['tiers', 'ego', 'bubble', 'fixed'] as LayoutMode[]).find((l) => l === p.get('layout')) ?? DEFAULT_SELECTION.layout,
  };
}
