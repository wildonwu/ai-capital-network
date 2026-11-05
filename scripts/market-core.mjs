// Pure functions for the company market/financial snapshot. No I/O here, so tests can exercise them directly.

export const MARKET_SCHEMA = 'acn-market-1';

const DAY = 86400000;
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/** Keep one fact per key, preferring the most recently filed (later filings restate earlier ones). */
function latestFiled(facts, keyFn) {
  const out = new Map();
  for (const f of facts) {
    const k = keyFn(f);
    const prev = out.get(k);
    if (!prev || (f.filed ?? '') > (prev.filed ?? '')) out.set(k, f);
  }
  return [...out.values()];
}

/** Point-in-time concept (cash, debt, RPO): one value per period end. */
export function instantSeries(facts) {
  return latestFiled(facts ?? [], (f) => f.end)
    .map((f) => ({ end: f.end, value: f.val }))
    .sort((a, b) => a.end.localeCompare(b.end));
}

/**
 * Flow concept (revenue, cash flow) to single-quarter values.
 * 10-Qs report cash flows year-to-date, so a quarter is derived as YTD(end) − YTD(previous quarter end)
 * when both share the same fiscal-year start. Directly reported ~3-month values win over derived ones.
 */
export function quarterlySeries(facts) {
  const uniq = latestFiled((facts ?? []).filter((f) => f.start), (f) => `${f.start}|${f.end}`);
  const q = new Map();
  for (const f of uniq) {
    const d = days(f.start, f.end);
    if (d >= 80 && d <= 100) q.set(f.end, { end: f.end, value: f.val, derived: false });
  }
  for (const b of uniq) {
    if (days(b.start, b.end) <= 100 || q.has(b.end)) continue;
    const a = uniq.find((x) => x.start === b.start && days(x.end, b.end) >= 80 && days(x.end, b.end) <= 100);
    if (a) q.set(b.end, { end: b.end, value: b.val - a.val, derived: true });
  }
  return [...q.values()].sort((a, b) => a.end.localeCompare(b.end));
}

const usd = (cf, concept) => cf?.facts?.['us-gaap']?.[concept]?.units?.USD;

// Principal due by calendar year. Filers tag the schedule inconsistently (CoreWeave tags the first full
// calendar year as "NextTwelveMonths" in its 10-Qs), so buckets are placed by offset from the as-of year
// and the remainder beyond the listed years is derived as total principal minus the listed buckets.
const MATURITY_CONCEPTS = [
  [0, 'LongTermDebtMaturitiesRepaymentsOfPrincipalRemainderOfFiscalYear'],
  [1, 'LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths'],
  [2, 'LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo'],
  [3, 'LongTermDebtMaturitiesRepaymentsOfPrincipalInYearThree'],
  [4, 'LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFour'],
  [5, 'LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFive'],
];

export function maturitySchedule(cf, totalSeries) {
  const series = MATURITY_CONCEPTS.map(([off, c]) => [off, instantSeries(usd(cf, c))]);
  const asOf = series.map(([, v]) => v.at(-1)?.end).filter(Boolean).sort().at(-1);
  if (!asOf) return null;
  const y = Number(asOf.slice(0, 4));
  const buckets = [];
  for (const [off, v] of series) {
    const hit = v.find((x) => x.end === asOf);
    if (hit) buckets.push({ year: String(y + off), value: hit.value, derived: false });
  }
  const total = totalSeries.find((x) => x.end === asOf)?.value ?? null;
  const listed = buckets.reduce((s, b) => s + b.value, 0);
  if (total !== null && total - listed > 0) buckets.push({ year: `after ${buckets.at(-1)?.year ?? y}`, value: total - listed, derived: true });
  return { as_of: asOf, total, buckets };
}

