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
