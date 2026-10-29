import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadRelease, validateRelease } from '../src/lib/data';
import type { Release } from '../src/lib/types';
import { LAYERS } from '../src/lib/types';
import { DEFAULT_FILTERS, exportCSV, exportJSON, formatAmount, queryToFilters, filtersToQuery, searchNodes, tableEdges, visibleEdges, safeUrls } from '../src/lib/model';

const base = path.resolve(__dirname, '../public/data');
const fetcher = async (p: string) => fs.readFileSync(path.join(base, p), 'utf8');
let r: Release;
function csvRecords(t: string): string[][] {
  const out: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); out.push(row); row = []; cell = ''; } else cell += c; }
  row.push(cell); out.push(row); return out;
}
beforeAll(async () => { r = await loadRelease(fetcher); });

describe('frozen seed release', () => {
  it('loads via latest pointer with verified hashes: 91 nodes / 213 edges, refs resolve', () => {
    expect(r.hashVerified).toBe(true);
    expect(r.graph.nodes.length).toBe(91);
    expect(new Set(r.graph.edges.map((e) => e.id)).size).toBe(213);
    expect(validateRelease(r.graph, r.sources, r.views)).toEqual([]);
    expect(Object.keys(r.sources).length).toBe(102);
    expect(r.manifest.as_of).toBe('2026-10-28T17:04:34Z');
    expect(r.manifest.release_type).toBe('intra_month_research_preview');
  });
  it('layer distribution matches handoff §5.3', () => {
    const c = Object.fromEntries(LAYERS.map((l) => [l, r.graph.edges.filter((e) => e.layer === l).length]));
    expect(c).toEqual({ financing: 60, delivery: 39, commercial: 38, affiliation: 37, capital: 25, support: 9, warrant: 5 });
  });
  it('rejects a tampered file (hash mismatch)', async () => {
    const bad = async (p: string) => (p.endsWith('graph.json') ? (await fetcher(p)).replace('"R001"', '"R001x"') : fetcher(p));
    await expect(loadRelease(bad)).rejects.toThrow(/Hash mismatch/);
  });
  it('detects dangling references', () => {
    const g = structuredClone(r.graph); g.edges[0].source = 'NOPE'; g.edges[1].to = 'Nobody';
    const errs = validateRelease(g, r.sources, r.views);
    expect(errs.some((e) => e.includes('unknown source'))).toBe(true);
    expect(errs.some((e) => e.includes('unknown to'))).toBe(true);
  });
});

describe('company view (default)', () => {
  it('is exactly 36 nodes / 89 edges from manifest membership, all 12 core, no projects', () => {
    expect(DEFAULT_FILTERS.view).toBe('companies-network');
    const v = r.views['companies-network'];
    expect(v.node_ids.length).toBe(36);
    expect(visibleEdges(r, DEFAULT_FILTERS).length).toBe(89);
    expect(new Set(visibleEdges(r, DEFAULT_FILTERS).map((e) => e.id))).toEqual(new Set(v.edge_ids));
    for (const c of r.graph.core) expect(v.node_ids).toContain(c);
    const kinds = new Map(r.graph.nodes.map((n) => [n.id, n.kind]));
    expect(v.node_ids.filter((id) => kinds.get(id) === 'project')).toEqual([]);
  });
  it('full network view has all 91/213 with positions in 10000x8000 space', () => {
    const f = { ...DEFAULT_FILTERS, view: 'full-network' };
    expect(visibleEdges(r, f).length).toBe(213);
    const v = r.views['full-network'];
    expect(v.coordinate_system).toMatchObject({ width: 10000, height: 8000 });
    for (const id of v.node_ids) { const [x, y] = v.nodes[id].box; expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(10000); expect(y).toBeLessThanOrEqual(8000); }
  });
});

