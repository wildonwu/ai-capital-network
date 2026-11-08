import { useMemo, useState } from 'react';
import type { CdsPoint, CompanyMarket } from './lib/market';
import CdsChart from './CdsChart';

const PALETTE = ['#A23B2A', '#007B83', '#D8912B', '#436B9A', '#6B5BA8', '#2F6B4F', '#9C6F3A', '#A35A83', '#5d544c', '#3E8E9E', '#B4652E', '#7A8B3C'];
const RANGES = [['3M', 63], ['6M', 126], ['1Y', 260]] as const;
const W = 1000, H = 300, L = 54, R = 936, T = 16, B = 270;

/** Value `n` sessions before the last (carried values included, so every company has a daily series). */
const back = (s: CdsPoint[], n: number) => (s.length > n ? s[s.length - 1 - n].spread_bp : null);

function Change({ now, then, wide }: { now: number; then: number | null; wide?: boolean }) {
  const w = wide ? ' cm-wide' : '';
  if (then === null) return <td className={`cm-num${w}`}>—</td>;
  const d = now - then;
  return <td className={`cm-num${w} ${d > 0 ? 'neg' : d < 0 ? 'pos' : ''}`}>{d > 0 ? '+' : ''}{Math.round(d)}</td>;
}

/** Last close and its 1-month (21-session) change, so CDS and share-price moves read side by side. */
function PriceCells({ h }: { h: { date: string; close: number }[] }) {
  if (!h.length) return <><td className="cm-num">—</td><td className="cm-num">—</td></>;
  const now = h[h.length - 1].close, then = h.length > 21 ? h[h.length - 22].close : null;
  const pct = then ? (now / then - 1) * 100 : null;
  return <><td className="cm-num">${now.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
    <td className={`cm-num ${pct === null ? '' : pct < 0 ? 'neg' : 'pos'}`}>{pct === null ? '—' : `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`}</td></>;
}

/** Multi-company 5Y comparison on a log scale, with a summary table that opens one company's detail chart. */
export default function CreditMonitor({ companies, tickerOf }: { companies: CompanyMarket[]; tickerOf: (id: string) => string }) {
  const rows = useMemo(() => companies.filter((c) => c.cds?.series?.length).map((c) => ({ c, s: c.cds!.series! }))
    .sort((a, b) => b.s[b.s.length - 1].spread_bp - a.s[a.s.length - 1].spread_bp), [companies]);
  const color = useMemo(() => Object.fromEntries(rows.map((r, i) => [r.c.node_id, PALETTE[i % PALETTE.length]])), [rows]);
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(rows.map((r) => [r.c.node_id, true])));
  const [range, setRange] = useState<number>(260);
  const [detail, setDetail] = useState<string>(rows[0]?.c.node_id ?? '');
  const [hover, setHover] = useState<number | null>(null);

  const dates = useMemo(() => { const all = new Set<string>(); for (const r of rows) for (const p of r.s) all.add(p.date); return [...all].sort().slice(-range); }, [rows, range]);
  const maps = useMemo(() => Object.fromEntries(rows.map((r) => [r.c.node_id, new Map(r.s.map((p) => [p.date, p]))])), [rows]);
  const shown = rows.filter((r) => on[r.c.node_id]);
  const vals = shown.flatMap((r) => dates.map((d) => maps[r.c.node_id].get(d)?.spread_bp).filter((v): v is number => !!v));
  const lo = Math.log10(Math.max(5, Math.min(...vals, 1000) * 0.85)), hi = Math.log10(Math.max(...vals, 50) * 1.12);
  const n = dates.length;
  const x = (i: number) => L + (i / Math.max(1, n - 1)) * (R - L);
  const y = (v: number) => B - ((Math.log10(v) - lo) / (hi - lo || 1)) * (B - T);
  const ticks = [10, 20, 30, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000].filter((v) => Math.log10(v) >= lo && Math.log10(v) <= hi);
  const path = (id: string) => { let d = '', pen = false; dates.forEach((day, i) => { const p = maps[id].get(day); if (!p) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.spread_bp).toFixed(1)}`; pen = true; }); return d; };
  // End-of-line labels, nudged apart vertically so close lines stay readable.
  const endLabels = shown.flatMap((r) => { const last = [...dates].reverse().find((d) => maps[r.c.node_id].has(d)); return last ? [{ id: r.c.node_id, x: x(dates.indexOf(last)), y: y(maps[r.c.node_id].get(last)!.spread_bp) }] : []; })
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < endLabels.length; i++) endLabels[i].y = Math.max(endLabels[i].y, endLabels[i - 1].y + 13);
  const det = rows.find((r) => r.c.node_id === detail)?.c;
  const hd = hover !== null ? dates[hover] : null;

  return (
    <div className="cm">
      <div className="cm-top">
        <div className="cm-scroll"><table className="cm-table">
          <thead><tr><th></th><th>5Y CDS bp</th><th className="cm-wide">1W</th><th>1M</th><th className="cm-wide">3M</th><th>Price</th><th>Price 1M</th><th className="cm-wide">Last trade</th><th>Curve</th></tr></thead>
          <tbody>{rows.map(({ c, s }) => {
            const last = s[s.length - 1]; const inv = c.cds?.inversion?.alert.active;
            return <tr key={c.node_id} className={detail === c.node_id ? 'on' : ''} onClick={() => setDetail(c.node_id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setDetail(c.node_id); }}>
              <td><label className="cm-tick" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={!!on[c.node_id]} onChange={(e) => setOn((o) => ({ ...o, [c.node_id]: e.target.checked }))} /><i style={{ background: color[c.node_id] }} /><b>{tickerOf(c.node_id)}</b></label></td>
              <td className="cm-num"><b>{Math.round(last.spread_bp).toLocaleString('en-US')}</b></td>
              <Change now={last.spread_bp} then={back(s, 5)} wide /><Change now={last.spread_bp} then={back(s, 21)} /><Change now={last.spread_bp} then={back(s, 63)} wide />
              <PriceCells h={c.price.history ?? []} />
              <td className="cm-date cm-wide">{last.observed_on?.slice(5)}</td>
              <td>{inv ? <span className="badge stale">inverted</span> : <span className="small">normal</span>}</td>
            </tr>;
          })}</tbody>
        </table></div>
        <div className="cm-chart">
          <div className="cm-chart-head">
            <b>5-year CDS, log scale</b>
            <div className="seg cc-seg">{RANGES.map(([k, v]) => <button key={k} className={range === v ? 'on' : ''} onClick={() => setRange(v)}>{k}</button>)}</div>
          </div>
          <div className="cc-body" onPointerLeave={() => setHover(null)}>
            <svg className="cc-svg" viewBox={`0 0 ${W} ${H}`} onPointerMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const X = ((e.clientX - r.left) / r.width) * W; setHover(Math.max(0, Math.min(n - 1, Math.round(((X - L) / (R - L)) * (n - 1))))); }}>
              {ticks.map((v) => <g key={v}><line className="cc-grid" x1={L} x2={R} y1={y(v)} y2={y(v)} /><text className="cc-axis" x={L - 6} y={y(v) + 4} textAnchor="end">{v.toLocaleString('en-US')}</text></g>)}
              <text className="cc-axis-title" x={L} y={11}>bp</text>
              {shown.map((r) => <path key={r.c.node_id} d={path(r.c.node_id)} fill="none" stroke={color[r.c.node_id]} strokeWidth={r.c.node_id === detail ? 2.6 : 1.5} opacity={r.c.node_id === detail ? 1 : 0.85} />)}
              {endLabels.map((e) => <text key={'l' + e.id} x={e.x + 4} y={e.y + 4} className="cm-endlabel" fill={color[e.id]}>{tickerOf(e.id)}</text>)}
              {[0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1].filter((i, j, a) => n && a.indexOf(i) === j).map((i) => <text key={i} className="cc-axis" x={x(i)} y={B + 18} textAnchor="middle">{dates[i]?.slice(0, 7)}</text>)}
              {hover !== null && <line className="cc-cross" x1={x(hover)} x2={x(hover)} y1={T} y2={B} />}
            </svg>
            {hd && <div className={`cc-tip${hover! > n * 0.6 ? ' flip' : ''}`} style={{ left: `${(x(hover!) / W) * 100}%`, top: 10 }}>
              <strong>{hd}</strong>
              {shown.map((r) => ({ r, p: maps[r.c.node_id].get(hd) })).filter((z) => z.p).sort((a, b) => b.p!.spread_bp - a.p!.spread_bp).map(({ r, p }) => (
                <span key={r.c.node_id}><i style={{ background: color[r.c.node_id] }} />{tickerOf(r.c.node_id)}<b>{Math.round(p!.spread_bp).toLocaleString('en-US')} bp</b>{p!.status === 'carried' && <em>carried from {p!.observed_on}</em>}</span>))}
            </div>}
          </div>
        </div>
      </div>
      <p className="small">5-year conventional spreads derived from public DTCC trade reports with the ISDA standard model; not dealer quotes. Days without a trade carry the last value. Changes are in bp. Click a row to compare that company's CDS tenors with its share price below; untick to hide a line.</p>
      {det && <div className="cm-detail"><h3>{tickerOf(det.node_id)} · {det.name}</h3><CdsChart key={det.node_id} ticker={tickerOf(det.node_id)} cds={det.cds!} price={det.price.history ?? []} alertPeriods={det.cds!.inversion?.periods ?? []} /></div>}
    </div>
  );
}
