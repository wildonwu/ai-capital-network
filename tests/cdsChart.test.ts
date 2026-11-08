import { describe, it, expect } from 'vitest';
import { weekly, windowFor } from '../src/lib/cdsChart';

const dates = ['2025-10-01', '2026-01-02', '2026-05-04', '2026-05-08', '2026-11-02', '2026-11-04', '2026-11-06'];
describe('CDS chart helpers', () => {
  it('maps range buttons to session windows ending at the latest session', () => {
    expect(windowFor('All', dates)).toEqual([0, 6]);
    expect(windowFor('YTD', dates)).toEqual([1, 6]);
    expect(windowFor('6M', dates)).toEqual([3, 6]); // 6 months before 2026-11-06 is 05-06; first session 05-08
    expect(windowFor('1Y', dates)).toEqual([1, 6]); // 2025-10-01 is more than a year before 2026-11-06
  });
  it('samples each week at its last session', () => {
    expect(weekly(dates)).toEqual(['2025-10-01', '2026-01-02', '2026-05-08', '2026-11-06']);
    expect(weekly(['2026-11-06'], true)).toEqual(['2026-11-02']);
  });
});
