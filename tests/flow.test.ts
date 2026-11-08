import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadRelease } from '../src/lib/data';
import type { Release } from '../src/lib/types';
import { DEFAULT_SELECTION, visibleGraph } from '../src/lib/selection';
import { flowLayout, payerOf, usdBn, OVERVIEW_COLUMNS } from '../src/lib/flow';

const base = path.resolve(__dirname, '../public/data');
let r: Release;
beforeAll(async () => { r = await loadRelease(async (p) => fs.readFileSync(path.join(base, p), 'utf8')); });
const layout = (selected: string[], width = 1280) => flowLayout(r, visibleGraph(r, { ...DEFAULT_SELECTION, selected }), selected, width);
const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('overview', () => {
  it('places every company in its category column, left to right in flow order, with no overlapping boxes', () => {
    const f = layout([]);
    expect(f.nodes).toHaveLength(36);
    const colX = OVERVIEW_COLUMNS.map((c) => [...new Set(f.nodes.filter((n) => c.includes(n.cat)).map((n) => n.x))]);
    for (const xs of colX) expect(xs.length).toBeLessThanOrEqual(1);
    const xs = colX.flat();
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    for (let i = 0; i < f.nodes.length; i++) for (let j = i + 1; j < f.nodes.length; j++) expect(overlap(f.nodes[i], f.nodes[j])).toBe(false);
  });
  it('draws one line per record, labels none and keeps every box inside the canvas', () => {
    const f = layout([]);
    expect(f.edges).toHaveLength(visibleGraph(r, DEFAULT_SELECTION).edges.length);
    expect(f.edges.every((e) => e.label === null)).toBe(true);
    for (const n of f.nodes) { expect(n.x).toBeGreaterThanOrEqual(0); expect(n.x + n.w).toBeLessThanOrEqual(f.width); expect(n.y + n.h).toBeLessThanOrEqual(f.height); }
  });
});

describe('one company selected', () => {
  it('puts payers on the left and payees on the right of the selected company', () => {
    const f = layout(['OpenAI']);
    const me = f.nodes.find((n) => n.id === 'OpenAI')!;
    const at = (id: string) => f.nodes.find((n) => n.id === id)!;
    expect(at('SoftBank').x).toBeLessThan(me.x); // invests in OpenAI
    expect(at('Oracle').x).toBeGreaterThan(me.x); // OpenAI buys compute from Oracle
    for (const e of f.edges) if (usdBn(e.e)) expect(f.nodes.some((n) => n.id === e.e.from) && f.nodes.some((n) => n.id === e.e.to)).toBe(true);
  });
  it('treats the delivery recipient as the payer', () => {
    expect(payerOf({ from: 'Plant', to: 'Buyer', layer: 'delivery' })).toBe('Buyer');
    expect(payerOf({ from: 'Buyer', to: 'Supplier', layer: 'commercial' })).toBe('Buyer');
  });
  it('labels the largest lines with their amounts', () => {
    const f = layout(['OpenAI']);
    expect(f.edges.find((e) => e.e.from === 'OpenAI' && e.e.to === 'Oracle')?.label).toBe('$300bn');
  });
});

describe('two or three companies selected', () => {
  it('stacks the selected companies in the middle and draws the links between them there', () => {
    const f = layout(['OpenAI', 'CoreWeave']);
    const a = f.nodes.find((n) => n.id === 'OpenAI')!, b = f.nodes.find((n) => n.id === 'CoreWeave')!;
    expect(a.x).toBe(b.x); expect(a.y).toBeLessThan(b.y);
    const mid = f.edges.filter((e) => e.between);
    expect(mid.length).toBeGreaterThan(0);
    expect(mid.find((e) => usdBn(e.e) === 22.4)?.label).toBe('$22.4bn');
  });
  it('groups counterparties by exactly which selected companies they link to, all first', () => {
    const f = layout(['OpenAI', 'CoreWeave']);
    expect(f.groups.get('NVIDIA')).toEqual(['OpenAI', 'CoreWeave']);
    expect(f.groups.get('SoftBank')).toEqual(['OpenAI']);
    expect(f.groups.get('Meta')).toEqual(['CoreWeave']);
    const left = f.nodes.filter((n) => !n.selected && n.x < f.nodes.find((m) => m.id === 'OpenAI')!.x).sort((p, q) => p.y - q.y);
    const rank = (id: string) => { const g = f.groups.get(id)!; return g.length === 2 ? 0 : g[0] === 'OpenAI' ? 1 : 2; };
    expect(left.map((n) => rank(n.id))).toEqual([...left.map((n) => rank(n.id))].sort());
    expect(f.captions.map((c) => c.text)).toEqual(expect.arrayContaining(['Linked to both', 'Only OpenAI', 'Only CRWV']));
  });
  it('names pair groups when three are selected and routes a link that skips a box around it', () => {
    const f = layout(['OpenAI', 'CoreWeave', 'NVIDIA']);
    expect(f.captions.map((c) => c.text)).toEqual(expect.arrayContaining(['CRWV + NVDA', 'Only NVDA']));
    const skip = f.edges.find((e) => e.between && e.e.from === 'NVIDIA' && e.e.to === 'OpenAI')!;
    expect(skip.d).toContain('C'); // a curve, not a straight line through CoreWeave
    for (let i = 0; i < f.nodes.length; i++) for (let j = i + 1; j < f.nodes.length; j++) expect(overlap(f.nodes[i], f.nodes[j])).toBe(false);
  });
  it('fits a phone-width canvas without overlapping boxes', () => {
    const f = layout(['OpenAI', 'CoreWeave'], 380);
    for (const n of f.nodes) expect(n.x + n.w).toBeLessThanOrEqual(380);
    for (let i = 0; i < f.nodes.length; i++) for (let j = i + 1; j < f.nodes.length; j++) expect(overlap(f.nodes[i], f.nodes[j])).toBe(false);
  });
});
