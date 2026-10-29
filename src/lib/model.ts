import type { GraphEdge, GraphNode, Layer, Release } from './types';
import { LAYERS } from './types';

export const LAYER_STYLE: Record<Layer, { color: string; dash: 'solid' | 'dashed' | 'dotted'; pattern?: number[]; arrow: string; name: string; desc: string }> = {
  capital: { color: '#007B83', dash: 'solid', arrow: 'triangle', name: 'Equity / capital', desc: 'Investor/provider → recipient' },
  commercial: { color: '#436B9A', dash: 'dashed', pattern: [7, 4], arrow: 'triangle', name: 'Procurement / commercial', desc: 'Buyer/customer → supplier' },
  delivery: { color: '#436B9A', dash: 'dotted', arrow: 'triangle-backcurve', name: 'Delivery / capacity', desc: 'Provider/project → recipient' },
  financing: { color: '#9C6F3A', dash: 'solid', arrow: 'triangle', name: 'Debt / financing', desc: 'Capital source → borrower/project' },
  support: { color: '#A35A83', dash: 'dashed', pattern: [10, 3, 2, 3], arrow: 'square', name: 'Credit / lease support', desc: 'Support provider → supported entity' },
  warrant: { color: '#A35A83', dash: 'dotted', arrow: 'diamond', name: 'Warrant (conditional right)', desc: 'Grantor → recipient of right' },
  affiliation: { color: '#A49A91', dash: 'dashed', pattern: [2, 5], arrow: 'none', name: 'Project affiliation', desc: 'Related entity → project' },
};

/** Direction semantics in words, per layer (handoff §4.1). */
const VERB: Record<Layer, string> = {
  capital: 'provides capital / equity to',
  commercial: 'is the buyer/customer in a procurement or service agreement with supplier',
  delivery: 'delivers equipment, capacity or demand to',
  financing: 'provides financing to',
  support: 'provides credit / lease support to',
  warrant: 'grants a conditional equity right (warrant) to',
  affiliation: 'is affiliated (operator/platform/project connection) with',
};

export interface Filters { view: string; layers: Layer[]; octOnly: boolean; node: string | null; edge: string | null }
export const DEFAULT_FILTERS: Filters = { view: 'companies-network', layers: [...LAYERS], octOnly: false, node: null, edge: null };

export function nodeName(n: GraphNode | undefined, id?: string): string {
  if (!n) return id ?? '';
  return n.label_en;
}
export function nodeMap(r: Release) { return new Map(r.graph.nodes.map((n) => [n.id, n])); }

export function directionWords(e: GraphEdge, nodes: Map<string, GraphNode>): string {
  return `${nodeName(nodes.get(e.from), e.from)} ${VERB[e.layer]} ${nodeName(nodes.get(e.to), e.to)}`;
}

export function humanStatus(s: string): string { return s.replace(/_/g, ' '); }

/** Qualified amount. Null amount is NEVER rendered as 0. */
export function formatAmount(e: Pick<GraphEdge, 'amount' | 'unit' | 'status'>): string {
  if (e.amount === null || e.amount === undefined) return 'Amount not disclosed / unknown';
  const unit = e.unit || '(unit not stated)';
  return `${e.amount.toLocaleString('en-US', { maximumFractionDigits: 3 })} ${unit} — basis: ${humanStatus(e.status)}`;
}
export function shortAmount(e: GraphEdge): string {
  return e.amount === null ? '—' : `${e.amount.toLocaleString('en-US', { maximumFractionDigits: 3 })} ${e.unit}`;
}

/** Single predicate used by graph, table, counts and exports (AND across dimensions, OR within layers). */
export function visibleEdges(r: Release, f: Filters): GraphEdge[] {
  const v = r.views[f.view];
  const inView = new Set(v.edge_ids);
  const layers = new Set(f.layers);
  return r.graph.edges.filter((e) => inView.has(e.id) && layers.has(e.layer) && (!f.octOnly || e.october_change));
}
export function visibleNodeIds(r: Release, f: Filters): string[] { return r.views[f.view].node_ids; }

