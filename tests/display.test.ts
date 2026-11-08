import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadRelease } from '../src/lib/data';
import type { Release } from '../src/lib/types';
import { DEFAULT_SELECTION, visibleGraph } from '../src/lib/selection';
import { amountLabel, displayGraph, projectParents } from '../src/lib/display';
import { egoLayout, tierLayout } from '../src/lib/layouts';
import { shortName } from '../src/lib/tickers';

let r: Release;
beforeAll(async () => { r = await loadRelease(async (p) => fs.readFileSync(path.join(path.resolve(__dirname, '../public/data'), p), 'utf8')); });
const label = (id: string) => shortName(r.graph.nodes.find((n) => n.id === id), id);

describe('display graph', () => {
  it('labels amounts compactly and leaves undisclosed ones blank', () => {
    expect(amountLabel({ amount: 22.4, unit: 'USD bn' })).toBe('$22.4bn');
    expect(amountLabel({ amount: 14, unit: 'percent proforma' })).toBe('14%');
    expect(amountLabel({ amount: null, unit: '' })).toBe('');
  });
  it('finds each project parent through its affiliation edge', () => {
    expect(projectParents(r).get('C02 CoreWeave DDTL4.0')).toBe('CoreWeave');
  });
  it('merges a company\'s projects into one box until expanded', () => {
    const vis = visibleGraph(r, { ...DEFAULT_SELECTION, selected: ['CoreWeave'] });
    const g = displayGraph(r, vis, label, new Set(), ['CoreWeave']);
    const combo = g.nodes.find((n) => n.id === 'combo:CoreWeave');
    expect(combo?.combo?.members.length).toBeGreaterThanOrEqual(4);
    expect(g.nodes.some((n) => n.id === 'C02 CoreWeave DDTL4.0')).toBe(false);
    const merged = g.edges.find((e) => e.source === 'CoreWeave' && e.target === 'combo:CoreWeave');
    expect(merged?.count).toBeGreaterThanOrEqual(4);
    const open = displayGraph(r, vis, label, new Set(['CoreWeave']), ['CoreWeave']);
    expect(open.nodes.some((n) => n.id === 'C02 CoreWeave DDTL4.0')).toBe(true);
  });
  it('never merges in the fixed layout, even when the parent is off screen', () => {
    const sel = ['NVIDIA', 'CoreWeave'];
    const vis = visibleGraph(r, { ...DEFAULT_SELECTION, selected: sel });
    const g = displayGraph(r, vis, label, new Set(), sel, false);
    expect(g.nodes.some((n) => n.id.startsWith('combo:'))).toBe(false);
    expect(g.nodes.length).toBe(vis.nodeIds.length);
  });
});

describe('deterministic layouts', () => {
  const overlap = (pl: ReturnType<typeof tierLayout>) => {
    const ids = [...pl.pos.keys()];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = pl.pos.get(ids[i])!, b = pl.pos.get(ids[j])!, sa = pl.size.get(ids[i])!, sb = pl.size.get(ids[j])!;
      if (Math.abs(a.x - b.x) < (sa.w + sb.w) / 2 && Math.abs(a.y - b.y) < (sa.h + sb.h) / 2) return [ids[i], ids[j]];
    }
    return null;
  };
  it('places every node without overlaps in both column layouts', () => {
    for (const sel of [['NVIDIA'], ['NVIDIA', 'CoreWeave'], ['Anthropic']]) {
      const vis = visibleGraph(r, { ...DEFAULT_SELECTION, selected: sel });
      const g = displayGraph(r, vis, label, new Set(), sel);
      const lab = (n: { lines: string[] }) => n.lines[0];
      for (const pl of [tierLayout(g, sel, lab), egoLayout(g, sel, new Set(), lab)]) {
        expect(pl.pos.size).toBe(g.nodes.length);
        expect(overlap(pl)).toBeNull();
      }
    }
  });
  it('orders tier bands top to bottom by category', () => {
    const sel = ['NVIDIA', 'CoreWeave'];
    const g = displayGraph(r, visibleGraph(r, { ...DEFAULT_SELECTION, selected: sel }), label, new Set(), sel);
    const pl = tierLayout(g, sel, (n) => n.lines[0]);
    expect(pl.pos.get('OpenAI')!.y).toBeLessThan(pl.pos.get('NVIDIA')!.y);
    expect(pl.pos.get('NVIDIA')!.y).toBeLessThan(pl.pos.get('CoreWeave')!.y);
  });
});
