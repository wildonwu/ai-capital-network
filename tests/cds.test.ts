import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error plain ESM build script without type declarations
import * as cds from '../scripts/cds-core.mjs';

const PAR: [number, number][] = [[1 / 12, 0.0403], [0.25, 0.0417], [0.5, 0.0419], [1, 0.0428], [2, 0.0446], [3, 0.0453], [5, 0.0459], [7, 0.047], [10, 0.0484], [20, 0.0527], [30, 0.0525]];
const df = cds.discountCurve(PAR);

describe('calendar conventions', () => {
  it('uses the previous adjusted IMM date for accrual and the semi-annual roll for 5Y', () => {
    expect(cds.accrualStart('2026-11-04')).toBe('2026-09-21'); // 20 Sep 2026 is a Sunday
    expect(cds.accrualStart('2026-09-19')).toBe('2026-09-21'); // T+1 lands on the IMM date
    expect(cds.onTheRun5y('2026-11-04')).toBe('2031-12-20');
    expect(cds.onTheRun5y('2026-09-19')).toBe('2031-06-20');
    expect(cds.onTheRun5y('2026-02-10')).toBe('2030-12-20');
  });
});

describe('ISDA standard model (flat hazard)', () => {
  const trade = '2026-11-04', maturity = '2031-12-20';
  const g = cds.grid({ trade, maturity, df });
  it('discount curve is sane', () => {
    expect(df(5)).toBeGreaterThan(0.78); expect(df(5)).toBeLessThan(0.81);
  });
  it('zero clean upfront means the conventional spread equals the coupon', () => {
    expect(cds.conventionalSpread({ trade, maturity, coupon: 0.05, points: 0, df, g }).spread).toBeCloseTo(0.05, 5); // within 0.1 bp (settlement-date discounting)
  });
  it('round-trips hazard → points → hazard and tracks the credit-triangle approximation', () => {
    for (const h of [0.03, 0.1, 0.2, 0.4]) {
      const pts = cds.pointsFromHazard(g, h, 0.05);
      const r = cds.conventionalSpread({ trade, maturity, coupon: 0.05, points: pts, df, g });
      expect(r.hazard).toBeCloseTo(h, 6);
      expect(r.spread / (h * (1 - cds.RECOVERY))).toBeGreaterThan(0.97);
      expect(r.spread / (h * (1 - cds.RECOVERY))).toBeLessThan(1.03);
    }
  });
  it('higher upfront means a wider spread', () => {
    const a = cds.conventionalSpread({ trade, maturity, coupon: 0.05, points: 0.1, df, g }).spread;
    const b = cds.conventionalSpread({ trade, maturity, coupon: 0.05, points: 0.2, df, g }).spread;
    expect(b).toBeGreaterThan(a);
  });
});

describe('DTCC parsing and lifecycle', () => {
  it('parses quoted CSV fields', () => {
    const rows = cds.parseCsv('a,b,c\n"x,1","he said ""hi""",3\n');
    expect(rows).toEqual([{ a: 'x,1', b: 'he said "hi"', c: '3' }]);
  });
  it('reads a deflated single-file zip', () => {
    const body = Buffer.from('h1,h2\n1,2\n');
    const comp = zlib.deflateRawSync(body);
    const name = Buffer.from('f.csv');
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(body.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0, 42);
    const cdOffset = local.length + name.length + comp.length;
    const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(central.length + name.length, 12); eocd.writeUInt32LE(cdOffset, 16);
    const zip = Buffer.concat([local, name, comp, central, name, eocd]);
    expect(cds.unzip(zip)['f.csv'].toString()).toBe('h1,h2\n1,2\n');
  });
  const row = (o: Record<string, string>) => ({ 'UPI FISN': 'NA/CDS Corp SN Sr', 'Underlying Asset Name': 'COREWEAVE;INC.', 'Execution Timestamp': '2026-11-04T15:00:00Z', 'Expiration Date': '2031-12-20', 'Fixed rate-Leg 1': '0.05', 'Notional amount-Leg 1': '2,000,000', 'Other payment amount': '370000', 'Other payment type': 'UFRO', 'Original Dissemination Identifier': '', ...o });
  it('selects senior trades on the entity and flags capped notionals', () => {
    const t = cds.selectTrades([row({ 'Dissemination Identifier': '1', 'Action type': 'NEWT' }), row({ 'Dissemination Identifier': '2', 'Action type': 'NEWT', 'Notional amount-Leg 1': '5,000,000+' }), row({ 'Dissemination Identifier': '3', 'Action type': 'NEWT', 'UPI FISN': 'NA/CDS Corp SN' })], 'coreweave');
    expect(t.map((x: { id: string }) => x.id)).toEqual(['1', '2']);
    expect(t[1].capped).toBe(true); expect(t[1].notional).toBeNull();
    expect(t[0].trade).toBe('2026-11-04');
  });
  it('applies corrections and cancellations, and ignores lifecycle modifications as prices', () => {
    const t = cds.selectTrades([
      row({ 'Dissemination Identifier': '1', 'Action type': 'NEWT' }),
      row({ 'Dissemination Identifier': '2', 'Action type': 'NEWT' }),
      row({ 'Dissemination Identifier': '3', 'Action type': 'NEWT' }),
      row({ 'Dissemination Identifier': '9', 'Action type': 'CORR', 'Original Dissemination Identifier': '1', 'Other payment amount': '380000' }),
      row({ 'Dissemination Identifier': '10', 'Action type': 'EROR', 'Original Dissemination Identifier': '2' }),
      row({ 'Dissemination Identifier': '11', 'Action type': 'MODI', 'Original Dissemination Identifier': '3', 'Other payment amount': '1' }),
    ], 'coreweave');
    const store = cds.applyLifecycle({}, t);
    expect(Object.keys(store).sort()).toEqual(['1', '3']);
    expect(store['1'].upfront).toBe(380000);
    expect(store['3'].upfront).toBe(370000);
    expect(store['3'].modified).toBe(true);
  });
  it('builds a daily median from priced on-the-run trades only', () => {
    const t = cds.selectTrades([
      row({ 'Dissemination Identifier': '1', 'Action type': 'NEWT' }),
      row({ 'Dissemination Identifier': '2', 'Action type': 'NEWT', 'Notional amount-Leg 1': '5,000,000+' }),
      row({ 'Dissemination Identifier': '3', 'Action type': 'NEWT', 'Expiration Date': '2028-12-20' }),
    ], 'coreweave');
    const s = cds.dailySeries(cds.applyLifecycle({}, t), { '2026-11-04': PAR });
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ date: '2026-11-04', priced: 1, trades: 2, capped: 1 });
    expect(s[0].points_pct).toBeCloseTo(19.13, 1); // 18.5 cash + 44 days of 5% accrued
    expect(s[0].spread_bp).toBeGreaterThan(1050); expect(s[0].spread_bp).toBeLessThan(1250);
  });
});

