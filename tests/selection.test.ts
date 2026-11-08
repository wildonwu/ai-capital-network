import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadRelease } from '../src/lib/data';
import type { Release } from '../src/lib/types';
import { DEFAULT_SELECTION, queryToSelection, selectionToQuery, toggle, visibleGraph } from '../src/lib/selection';
import { CATEGORIES, categoryOf } from '../src/lib/categories';

const base = path.resolve(__dirname, '../public/data');
let r: Release;
beforeAll(async () => { r = await loadRelease(async (p) => fs.readFileSync(path.join(base, p), 'utf8')); });
const sel = (selected: string[], extra = {}) => visibleGraph(r, { ...DEFAULT_SELECTION, selected, ...extra });

describe('selection-driven graph', () => {
  it('shows the company-level overview by default and nothing when blank', () => {
    const all = sel([]);
    expect(all.nodeIds.length).toBe(36);
    expect(all.edges.length).toBe(89);
    expect(sel([], { showAll: false }).nodeIds).toEqual([]);
  });
  it('draws one company with all its direct relationships, including project-level ones', () => {
    const v = sel(['CoreWeave']);
    expect(v.edges.length).toBe(17);
    expect(v.edges.every((e) => e.from === 'CoreWeave' || e.to === 'CoreWeave')).toBe(true);
    expect(v.nodeIds).toContain('C02 CoreWeave DDTL4.0');
  });
  it('overlays two companies, marks edges between them and their shared counterparties', () => {
    const v = sel(['NVIDIA', 'CoreWeave']);
    const between = r.graph.edges.filter((e) => v.between.includes(e.id));
    expect(between.length).toBeGreaterThan(0);
    expect(between.every((e) => [e.from, e.to].sort().join() === ['CoreWeave', 'NVIDIA'].sort().join())).toBe(true);
    expect(v.unlinkedPairs).toEqual([]);
    for (const id of v.shared) {
      const touches = (c: string) => v.edges.some((e) => (e.from === c && e.to === id) || (e.to === c && e.from === id));
      expect(touches('NVIDIA') && touches('CoreWeave')).toBe(true);
    }
  });
  it('flags pairs with no direct edge and no shared counterparty', () => {
    const v = sel(['MGX', 'Mistral']);
    expect(v.unlinkedPairs).toEqual([['MGX', 'Mistral']]);
  });
  it('does not add edges among counterparties', () => {
    const v = sel(['NVIDIA']);
    expect(v.edges.every((e) => e.from === 'NVIDIA' || e.to === 'NVIDIA')).toBe(true);
  });
  it('respects layer and October filters', () => {
    const v = sel(['CoreWeave'], { layers: ['financing'] });
    expect(v.edges.length).toBeGreaterThan(0);
    expect(v.edges.every((e) => e.layer === 'financing')).toBe(true);
  });
  it('toggles membership in click order', () => {
    expect(toggle(['A'], 'B')).toEqual(['A', 'B']);
    expect(toggle(['A', 'B'], 'A')).toEqual(['B']);
    expect(toggle(['A', 'B', 'C'], 'D')).toEqual(['A', 'B', 'C']); // fourth pick ignored
    expect(toggle(['A', 'B', 'C'], 'B')).toEqual(['A', 'C']);
  });
});

describe('URL state', () => {
  it('round-trips selection and blank mode, and caps the selection at three', () => {
    const s = { ...DEFAULT_SELECTION, selected: ['NVIDIA', 'CoreWeave'], showAll: false };
    expect(queryToSelection(selectionToQuery(s, 'x'), r)).toMatchObject({ selected: ['NVIDIA', 'CoreWeave'], showAll: false });
    expect(queryToSelection('?sel=NVIDIA|CoreWeave|OpenAI|Oracle', r).selected).toEqual(['NVIDIA', 'CoreWeave', 'OpenAI']);
  });
  it('keeps old single-node links working and drops unknown ids', () => {
    expect(queryToSelection('?node=CoreWeave', r).selected).toEqual(['CoreWeave']);
    expect(queryToSelection('?sel=CoreWeave|Nope', r).selected).toEqual(['CoreWeave']);
  });
});

describe('company categories', () => {
  it('puts every node in a category and the core companies in the expected ones', () => {
    const ids = new Set(CATEGORIES.map((c) => c.id));
    for (const n of r.graph.nodes) expect(ids.has(categoryOf(n))).toBe(true);
    expect(categoryOf({ id: 'OpenAI', kind: 'core' })).toBe('labs');
    expect(categoryOf({ id: 'CoreWeave', kind: 'core' })).toBe('neoclouds');
    expect(categoryOf({ id: 'Broadcom', kind: 'core' })).toBe('chips');
    expect(categoryOf({ id: 'Oracle', kind: 'core' })).toBe('hyperscalers');
    expect(categoryOf({ id: 'C02 CoreWeave DDTL4.0', kind: 'project' })).toBe('vehicles');
    expect(categoryOf({ id: '设备融资资金方（汇总）', kind: 'funding_category' })).toBe('capital');
  });
});

import { shortName, tickerize } from '../src/lib/tickers';
describe('ticker display names', () => {
  it('uses tickers for listed companies and substitutes them inside project labels', () => {
    expect(shortName({ id: 'NVIDIA', label_en: 'NVIDIA' })).toBe('NVDA');
    expect(shortName({ id: 'OpenAI', label_en: 'OpenAI' })).toBe('OpenAI');
    expect(shortName({ id: 'C02 CoreWeave DDTL4.0', label_en: 'CoreWeave · DDTL 4.0\n$8.5bn historical principal' })).toBe('CRWV · DDTL 4.0');
    expect(tickerize('Applied Digital · Polaris 1 B4')).toBe('APLD · Polaris 1 B4');
    expect(tickerize('Metaverse')).toBe('Metaverse'); // word boundaries only
  });
});
