import { useMemo, useState } from 'react';
import type { CdsPoint, CompanyMarket, PricePoint } from './lib/market';
import CdsChart from './CdsChart';

const RANGES = [['3M', 92], ['6M', 183], ['1Y', 366]] as const;
const VW = 300, VH = 74;

function minusDays(d: string, n: number) { return new Date(Date.parse(d) - n * 86400000).toISOString().slice(0, 10); }
const short = (name: string) => name.replace(/,? Inc\.?$|,? Corporation$| Corp\.?$|\.com, Inc\.$| Platforms, Inc\.$/, '').replace(/^Advanced Micro Devices.*/, 'Advanced Micro Devices');

/** One card per company: 5Y CDS (red) against share price (grey), each on its own scale, plus one-month changes. */
function Card({ c, from, on, tick, onOpen }: { c: CompanyMarket; from: string; on: boolean; tick: string; onOpen: () => void }) {
  const s = c.cds!.series!, px = c.price.history ?? [];
  const last = s[s.length - 1].spread_bp, m1 = s.length > 21 ? last - s[s.length - 22].spread_bp : null;
  const pl = px.at(-1)?.close, p1 = pl !== undefined && px.length > 21 ? (pl / px[px.length - 22].close - 1) * 100 : null;
  const cs = s.filter((p) => p.date >= from);
  const ps = px.filter((p, i) => p.date >= from && (i % 3 === 0 || i === px.length - 1));
  const dates = [...new Set([...cs.map((p) => p.date), ...ps.map((p) => p.date)])].sort();
  const xi = new Map(dates.map((d, i) => [d, i]));
  const path = <T,>(arr: T[], date: (p: T) => string, val: (p: T) => number) => {
    const v = arr.map(val), lo = Math.min(...v), hi = Math.max(...v);
    return arr.map((p, i) => `${i ? 'L' : 'M'}${((xi.get(date(p))! / Math.max(1, dates.length - 1)) * VW).toFixed(1)},${(VH - 4 - ((val(p) - lo) / (hi - lo || 1)) * (VH - 10)).toFixed(1)}`).join('');
  };
  const cdsPath = path<CdsPoint>(cs, (p) => p.date, (p) => p.spread_bp);
  const inv = c.cds?.inversion?.alert.active;
  return (
    <button className={`cc-card${inv ? ' hot' : ''}${on ? ' on' : ''}`} onClick={onOpen} aria-pressed={on} aria-label={`${tick} 5-year CDS ${Math.round(last)} basis points; open the full chart`}>
      <span className="ccd-h"><b>{tick}</b><span>{short(c.name)}</span>{inv && <span className="ccd-tag">curve inverted</span>}</span>
      <span className="ccd-nums">
        <span className="ccd-big">{Math.round(last).toLocaleString('en-US')}<small>bp</small></span>
        {m1 !== null && <span className={`ccd-delta ${m1 > 0 ? 'up' : 'dn'}`}>{m1 > 0 ? '+' : ''}{Math.round(m1)}<em>1M</em></span>}
        <span className="ccd-px">{pl !== undefined && <span className="ccd-p">${pl.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>}
          {p1 !== null && <span className={`ccd-delta ${p1 < 0 ? 'up' : 'dn'}`}>{p1 > 0 ? '+' : ''}{p1.toFixed(1)}%<em>1M</em></span>}</span>
      </span>
      <svg className="ccd-spark" viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none" aria-hidden="true">
        {cs.length > 1 && <path d={`${cdsPath}L${VW},${VH}L0,${VH}Z`} fill="#B5532F" fillOpacity=".07" />}
        {ps.length > 1 && <path d={path<PricePoint>(ps, (p) => p.date, (p) => p.close)} fill="none" stroke="#A39A90" strokeWidth="1.3" vectorEffect="non-scaling-stroke" />}
        {cs.length > 1 && <path d={cdsPath} fill="none" stroke="#B5532F" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
      </svg>
    </button>
  );
}

export default function CreditCards({ companies, tickerOf }: { companies: CompanyMarket[]; tickerOf: (id: string) => string }) {
  const rows = useMemo(() => companies.filter((c) => c.cds?.series?.length).sort((a, b) => b.cds!.series!.at(-1)!.spread_bp - a.cds!.series!.at(-1)!.spread_bp), [companies]);
  const [days, setDays] = useState(366);
  const [open, setOpen] = useState<string | null>(null);
  const lastDate = rows.reduce((m, c) => (c.cds!.series!.at(-1)!.date > m ? c.cds!.series!.at(-1)!.date : m), '');
  const from = minusDays(lastDate, days);
  const det = rows.find((c) => c.node_id === open);
  return (
    <>
      <div className="sec-head"><h2>Credit stress</h2><p>5-year CDS (red, bp) against share price (grey)</p>
        <div className="pill-seg" role="group" aria-label="Range">{RANGES.map(([k, v]) => <button key={k} className={days === v ? 'on' : ''} onClick={() => setDays(v)}>{k}</button>)}</div>
      </div>
      <div className="cc-grid">{rows.map((c) => <Card key={c.node_id} c={c} from={from} on={open === c.node_id} tick={tickerOf(c.node_id)} onOpen={() => setOpen((o) => (o === c.node_id ? null : c.node_id))} />)}</div>
      <p className="keyrow"><span><i style={{ background: '#B5532F' }} />5Y CDS, derived from public DTCC trade reports with the ISDA standard model (not dealer quotes)</span><span><i style={{ background: '#A39A90' }} />Share price</span><span>Click a card for every tenor and the full chart</span></p>
      {det && <div className="cc-detail"><div className="cc-detail-h"><h3>{tickerOf(det.node_id)} · {det.name}</h3><button className="link" onClick={() => setOpen(null)}>Close ×</button></div>
        <CdsChart key={det.node_id} ticker={tickerOf(det.node_id)} cds={det.cds!} price={det.price.history ?? []} alertPeriods={det.cds!.inversion?.periods ?? []} /></div>}
    </>
  );
}
