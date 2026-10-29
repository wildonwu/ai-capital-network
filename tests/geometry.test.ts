import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MODEL_SCALE, bandLabels, readableLines, routeEdge, unbundledControl, type Pt } from '../src/lib/geometry';
import { loadRelease } from '../src/lib/data';
import { mechanismCards, qualifiedAmount } from '../src/lib/mechanisms';

const root = path.resolve(import.meta.dirname, '..');

/** Cytoscape's unbundled-bezier control point when edge-distances is "endpoints". */
function cytoscapeControl(start: Pt, end: Pt, weight: number, distance: number): Pt {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const l = Math.hypot(dx, dy);
  const base = { x: start.x * (1 - weight) + end.x * weight, y: start.y * (1 - weight) + end.y * weight };
  return { x: base.x + (-dy / l) * distance, y: base.y + (dx / l) * distance };
}

function readJson(rel: string) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}

describe('manifest quadratic routes', () => {
  for (const viewName of ['companies-network', 'full-network']) {
    it(`reproduces ${viewName} control points for cytoscape unbundled-bezier`, () => {
      const view = readJson(`data/seed/${viewName}.view.json`);
      let worst = 0;
      let worstId = '';
      for (const [id, edge] of Object.entries(view.edges) as [string, { from: string; to: string; start: [number, number]; control: [number, number]; end: [number, number] }][]) {
        const start = { x: edge.start[0] * MODEL_SCALE, y: edge.start[1] * MODEL_SCALE };
        const end = { x: edge.end[0] * MODEL_SCALE, y: edge.end[1] * MODEL_SCALE };
        const control = { x: edge.control[0] * MODEL_SCALE, y: edge.control[1] * MODEL_SCALE };
        const routed = routeEdge(view.nodes[edge.from].box, view.nodes[edge.to].box, edge);
        const back = cytoscapeControl(start, end, routed.cpw, routed.cpd);
        const err = Math.hypot(back.x - control.x, back.y - control.y);
        if (err > worst) { worst = err; worstId = id; }
        const from = view.nodes[edge.from].box as number[];
        const to = view.nodes[edge.to].box as number[];
        const [sx, sy] = routed.sep.split(' ').map((v) => parseFloat(v));
        const [tx, ty] = routed.tep.split(' ').map((v) => parseFloat(v));
        expect(Math.hypot(from[0] * MODEL_SCALE + sx - start.x, from[1] * MODEL_SCALE + sy - start.y), `${id} start`).toBeLessThan(0.02);
        expect(Math.hypot(to[0] * MODEL_SCALE + tx - end.x, to[1] * MODEL_SCALE + ty - end.y), `${id} end`).toBeLessThan(0.02);
      }
      expect(worst, worstId).toBeLessThan(1e-6);
      expect(unbundledControl({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 0 }).weight).toBe(0.5);
    });
  }
});

describe('band headers and readable project labels', () => {
  const kinds = new Map<string, string>(readJson('data/seed/snapshot.public.json').nodes.map((n: { id: string; kind: string }) => [n.id, n.kind]));
  function labels(viewName: string) {
    const view = readJson(`data/seed/${viewName}.view.json`);
    return bandLabels((view.node_ids as string[]).map((id) => ({ id, kind: kinds.get(id) ?? 'company', box: view.nodes[id].box })));
  }
  it('names the editorial rows on the company view', () => {
    const titles = labels('companies-network').map((b) => b.title);
    expect(titles).toEqual([
      'Capital providers & financing channels',
      'Chips',
      'Model developers',
      'Cloud & capacity',
      'Operators & financing vehicles',
    ]);
  });
  it('adds project-site headers on the full network', () => {
    const titles = labels('full-network').map((b) => b.title);
    expect(titles).toContain('Project sites');
    expect(titles.filter((t) => t === 'Project sites')).toHaveLength(2);
    expect(titles).toContain('Chips');
    expect(titles).toContain('Cloud & capacity');
  });
  it('keeps the manifest amount token and does not invent a zero', () => {
    const lines = readableLines('Vantage · Frontier, Texas\n$23bn historical principal / facility');
    expect(lines).toEqual(['Vantage · Frontier, Texas', '$23bn facility']);
    expect(lines.join(' ')).not.toMatch(/\b0\b/);
    expect(readableLines('Anthropic demand\n(attribution unconfirmed)')).toEqual(['Anthropic demand', 'attribution unconfirmed']);
  });
});

describe('mechanism cards from release records', () => {
  const base = path.resolve(import.meta.dirname, '../public/data');
  const fetcher = async (p: string) => fs.readFileSync(path.join(base, p), 'utf8');
  it('reads headline amounts and qualifiers from the cited edges', async () => {
    const r = await loadRelease(fetcher);
    const cards = mechanismCards(r);
    expect(cards.map((c) => c.kicker)).toEqual(['Investor → customer', 'Credit support → equity', 'Capital → equipment → lease']);
    expect(cards[0].headline.id).toBe('R003');
    expect(cards[0].headline.amount.numeric).toBe(50);
    expect(cards[0].headline.amount.unit).toBe('USD bn');
    expect(cards[0].headline.amount.qualifier).toBe('reported paid');
    expect(cards[0].supporting[0].id).toBe('R004');
    expect(cards[0].supporting[0].amount.numeric).toBe(138);
    expect(cards[1].headline.amount.numeric).toBe(3.2);
    expect(cards[1].supporting[0].amount.text).toMatch(/14/);
    expect(cards[1].supporting[0].amount.qualifier).toBe('conditional right');
    expect(cards[2].headline.id).toBe('R191');
    expect(cards[2].headline.amount.numeric).toBe(63);
    const hidden = cards[2].supporting.find((l) => l.id === 'R192')!;
    expect(hidden.amount.disclosed).toBe(false);
    expect(hidden.amount.numeric).toBeNull();
    expect(hidden.amount.text).toBe('Not disclosed');
    expect(hidden.amount.text).not.toMatch(/\b0\b/);
    expect(qualifiedAmount({ amount: null, unit: 'USD bn', status: 'future_delivery' }).text).toBe('Not disclosed');
  });
});
