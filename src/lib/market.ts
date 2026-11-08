import { defaultFetcher, type Fetcher } from './data';

/** Company market/financial snapshot written by scripts/fetch-market.mjs. Kept apart from the immutable release. */
export const MARKET_SCHEMA = 'acn-market-1';
export const MARKET_PATH = 'market/companies.json';

export type BlockStatus = 'ok' | 'stale' | 'missing';
export interface QPoint { end: string; value: number; derived?: boolean }
export interface PricePoint { date: string; close: number }
export interface ManualPoint { date: string; precision: string; value: number; note?: string; source: string; intraday?: boolean }
export interface ManualSeries { label: string; unit: string; note?: string; points: ManualPoint[] }
export interface ReferencePrice { label: string; value: number; source: string }
export interface MaturityBucket { year: string; value: number; derived: boolean }

export interface CdsPoint { date: string; spread_bp: number; points_pct: number; status?: 'observed' | 'inferred' | 'carried'; priced: number; inferred?: number; observed_on?: string; trades?: number; capped?: number }
export interface InversionAlert { active: boolean; as_of?: string; since?: string; five_bp?: number; five_days?: number; short?: { tenor: string; spread_bp: number; days: number }[] }
export interface CdsBlock {
  status: BlockStatus; fetched_at?: string; source?: string; method?: string; reference_entity?: string; latest_file?: string | null;
  inferred_trades?: number; capped_unresolved?: number;
  series?: CdsPoint[]; tenors?: Record<string, CdsPoint[]>;
  inversion?: { rule: string; alert: InversionAlert; periods: { from: string; to: string }[] };
}
export interface ChartEvent { date: string; end?: string; label: string; kind: 'line' | 'band' | 'earnings'; detail?: string; source: string }

export interface CompanyMarket {
  node_id: string; name: string; ticker: string; curated_at: string;
  price: { status: BlockStatus; fetched_at?: string; source?: string; currency?: string; last?: PricePoint; prev_close?: number; change_pct?: number; high_52w?: number; low_52w?: number; history?: PricePoint[] };
  financials: {
    status: BlockStatus; fetched_at?: string; source?: string;
    latest_filing?: { form: string; filed: string; period_end: string } | null;
    series?: Record<'revenue' | 'net_income' | 'operating_cash_flow' | 'capex' | 'free_cash_flow' | 'interest_expense' | 'cash' | 'debt_principal' | 'rpo', QPoint[]>;
    maturities?: { as_of: string; total: number | null; buckets: MaturityBucket[] } | null;
  };
  cds?: CdsBlock;
  reference_prices: ReferencePrice[];
  manual_series: Record<string, ManualSeries>;
  events: { date: string; label: string; source: string }[];
  chart_events?: ChartEvent[];
}
export interface MarketSnapshot { schema: string; generated_at: string; companies: Record<string, CompanyMarket> }

/** Optional data: a missing or malformed snapshot hides the panel instead of blocking the release view. */
export async function loadMarket(fetcher: Fetcher = defaultFetcher()): Promise<MarketSnapshot | null> {
  try {
    const m = JSON.parse(await fetcher(MARKET_PATH)) as MarketSnapshot;
    return m.schema === MARKET_SCHEMA && m.companies ? m : null;
  } catch { return null; }
}

export const latest = <T,>(xs: T[] | undefined): T | undefined => (xs && xs.length ? xs[xs.length - 1] : undefined);

/** USD amounts as "$5.52bn" / "−$5.74bn" / "$680m". */
export function usdShort(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const a = Math.abs(v), sign = v < 0 ? '−' : '';
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(a >= 1e11 ? 0 : 2)}bn`;
  if (a >= 1e6) return `${sign}$${Math.round(a / 1e6)}m`;
  return `${sign}$${Math.round(a)}`;
}

export function manualValue(s: ManualSeries, v: number): string {
  if (s.unit === 'bp') return `${v.toLocaleString('en-US', { maximumFractionDigits: 1 })} bp`;
  if (s.unit === '%') return `${v.toFixed(v % 1 ? 2 : 1)}%`;
  if (s.unit === 'MW') return v >= 1000 ? `${(v / 1000).toFixed(2).replace(/\.?0+$/, '')} GW` : `${v} MW`;
  if (s.unit === 'USD bn') return `$${v.toFixed(2)}bn`;
  return `${v} ${s.unit}`;
}

export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/** "Q2 2026" from a calendar quarter end date. */
export function quarterLabel(end: string): string {
  const m = Number(end.slice(5, 7));
  return `Q${Math.ceil(m / 3)} ${end.slice(0, 4)}`;
}
