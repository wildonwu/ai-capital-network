import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error plain ESM build script without type declarations
import { quarterlySeries, instantSeries, maturitySchedule, priceFromYahoo, keepOrStale, validateMarket, contentKey, buildCompany } from '../scripts/market-core.mjs';
import { loadMarket, usdShort, quarterLabel, manualValue } from '../src/lib/market';

const fact = (start: string | undefined, end: string, val: number, filed = '2026-08-12') => ({ start, end, val, filed, form: '10-Q' });

describe('SEC fact normalisation', () => {
  it('derives single quarters from year-to-date cash flows', () => {
    const q = quarterlySeries([
      fact('2026-01-01', '2026-03-31', 2980), fact('2026-01-01', '2026-06-30', 3663),
      fact('2025-01-01', '2025-09-30', 1250), fact('2025-01-01', '2025-12-31', 2810, '2026-03-02'), fact('2025-01-01', '2025-06-30', -440),
    ]);
    expect(q.map((x: { end: string; value: number }) => [x.end, x.value])).toEqual([
      ['2025-09-30', 1690], ['2025-12-31', 1560], ['2026-03-31', 2980], ['2026-06-30', 683],
    ]);
  });
  it('prefers a directly reported quarter over a derived one', () => {
    const q = quarterlySeries([fact('2026-04-01', '2026-06-30', 2575), fact('2026-01-01', '2026-06-30', 4653), fact('2026-01-01', '2026-03-31', 2000)]);
    expect(q.find((x: { end: string }) => x.end === '2026-06-30')).toEqual({ end: '2026-06-30', value: 2575, derived: false });
  });
  it('keeps the most recently filed value for a restated instant', () => {
    expect(instantSeries([fact(undefined, '2025-06-30', 1152883000, '2025-08-14'), fact(undefined, '2025-06-30', 1153000000, '2026-08-12')])).toEqual([{ end: '2025-06-30', value: 1153000000 }]);
  });
  it('places maturities by calendar year and derives the remainder', () => {
    const cf = { facts: { 'us-gaap': {
      LongTermDebtMaturitiesRepaymentsOfPrincipalRemainderOfFiscalYear: { units: { USD: [fact(undefined, '2026-06-30', 4413)] } },
      LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths: { units: { USD: [fact(undefined, '2026-06-30', 6184)] } },
      LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo: { units: { USD: [fact(undefined, '2026-06-30', 4416)] } },
    } } };
    const m = maturitySchedule(cf, [{ end: '2026-06-30', value: 20000 }]);
    expect(m.buckets).toEqual([
      { year: '2026', value: 4413, derived: false }, { year: '2027', value: 6184, derived: false },
      { year: '2028', value: 4416, derived: false }, { year: 'after 2028', value: 4987, derived: true },
    ]);
  });
});

describe('price and staleness', () => {
  const chart = { chart: { result: [{ meta: { currency: 'USD' }, timestamp: [1793653200, 1793739600, 1793826000], indicators: { quote: [{ close: [55, null, 48.42] }] } }] } };
  it('skips null closes and computes change against the previous session', () => {
    const p = priceFromYahoo(chart, 'now');
    expect(p.history.length).toBe(2);
    expect(p.last.close).toBe(48.42);
    expect(p.change_pct).toBeCloseTo(-11.96, 2);
  });
  it('keeps the last good block, marked stale, when a fetch fails', () => {
    expect(keepOrStale(null, { status: 'ok', last: { close: 1 } })).toEqual({ status: 'stale', last: { close: 1 } });
    expect(keepOrStale(null, undefined)).toEqual({ status: 'missing' });
  });
  it('ignores fetch timestamps when comparing snapshots', () => {
    expect(contentKey({ generated_at: 'a', x: { fetched_at: 'a', v: 1 } })).toBe(contentKey({ generated_at: 'b', x: { fetched_at: 'b', v: 1 } }));
  });
});

describe('committed snapshot and manual inputs', () => {
  const snap = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../public/data/market/companies.json'), 'utf8'));
  it('passes validation and covers every manual company file', () => {
    expect(validateMarket(snap)).toEqual([]);
    const dir = path.resolve(__dirname, '../data/companies');
    for (const f of fs.readdirSync(dir)) {
      const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      expect(snap.companies[m.node_id]).toBeTruthy();
    }
  });
  it('every manual company maps to a node in the release graph', () => {
    const latest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../public/data/latest.json'), 'utf8'));
    const graph = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../public/data', latest.manifest.replace('manifest.json', 'graph.json')), 'utf8'));
    const ids = new Set(graph.nodes.map((n: { id: string }) => n.id));
    for (const id of Object.keys(snap.companies)) expect(ids.has(id)).toBe(true);
  });
  it('rejects manual points without an https source', () => {
    const bad = { schema: 'acn-market-1', companies: { X: buildCompany({ node_id: 'X', manual_series: { s: { unit: 'bp', points: [{ date: '2026-10-27', value: 1, source: '' }] } } }, { financials: null, price: null }) } };
    expect(validateMarket(bad)).toContain('X: manual s point lacks https source');
  });
  it('loads through the optional loader and returns null on a bad file', async () => {
    const ok = await loadMarket(async () => JSON.stringify(snap));
    expect(ok?.companies.CoreWeave.ticker).toBe('CRWV');
    expect(await loadMarket(async () => { throw new Error('404'); })).toBeNull();
    expect(await loadMarket(async () => '{"schema":"other"}')).toBeNull();
  });
});

describe('formatting', () => {
  it('formats amounts and labels', () => {
    expect(usdShort(5524000000)).toBe('$5.52bn');
    expect(usdShort(-5740000000)).toBe('−$5.74bn');
    expect(usdShort(103700000000)).toBe('$104bn');
    expect(usdShort(null)).toBe('—');
    expect(quarterLabel('2026-06-30')).toBe('Q2 2026');
    expect(manualValue({ label: '', unit: 'MW', points: [] }, 1500)).toBe('1.5 GW');
    expect(manualValue({ label: '', unit: 'bp', points: [] }, 1041.4)).toBe('1,041.4 bp');
  });
});