describe('committed CDS snapshot', () => {
  const snap = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../public/data/market/companies.json'), 'utf8'));
  it('agrees with a news-reported Markit level within 3% where dates overlap', () => {
    const s = snap.companies.CoreWeave.cds.series as { date: string; spread_bp: number }[];
    const d = s.find((x) => x.date === '2026-10-27');
    expect(d).toBeTruthy();
    expect(Math.abs(d!.spread_bp / 1041.4 - 1)).toBeLessThan(0.03);
  });
});

describe('tenor curve, capped-notional inference and inversion', () => {
  const base = { coupon: 0.05, upfrontType: 'UFRO', ts: '2026-11-05T15:00:00Z' };
  it('buckets tenors with 5Y as the on-the-run contract', () => {
    expect(cds.tenorOf({ trade: '2026-11-05', maturity: '2031-12-20' })).toBe('5Y');
    expect(cds.tenorOf({ trade: '2026-11-05', maturity: '2031-06-20' })).toBe('4Y'); // previous 5Y after the roll
    expect(cds.tenorOf({ trade: '2026-11-05', maturity: '2029-12-20' })).toBe('3Y');
    expect(cds.tenorOf({ trade: '2026-11-05', maturity: '2027-12-20' })).toBe('1Y');
  });
  it('infers a capped notional only when one candidate fits the grid and the recent level', () => {
    const t = { ...base, trade: '2026-11-05', maturity: '2031-12-20', upfront: 1068055.555 };
    expect(cds.inferNotional(t, 0.20)).toMatchObject({ notional: 5e6 });
    expect(cds.inferNotional(t, 0.20)!.points).toBeCloseTo(0.22, 6);
    expect(cds.inferNotional(t, 0.125)).toBeNull(); // 22 points is too far from a 12.5-point reference
    expect(cds.inferNotional(t, null)).toBeNull(); // no reference, no guess
  });
  it('skips weekends and SIFMA holidays', () => {
    expect(cds.businessDays('2026-11-06', '2026-11-12')).toEqual(['2026-11-06', '2026-11-09', '2026-11-10', '2026-11-12']);
  });
  it('carries the last value forward and marks inferred days', () => {
    const store = {
      a: { ...base, id: 'a', trade: '2026-11-04', ts: '2026-11-04T15:00:00Z', maturity: '2031-12-20', notional: 2e6, upfront: 370000 },
      b: { ...base, id: 'b', trade: '2026-11-06', ts: '2026-11-06T15:00:00Z', maturity: '2031-12-20', notional: null, capped: true, upfront: 1042361.11 },
    };
    const { tenors, inferredCount } = cds.curveSeries(store, { '2026-11-04': PAR }, '2026-11-09');
    expect(inferredCount).toBe(1);
    expect(tenors['5Y'].map((p: { date: string; status: string }) => [p.date, p.status])).toEqual([
      ['2026-11-04', 'observed'], ['2026-11-05', 'carried'], ['2026-11-06', 'inferred'], ['2026-11-09', 'carried'],
    ]);
    expect(tenors['5Y'][1].spread_bp).toBe(tenors['5Y'][0].spread_bp);
    expect(tenors['5Y'][2].points_pct).toBeCloseTo(21.5, 2);
  });
  it('needs the short tenor on at least two days before calling an inversion', () => {
    const day = (date: string, v: number, status = 'observed') => ({ date, spread_bp: v, points_pct: 0, status, priced: 1 });
    const five = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'].map((d) => day(d, 1100));
    const oneDay = { '5Y': five, '3Y': [day('2026-11-05', 1300), day('2026-11-06', 1300, 'carried')] };
    expect(cds.inversionHistory(oneDay).at(-1).inverted).toBe(false);
    const twoDays = { '5Y': five, '3Y': [day('2026-11-04', 1250), day('2026-11-05', 1300)] };
    const h = cds.inversionHistory(twoDays);
    expect(h.at(-1)).toMatchObject({ inverted: true, short: [{ tenor: '3Y', days: 2 }] });
    // On 11-04 the window holds only one 3Y day, so the inversion starts on 11-05.
    expect(cds.inversionAlert(h)).toMatchObject({ active: true, since: '2026-11-05', five_bp: 1100 });
    expect(cds.inversionPeriods(h)).toEqual([{ from: '2026-11-05', to: '2026-11-06' }]);
  });
});
