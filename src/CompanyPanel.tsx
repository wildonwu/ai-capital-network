import type { CdsBlock, CompanyMarket, ManualSeries, QPoint } from './lib/market';
import { daysBetween, latest, manualValue, quarterLabel, usdShort } from './lib/market';

/** Manual (hand-recorded) values older than this are flagged so a stale number is never read as current. */
const MANUAL_STALE_DAYS = 14;

function Spark({ values, refs = [], w = 120, h = 30, zero = false }: { values: number[]; refs?: { v: number; label: string }[]; w?: number; h?: number; zero?: boolean }) {
  if (values.length < 2) return <svg viewBox={`0 0 ${w} ${h}`} className="spark" style={{ maxWidth: w }} aria-hidden="true" />;
  const all = [...values, ...refs.map((r) => r.v), ...(zero ? [0] : [])];
  const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
  const x = (i: number) => (i / (values.length - 1)) * (w - 4) + 2;
  const y = (v: number) => h - 3 - ((v - lo) / span) * (h - 6);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="spark" style={{ maxWidth: w }} aria-hidden="true">
      {refs.map((r) => <line key={r.label} x1="0" x2={w} y1={y(r.v)} y2={y(r.v)} className="spark-ref"><title>{r.label}</title></line>)}
      {zero && lo < 0 && <line x1="0" x2={w} y1={y(0)} y2={y(0)} className="spark-zero" />}
      <polyline points={pts} className="spark-line" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="2.2" className="spark-dot" />
    </svg>
  );
}

function QRow({ label, series, hint }: { label: string; series?: QPoint[]; hint?: string }) {
  const l = latest(series);
  return (
    <div className="cp-row">
      <span className="cp-l">{label}{hint && <small> {hint}</small>}</span>
      <span className={`cp-v${l && l.value < 0 ? ' neg' : ''}`}>{usdShort(l?.value)}</span>
      <Spark values={(series ?? []).map((p) => p.value)} zero />
      <span className="cp-asof">{l ? quarterLabel(l.end) : '—'}</span>
    </div>
  );
}

function ManualRow({ s, today, threshold }: { s: ManualSeries; today: string; threshold?: { v: number; label: string } }) {
  const l = latest(s.points);
  const age = l ? daysBetween(l.date, today) : null;
  const stale = age !== null && age > MANUAL_STALE_DAYS && l?.precision === 'day';
  return (
    <div className="cp-row">
      <span className="cp-l">{s.label}</span>
      <span className={`cp-v${threshold && l && l.value >= threshold.v ? ' alert' : ''}`}>{l ? manualValue(s, l.value) : '—'}</span>
      <Spark values={s.points.map((p) => p.value)} refs={threshold ? [threshold] : []} />
      <span className="cp-asof">{l ? <a href={l.source} target="_blank" rel="noopener noreferrer" title={l.note}>{l.date}</a> : '—'}{stale && <span className="badge stale">{age}d old</span>}</span>
    </div>
  );
}

/** CDS series derived from DTCC trades; compared against any news-reported value on the same date. */
function CdsRow({ cds, today, reported }: { cds: CdsBlock; today: string; reported?: ManualSeries }) {
  const s = cds.series ?? [];
  const l = latest(s);
  const age = l ? daysBetween(l.date, today) : null;
  // Intraday highs are not comparable with a day's traded level.
  const checks = (reported?.points ?? []).filter((p) => !p.intraday).map((p) => ({ p, d: s.find((x) => x.date === p.date) })).filter((x) => x.d);
  return (
    <>
      <div className="cp-row">
        <span className="cp-l">5-year CDS spread <small>DTCC trades</small></span>
        <span className={`cp-v${l && l.spread_bp >= 1000 ? ' alert' : ''}`}>{l ? `${l.spread_bp.toLocaleString('en-US', { maximumFractionDigits: 0 })} bp` : '—'}</span>
        <Spark values={s.map((x) => x.spread_bp)} refs={[{ v: 1000, label: '1,000 bp stress threshold' }]} />
        <span className="cp-asof">{l ? <a href="https://pddata.dtcc.com/ppd/secdashboard" target="_blank" rel="noopener noreferrer" title={cds.method}>{l.date}</a> : '—'}{age !== null && age > 7 && <span className="badge stale">{age}d old</span>}</span>
      </div>
      {l && <p className="cp-note">
        {cds.status !== 'ok' && <b>{cds.status}. </b>}
        {l.points_pct != null ? `Upfront ${l.points_pct.toFixed(2)} points` : 'Spread-quoted'}{l.status === 'carried' ? `, carried from ${l.observed_on} (no 5Y trade since)` : l.status === 'inferred' ? `, includes ${l.inferred} trade${l.inferred === 1 ? '' : 's'} above the $5m cap with an inferred notional` : `, ${l.priced} trade${l.priced === 1 ? '' : 's'}`}. ISDA standard model (40% recovery, Treasury curve).
        {checks.map(({ p, d }) => <> Check {p.date}: {d!.spread_bp.toFixed(0)} vs {p.value.toLocaleString('en-US')} bp reported ({((d!.spread_bp / p.value - 1) * 100).toFixed(1)}%).</>)}
      </p>}
    </>
  );
}