export function tableEdges(r: Release, f: Filters): GraphEdge[] {
  const es = visibleEdges(r, f);
  return f.node ? es.filter((e) => e.from === f.node || e.to === f.node) : es;
}

export function searchNodes(r: Release, q: string, view?: string): GraphNode[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const allowed = view ? new Set(r.views[view].node_ids) : null;
  return r.graph.nodes
    .filter((n) => [n.id, n.label_raw, n.label_en].some((x) => x.toLowerCase().includes(s)))
    .sort((a, b) => Number(allowed ? !allowed.has(a.id) : 0) - Number(allowed ? !allowed.has(b.id) : 0) || (a.kind === 'core' ? -1 : 0) - (b.kind === 'core' ? -1 : 0));
}

const SAFE_URL = /^https?:\/\//i;
export function safeUrls(urls: string[] | undefined): string[] { return (urls ?? []).filter((u) => SAFE_URL.test(u)); }

// ---------- URL state
export function filtersToQuery(f: Filters, releaseId: string): string {
  const p = new URLSearchParams();
  p.set('release', releaseId);
  if (f.view !== DEFAULT_FILTERS.view) p.set('view', f.view);
  if (f.layers.length !== LAYERS.length) p.set('layers', f.layers.join(','));
  if (f.octOnly) p.set('oct', '1');
  if (f.node) p.set('node', f.node);
  if (f.edge) p.set('edge', f.edge);
  return p.toString();
}
export function queryToFilters(q: string, r: Release): Filters {
  const p = new URLSearchParams(q);
  const view = p.get('view') && r.views[p.get('view')!] ? p.get('view')! : DEFAULT_FILTERS.view;
  const layersRaw = p.get('layers');
  const layers = layersRaw === null ? [...LAYERS] : (layersRaw.split(',').filter((l) => (LAYERS as string[]).includes(l)) as Layer[]);
  const ids = new Set(r.graph.nodes.map((n) => n.id));
  const eids = new Set(r.graph.edges.map((e) => e.id));
  const node = p.get('node');
  const edge = p.get('edge');
  return { view, layers, octOnly: p.get('oct') === '1', node: node && ids.has(node) ? node : null, edge: edge && eids.has(edge) ? edge : null };
}

// ---------- export
export function exportRows(r: Release, f: Filters) {
  const nodes = nodeMap(r);
  return tableEdges(r, f).map((e) => ({
    release_id: r.manifest.release_id,
    cutoff_utc: r.manifest.as_of,
    release_type: r.manifest.release_type,
    edge_id: e.id,
    deal_id: e.deal_id,
    layer: e.layer,
    from_id: e.from,
    from_label: nodeName(nodes.get(e.from)),
    to_id: e.to,
    to_label: nodeName(nodes.get(e.to)),
    direction: directionWords(e, nodes),
    amount: e.amount,
    unit: e.unit,
    status_raw: e.status,
    october_change: e.october_change,
    label_raw: e.label,
    note_raw: e.note,
    source_id: e.source,
    source_urls: safeUrls(r.sources[e.source]?.urls).join(' '),
  }));
}
export function exportJSON(r: Release, f: Filters): string {
  return JSON.stringify({
    release_id: r.manifest.release_id, cutoff_utc: r.manifest.as_of, release_type: r.manifest.release_type,
    scope: { view: f.view, layers: f.layers, october_change_only: f.octOnly, focused_node: f.node, filtered: f.view !== 'full-network' || f.layers.length !== LAYERS.length || f.octOnly || !!f.node },
    notice: r.graph.data_quality_notice,
    relationships: exportRows(r, f),
  }, null, 2);
}
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function exportCSV(r: Release, f: Filters): string {
  const rows = exportRows(r, f);
  const cols = Object.keys(rows[0] ?? { release_id: '', cutoff_utc: '' });
  const head = `# release_id=${r.manifest.release_id}; cutoff_utc=${r.manifest.as_of}; view=${f.view}; layers=${f.layers.join('|')}; october_change_only=${f.octOnly}; node=${f.node ?? ''}; empty amount = not disclosed (not zero)`;
  return [head, cols.join(','), ...rows.map((row) => cols.map((c) => csvCell((row as Record<string, unknown>)[c])).join(','))].join('\n');
}
