import { describe, it, expect } from 'vitest';
import { deliveryFor, validateDelivery, quarterDomain, quarterTicks, timeScale, keyEvent, type Delivery } from '../src/lib/delivery';

describe('delivery timelines', () => {
  it('loads a valid CoreWeave file and nothing for other companies', () => {
    const d = deliveryFor('CoreWeave');
    expect(d).not.toBeNull();
    expect(validateDelivery(d!)).toEqual([]);
    expect(d!.sites).toHaveLength(12);
    expect(d!.company.length).toBeGreaterThanOrEqual(16);
    expect(deliveryFor('Oracle')).toBeNull();
  });
  it('gives every pending site one key event', () => {
    const d = deliveryFor('CoreWeave')!;
    for (const s of d.sites) expect(s.events.some((e) => e.key), s.id).toBe(true);
  });
  it('rejects malformed dates and reversed windows', () => {
    const d = structuredClone(deliveryFor('CoreWeave')!) as Delivery;
    d.company[0].start = '2026/11/20';
    d.sites[0].events[0].end = '2000-01-01';
    expect(validateDelivery(d).length).toBe(2);
  });
  it('snaps the axis to whole quarters and ticks each quarter', () => {
    const dom = quarterDomain('2026-11-12', '2028-02-10');
    expect(dom).toEqual(['2026-10-01', '2028-03-31']);
    expect(quarterTicks(dom).map((t) => t.label)).toEqual(['Q4 2026', '2027', 'Q2', 'Q3', 'Q4', '2028']);
  });
  it('maps dates linearly and clamps outside the domain', () => {
    const x = timeScale(['2027-01-01', '2028-01-01'], 0, 365);
    expect(x('2027-01-01')).toBe(0);
    expect(x('2027-07-02')).toBeCloseTo(182, 0);
    expect(x('2030-01-01')).toBe(365);
  });
  it('picks the next pending key event after the cut-off', () => {
    const d = deliveryFor('CoreWeave')!;
    expect(keyEvent(d.sites.find((s) => s.id === 'helios')!, d.as_of)?.date).toBe('2027-06-30');
    expect(keyEvent(d.sites.find((s) => s.id === 'hammond')!, d.as_of)?.date).toBe('2026-06-30');
  });
});