export default function CompanyPanel({ c, today }: { c: CompanyMarket; today: string }) {
  const p = c.price, f = c.financials, ser = f.series;
  const px = p.last?.close;
  const refs = [...c.reference_prices].sort((a, b) => a.value - b.value);
  const ms = c.manual_series;
  const next = c.events.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const mat = f.maturities;
  const maxBucket = Math.max(1, ...(mat?.buckets ?? []).map((b) => b.value));

  return (
    <section className="company-panel" data-testid="company-panel" aria-label={`${c.name} market and financial data`}>
      <div className="cp-head">
        <div>
          <div className="eyebrow">{c.ticker} · company data</div>
          <h2>{c.name}: market, credit and balance sheet</h2>
        </div>
        {next && <p className="cp-next"><b>Next:</b> {next.label} · <a href={next.source} target="_blank" rel="noopener noreferrer">{next.date}</a> ({daysBetween(today, next.date)} days)</p>}
      </div>

      <div className="cp-grid">
        <div className="cp-col">
          <h3>Equity <small>{p.status === 'ok' ? 'daily, automatic' : p.status}</small></h3>
          {px !== undefined ? <>
            <p className="cp-hero"><b>${px.toFixed(2)}</b> <span className={(p.change_pct ?? 0) < 0 ? 'neg' : 'pos'}>{(p.change_pct ?? 0) > 0 ? '+' : ''}{p.change_pct?.toFixed(1)}% d/d</span></p>
            <Spark values={(p.history ?? []).map((h) => h.close)} refs={refs.map((r) => ({ v: r.value, label: `${r.label} $${r.value}` }))} w={260} h={64} />
            <p className="cp-note">Close {p.last?.date} · 1-year range ${p.low_52w?.toFixed(2)}–${p.high_52w?.toFixed(2)} · dashed lines = reference prices below</p>
            <ul className="cp-refs">{refs.map((r) => (
              <li key={r.label}><span>{r.label}</span><a href={r.source} target="_blank" rel="noopener noreferrer">${r.value.toFixed(2)}</a><span className={px < r.value ? 'neg' : 'pos'}>{((px / r.value - 1) * 100).toFixed(0)}%</span></li>))}</ul>
          </> : <p className="cp-note">No price available.</p>}
        </div>

        <div className="cp-col">
          <h3>Credit &amp; capacity <small>CDS daily · rest hand-recorded</small></h3>
          {c.cds && <CdsRow cds={c.cds} today={today} reported={ms.cds_5y_bp} />}
          {ms.cds_5y_bp && <ManualRow s={ms.cds_5y_bp} today={today} threshold={{ v: 1000, label: '1,000 bp stress threshold' }} />}
          {ms.bond_2032_9625_yield_pct && <ManualRow s={ms.bond_2032_9625_yield_pct} today={today} />}
          {ms.undrawn_facilities_usd_bn && <ManualRow s={ms.undrawn_facilities_usd_bn} today={today} />}
          {ms.active_power_mw && <ManualRow s={ms.active_power_mw} today={today} />}
          {ms.contracted_power_mw && <ManualRow s={ms.contracted_power_mw} today={today} />}
          <p className="cp-note">CDS is derived daily from public DTCC trade reports, not a dealer quote. Bond yields have no free per-bond feed, so they and the news-reported CDS values are hand-recorded from dated reports. Undrawn DDTL capacity only funds its financed contracts. Click a date for the source.</p>
        </div>

        <div className="cp-col">
          <h3>Financials <small>{f.status === 'ok' ? 'SEC filings, automatic' : f.status}</small></h3>
          {ser ? <>
            <QRow label="Cash" series={ser.cash} />
            <QRow label="Debt principal" series={ser.debt_principal} />
            <QRow label="Contract backlog (RPO)" series={ser.rpo} />
            <QRow label="Revenue" series={ser.revenue} hint="quarter" />
            <QRow label="Operating cash flow" series={ser.operating_cash_flow} hint="quarter" />
            <QRow label="Capital expenditure" series={ser.capex} hint="quarter" />
            <QRow label="Free cash flow" series={ser.free_cash_flow} hint="OCF − capex" />
            <QRow label="Interest expense" series={ser.interest_expense} hint="quarter" />
            {f.latest_filing && <p className="cp-note">Latest filing {f.latest_filing.form} for period ending {f.latest_filing.period_end}, filed {f.latest_filing.filed}. Quarterly cash flows are derived from year-to-date figures.</p>}
          </> : <p className="cp-note">No filing data available.</p>}
        </div>
      </div>

      {mat && mat.buckets.length > 0 && <div className="cp-mat">
        <h3>Debt principal due by year <small>as of {mat.as_of} · total {usdShort(mat.total)}</small></h3>
        <div className="cp-bars">{mat.buckets.map((b, i) => (
          <div key={b.year} className="cp-bar">
            <div className="cp-bar-track"><div className={`cp-bar-fill${b.derived ? ' derived' : ''}`} style={{ height: `${(b.value / maxBucket) * 100}%` }} /></div>
            <b>{usdShort(b.value)}</b>
            <span>{i === 0 && mat.as_of.slice(5) !== '12-31' ? `rest of ${b.year}` : b.year}{b.derived ? '*' : ''}</span>
          </div>))}</div>
        <p className="cp-note">* Derived as total principal minus the listed years. Excludes leases, and debt issued after the as-of date until the next filing.</p>
      </div>}
    </section>
  );
}
