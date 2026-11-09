import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadRelease } from '../src/lib/data';
import type { Release } from '../src/lib/types';
import { exposure, isConditional, OVERLAPS } from '../src/lib/exposure';

const base = path.resolve(__dirname, '../public/data');
let r: Release;
beforeAll(async () => { r = await loadRelease(async (p) => fs.readFileSync(path.join(base, p), 'utf8')); });

describe('company exposure', () => {
  it('puts CoreWeave debt and equity raised under money in, and does not add the DDTLs on top of book debt', () => {
    const x = exposure(r, 'CoreWeave');
    expect(x.projects).toEqual(expect.arrayContaining(['C01 CoreWeave DDTL3.0', 'C04 CoreWeave DDTL5.5']));
    const mi = x.sides.money.in;
    // R201 35.068 + R202 3.7 + R034 2 + R013 0.35; the four DDTL facilities (16.8) are inside R201
    expect(mi.firm).toBeCloseTo(41.118, 3);
    const ddtl = mi.rows.filter((row) => row.via);
    expect(ddtl).toHaveLength(4);
    expect(ddtl.every((row) => row.within === 'R201')).toBe(true);
  });
  it('splits customer contracts (sold) from purchases (bought), firm from conditional', () => {
    const x = exposure(r, 'CoreWeave');
    expect(x.sides.goods.in.firm).toBeCloseTo(57.6, 3); // OpenAI 22.4 + Meta 35.2, contracted
    expect(x.sides.goods.in.conditional).toBeCloseTo(6.3, 3); // NVIDIA conditional capacity purchase
    expect(x.sides.goods.out.rows.map((row) => row.other)).toContain('NVIDIA'); // CoreWeave buys GPUs, amount undisclosed
    expect(x.sides.goods.out.uncounted).toBeGreaterThan(0);
  });
  it('counts an instrument shown on both sides once', () => {
    const a = exposure(r, 'Anthropic');
    const funding = a.sides.money.in.rows.find((row) => row.e.id === 'R025')!;
    expect(funding.within).toBe('R024');
  });
  it('only drops a contained record when its container is in the same block', () => {
    const nv = exposure(r, 'NVIDIA'); // R027 (NVIDIA → Meta) without R196 in NVIDIA's block
    expect(nv.sides.money.out.rows.find((row) => row.e.id === 'R027')?.within).toBeNull();
  });
  it('knows which statuses are conditional and points overlaps at real records', () => {
    expect(isConditional('conditional_capacity_purchase')).toBe(true);
    expect(isConditional('announced_not_settled')).toBe(true);
    expect(isConditional('contracted')).toBe(false);
    expect(isConditional('historical_face_or_commitment_balance_unknown')).toBe(false);
    const ids = new Set(r.graph.edges.map((e) => e.id));
    for (const [k, v] of Object.entries(OVERLAPS)) { expect(ids.has(k)).toBe(true); expect(ids.has(v.within)).toBe(true); }
  });
});