describe('filters', () => {
  const full = { ...DEFAULT_FILTERS, view: 'full-network' };
  it('October change filter gives 20 relationship records (not 22 deals)', () => {
    const f = { ...full, octOnly: true };
    expect(visibleEdges(r, f).length).toBe(20);
    expect(tableEdges(r, f).length).toBe(20);
    expect(JSON.parse(exportJSON(r, f)).relationships.length).toBe(20);
  });
  it('support layer only: 9 across full seed, consistent graph/table/export', () => {
    const f = { ...full, layers: ['support' as const] };
    expect(visibleEdges(r, f).length).toBe(9);
    expect(tableEdges(r, f).length).toBe(9);
    expect(JSON.parse(exportJSON(r, f)).relationships.length).toBe(9);
    expect(csvRecords(exportCSV(r, f)).length).toBe(2 + 9);
  });
  it('node focus restricts table to incident edges', () => {
    const f = { ...DEFAULT_FILTERS, node: 'OpenAI' };
    const rows = tableEdges(r, f);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((e) => e.from === 'OpenAI' || e.to === 'OpenAI')).toBe(true);
  });
});

describe('financial semantics', () => {
  it('null amounts stay visible and are never rendered or exported as zero', () => {
    const nulls = r.graph.edges.filter((e) => e.amount === null);
    expect(nulls.length).toBe(115);
    const f = { ...DEFAULT_FILTERS, view: 'full-network' };
    const ids = new Set(visibleEdges(r, f).map((e) => e.id));
    for (const e of nulls) { expect(ids.has(e.id)).toBe(true); expect(formatAmount(e)).not.toMatch(/\b0\b/); expect(formatAmount(e)).toMatch(/not disclosed/); }
    const rows = JSON.parse(exportJSON(r, f)).relationships;
    for (const row of rows.filter((x: { amount: number | null }) => x.amount === null)) expect(row.amount).toBeNull();
    expect(rows.filter((x: { amount: number | null }) => x.amount === 0).length).toBe(r.graph.edges.filter((e) => e.amount === 0).length);
  });
  it('amount display keeps unit and status qualifier', () => {
    const e = r.graph.edges.find((x) => x.id === 'R001')!;
    expect(formatAmount(e)).toBe('13 USD bn — basis: historical investment floor');
  });
  it('parallel edges between the same pair all remain individually present', () => {
    const groups = new Map<string, string[]>();
    for (const e of r.graph.edges) { const k = `${e.from}→${e.to}`; groups.set(k, [...(groups.get(k) ?? []), e.id]); }
    const multi = [...groups.values()].filter((g) => g.length > 1);
    expect(multi.length).toBeGreaterThan(0);
    const vis = new Set(visibleEdges(r, { ...DEFAULT_FILTERS, view: 'full-network' }).map((e) => e.id));
    for (const g of multi) for (const id of g) expect(vis.has(id)).toBe(true);
  });
});

describe('search, URL state, export metadata, safety', () => {
  it('search finds English and Chinese labels and every node', () => {
    expect(searchNodes(r, 'openai')[0].id).toBe('OpenAI');
    const zh = r.graph.nodes.find((n) => /[\u4e00-\u9fff]/.test(n.label_raw))!;
    expect(searchNodes(r, zh.label_raw.match(/[\u4e00-\u9fff]+/)![0]).map((n) => n.id)).toContain(zh.id);
    for (const n of r.graph.nodes) expect(searchNodes(r, n.label_en).map((x) => x.id)).toContain(n.id);
  });
  it('URL state round-trips', () => {
    const f = { view: 'full-network', layers: ['capital', 'warrant'] as never, octOnly: true, node: 'OpenAI', edge: 'R001' };
    expect(queryToFilters(filtersToQuery(f, r.manifest.release_id), r)).toEqual(f);
    expect(queryToFilters('node=<script>', r).node).toBeNull();
  });
  it('exports carry release id and cutoff', () => {
    const j = JSON.parse(exportJSON(r, DEFAULT_FILTERS));
    expect(j.release_id).toBe(r.manifest.release_id);
    expect(j.cutoff_utc).toBe('2026-10-28T17:04:34Z');
    expect(j.relationships.length).toBe(89);
    expect(exportCSV(r, DEFAULT_FILTERS).split('\n')[0]).toContain('cutoff_utc=2026-10-28T17:04:34Z');
  });
  it('only http(s) source links are clickable', () => {
    expect(safeUrls(['javascript:alert(1)', 'https://a.example', 'file:///x'])).toEqual(['https://a.example']);
  });
});