/** Build the financial block from SEC companyfacts JSON. Returns null when nothing usable is present. */
export function financialsFromCompanyFacts(cf, fetchedAt) {
  const s = {
    revenue: quarterlySeries(usd(cf, 'RevenueFromContractWithCustomerExcludingAssessedTax')),
    net_income: quarterlySeries(usd(cf, 'NetIncomeLoss')),
    operating_cash_flow: quarterlySeries(usd(cf, 'NetCashProvidedByUsedInOperatingActivities')),
    capex: quarterlySeries(usd(cf, 'PaymentsToAcquirePropertyPlantAndEquipment')),
    interest_expense: quarterlySeries(usd(cf, 'InterestExpenseDebt')),
    cash: instantSeries(usd(cf, 'CashAndCashEquivalentsAtCarryingValue')),
    debt_principal: instantSeries(usd(cf, 'DebtInstrumentCarryingAmount')),
    rpo: instantSeries(usd(cf, 'RevenueRemainingPerformanceObligation')),
  };
  const capex = new Map(s.capex.map((x) => [x.end, x.value]));
  s.free_cash_flow = s.operating_cash_flow.filter((x) => capex.has(x.end))
    .map((x) => ({ end: x.end, value: x.value - capex.get(x.end), derived: true }));
  if (!s.revenue.length && !s.cash.length) return null;

  const maturities = maturitySchedule(cf, s.debt_principal);

  const all = Object.values(cf?.facts?.['us-gaap'] ?? {}).flatMap((c) => c.units?.USD ?? []);
  const latest = all.filter((f) => f.form === '10-Q' || f.form === '10-K').sort((a, b) => (a.filed ?? '').localeCompare(b.filed ?? '')).at(-1);
  // Keep the last 8 quarters: enough for a trend without bloating the file.
  for (const k of Object.keys(s)) s[k] = s[k].slice(-8);
  return {
    status: 'ok', fetched_at: fetchedAt, source: 'SEC XBRL companyfacts (data.sec.gov)',
    latest_filing: latest ? { form: latest.form, filed: latest.filed, period_end: latest.end } : null,
    series: s, maturities,
  };
}

/** Build the price block from a Yahoo chart response (unofficial endpoint). */
export function priceFromYahoo(chart, fetchedAt) {
  const r = chart?.chart?.result?.[0];
  if (!r?.timestamp?.length) return null;
  const closes = r.indicators?.quote?.[0]?.close ?? [];
  const history = r.timestamp.map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: closes[i] }))
    .filter((p) => typeof p.close === 'number' && Number.isFinite(p.close))
    .map((p) => ({ date: p.date, close: Math.round(p.close * 100) / 100 }));
  if (history.length < 2) return null;
  const last = history.at(-1), prev = history.at(-2);
  const year = history.map((p) => p.close);
  return {
    status: 'ok', fetched_at: fetchedAt, source: 'Yahoo Finance chart endpoint (unofficial, daily close)',
    currency: r.meta?.currency ?? 'USD', last, prev_close: prev.close,
    change_pct: Math.round(((last.close - prev.close) / prev.close) * 10000) / 100,
    high_52w: Math.max(...year), low_52w: Math.min(...year), history,
  };
}

/** A block that could not be refreshed keeps its last good values and is marked stale. */
export function keepOrStale(fresh, previous) {
  if (fresh) return fresh;
  if (previous) return { ...previous, status: 'stale' };
  return { status: 'missing' };
}

export function buildCompany(manual, { financials, price }, previous) {
  return {
    node_id: manual.node_id, name: manual.name, ticker: manual.ticker, curated_at: manual.curated_at,
    price: keepOrStale(price, previous?.price),
    financials: keepOrStale(financials, previous?.financials),
    reference_prices: manual.reference_prices ?? [],
    manual_series: manual.manual_series ?? {},
    events: manual.events ?? [],
  };
}

/** Structural checks; the build refuses to write a snapshot that fails them. */
export function validateMarket(m) {
  const errs = [];
  if (m?.schema !== MARKET_SCHEMA) errs.push('bad schema');
  for (const [id, c] of Object.entries(m?.companies ?? {})) {
    if (c.node_id !== id) errs.push(`${id}: node_id mismatch`);
    for (const k of ['price', 'financials']) if (!['ok', 'stale', 'missing'].includes(c[k]?.status)) errs.push(`${id}: ${k} status`);
    for (const [k, ser] of Object.entries(c.manual_series ?? {})) {
      if (!ser.unit || !Array.isArray(ser.points)) errs.push(`${id}: manual ${k} malformed`);
      for (const p of ser.points ?? []) {
        if (typeof p.value !== 'number' || !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) errs.push(`${id}: manual ${k} point`);
        if (!/^https:\/\//.test(p.source ?? '')) errs.push(`${id}: manual ${k} point lacks https source`);
      }
    }
    for (const r of c.reference_prices ?? []) if (typeof r.value !== 'number' || !/^https:\/\//.test(r.source ?? '')) errs.push(`${id}: reference price`);
  }
  return errs;
}

/** Comparable content, ignoring fetch timestamps, so unchanged data does not create a new commit. */
export function contentKey(m) {
  return JSON.stringify(m, (k, v) => (k === 'generated_at' || k === 'fetched_at' ? undefined : v));
}
