import { useMemo, useRef, useState } from 'react';
import type { CdsBlock, PricePoint } from './lib/market';
import { CDS_TENORS, weekly, windowFor, windowForDates, type Range } from './lib/cdsChart';

const W = 1000, L = 58, R = 942, T = 30, NAV_H = 54;
const COLORS: Record<string, string> = { '5Y': 'var(--cap)', '4Y': '#8A97AD', '3Y': '#6B5BA8', '2Y': '#D8912B', '1Y': '#A23B2A' };
const RANGES: Range[] = ['1M', '3M', 'YTD', '6M', '1Y', '2Y', 'All'];

function ticks(lo: number, hi: number, n = 5) {
  const step0 = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(step0 || 1));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const out: number[] = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v);
  return out;
}

/** `large`: the taller plot used in the full-screen view (the drawing keeps its 1000-unit width and scales to fit). */
export default function CdsChart({ cds, price, alertPeriods, ticker, large = false }: { cds: CdsBlock; price: PricePoint[]; alertPeriods: { from: string; to: string }[]; ticker: string; large?: boolean }) {
  // Large view: fits a laptop screen with the navigator visible; on a phone the plot is taller than wide.
  const H = large ? (typeof window !== 'undefined' && window.innerWidth < 700 ? 760 : 380) : 330, B = H - 34;
  const [gran, setGran] = useState<'D' | 'W'>('D');
  const [show, setShow] = useState<Record<string, boolean>>({ '5Y': true, '4Y': false, '3Y': false, '2Y': false, '1Y': false, price: true });
  const allDates = useMemo(() => (cds.tenors?.['5Y'] ?? cds.series ?? []).map((p) => p.date), [cds]);
  const [win, setWin] = useState<[number, number]>(() => windowFor('1Y', allDates));
  const [range, setRange] = useState<Range | null>('1Y');
  const [hover, setHover] = useState<number | null>(null);
  const plotRef = useRef<SVGSVGElement>(null);
  const navRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ mode: 'move' | 'l' | 'r' | 'new'; x0: number; win0: [number, number] } | null>(null);

  const lastIdx = allDates.length - 1;
  const [a, b] = [Math.max(0, Math.min(win[0], lastIdx)), Math.max(0, Math.min(win[1], lastIdx))];
  const dayDates = allDates.slice(a, b + 1);
  const dates = gran === 'W' ? weekly(dayDates) : dayDates;
  const byTenor = useMemo(() => Object.fromEntries(CDS_TENORS.map((k) => [k, new Map((cds.tenors?.[k] ?? (k === '5Y' ? cds.series : []) ?? []).map((p) => [p.date, p]))])), [cds]);
  const priceMap = useMemo(() => { const m = new Map<string, number>(); for (const p of price) m.set(p.date, p.close); return m; }, [price]);
  const priceOn = (d: string) => { if (priceMap.has(d)) return priceMap.get(d)!; let v: number | undefined; for (const p of price) { if (p.date <= d) v = p.close; else break; } return v; };

  const n = dates.length;
  const x = (i: number) => (n <= 1 ? (L + R) / 2 : L + (i / (n - 1)) * (R - L));
  const vis = CDS_TENORS.filter((k) => show[k]);
  const vals = vis.flatMap((k) => dates.map((d) => byTenor[k].get(d)?.spread_bp).filter((v): v is number => v !== undefined));
  const lo = Math.min(...vals) * 0.92, hi = Math.max(...vals) * 1.05;
  const y = (v: number) => B - ((v - lo) / (hi - lo || 1)) * (B - T);
  const pv = show.price ? dates.map(priceOn).filter((v): v is number => v !== undefined) : [];
  const plo = pv.length ? Math.min(...pv) * 0.95 : 0, phi = pv.length ? Math.max(...pv) * 1.05 : 1;
  const yp = (v: number) => B - ((v - plo) / (phi - plo || 1)) * (B - T);
  const idxOf = (d: string) => { let best = -1; for (let i = 0; i < n; i++) if (dates[i] <= d) best = i; return best; };

  // The line joins traded sessions only: a session with no trade (value carried) is
  // skipped, so the line runs straight from one trade to the next. Missing history
  // (no point at all) still breaks it.
  const linePaths = (k: string) => {
    let solid = '', penDown = false; const dots: { cx: number; cy: number }[] = [];
    dates.forEach((d, i) => {
      const p = byTenor[k].get(d); if (!p) { penDown = false; return; }
      if (p.status === 'carried') return;
      solid += `${penDown ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.spread_bp).toFixed(1)}`; penDown = true;
      if (p.status === 'inferred') dots.push({ cx: x(i), cy: y(p.spread_bp) });
    });
    return { solid, dots };
  };
  // Start a new sub-path after any gap (e.g. sessions before the price history begins).
  let pricePath = '', penDown = false;
  if (show.price) dates.forEach((d, i) => { const v = priceOn(d); if (v === undefined) { penDown = false; return; } pricePath += `${penDown ? 'L' : 'M'}${x(i).toFixed(1)},${yp(v).toFixed(1)}`; penDown = true; });

  const xd = (d: string) => { const i = idxOf(d); return i < 0 ? L : x(i); };

  const toSvgX = (svg: SVGSVGElement | null, clientX: number) => { const r = svg!.getBoundingClientRect(); return ((clientX - r.left) / r.width) * W; };
  const onPlotMove = (e: React.PointerEvent) => { const X = toSvgX(plotRef.current, e.clientX); setHover(Math.max(0, Math.min(n - 1, Math.round(((X - L) / (R - L)) * (n - 1))))); };

  // Navigator over the whole history; the brush selects the window in session indices.
  const navX = (i: number) => L + (i / Math.max(1, lastIdx)) * (R - L);
  const navIdx = (X: number) => Math.max(0, Math.min(lastIdx, Math.round(((X - L) / (R - L)) * lastIdx)));
  const nav5 = (cds.tenors?.['5Y'] ?? cds.series ?? []);
  const nlo = Math.min(...nav5.map((p) => p.spread_bp)), nhi = Math.max(...nav5.map((p) => p.spread_bp));
  const navPath = nav5.map((p, i) => `${i ? 'L' : 'M'}${navX(i).toFixed(1)},${(NAV_H - 4 - ((p.spread_bp - nlo) / (nhi - nlo || 1)) * (NAV_H - 10)).toFixed(1)}`).join('');
  const startDrag = (mode: 'move' | 'l' | 'r' | 'new') => (e: React.PointerEvent) => {
    e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId);
    const X = toSvgX(navRef.current, e.clientX);
    drag.current = { mode, x0: X, win0: mode === 'new' ? [navIdx(X), navIdx(X)] : [a, b] };
    if (mode === 'new') { setWin([navIdx(X), navIdx(X)]); setRange(null); }
  };
  const onNavMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const X = toSvgX(navRef.current, e.clientX), di = navIdx(X) - navIdx(d.x0);
    let [s, t] = d.win0;
    if (d.mode === 'move') { const w = t - s; s = Math.max(0, Math.min(lastIdx - w, s + di)); t = s + w; }
    else if (d.mode === 'l') s = Math.min(t - 2, Math.max(0, s + di));
    else if (d.mode === 'r') t = Math.max(s + 2, Math.min(lastIdx, t + di));
    else { const i = navIdx(X); s = Math.min(d.win0[0], i); t = Math.max(d.win0[0], i); }
    setWin([s, t]); setRange(null);
  };
  const endDrag = () => { const d = drag.current; drag.current = null; if (d?.mode === 'new' && b - a < 2) setWin([Math.max(0, a - 10), Math.min(lastIdx, b + 10)]); };

  const hd = hover !== null ? dates[hover] : null;
  const latest5 = byTenor['5Y'].get(allDates[lastIdx]);
  const lastObs = latest5?.observed_on;

  return (
    <section className={`cds-chart${large ? ' large' : ''}`} data-testid="cds-chart" aria-label="5-year CDS spread history">
      <div className="cc-head">
        <div>
          <h3>CDS spread by tenor vs price</h3>
          <small>{dates[0]} → {dates[n - 1]} · {n} {gran === 'W' ? 'weeks' : 'sessions'} · lines = conventional spread (bp, left scale) from DTCC trades, ISDA model · the line joins traded sessions; days without a trade are skipped (the readout shows the value carried from the last trade), hollow dot = includes a trade above the $5m cap with an inferred notional · red shading = curve inverted (1–3Y above 5Y) · grey line = share price (right scale) · {large ? 'pick dates above, or drag on the strip below to choose any period' : 'drag on the strip below to pick any period'}</small>
        </div>
        <div className="cc-tools">
          <div className="seg cc-seg" role="group" aria-label="Interval">{(['D', 'W'] as const).map((g) => <button key={g} className={gran === g ? 'on' : ''} onClick={() => setGran(g)}>{g}</button>)}</div>
          <div className="seg cc-seg" role="group" aria-label="Range">{RANGES.filter((r) => large || !['1M', '3M'].includes(r)).map((r) => <button key={r} className={range === r ? 'on' : ''} onClick={() => { setWin(windowFor(r, allDates)); setRange(r); }}>{r}</button>)}</div>
          {large && allDates.length > 0 && <div className="cc-dates" role="group" aria-label="Custom period">
            <label>From <input type="date" min={allDates[0]} max={allDates[lastIdx]} value={allDates[a]} onChange={(e) => { if (e.target.value) { setWin(windowForDates(e.target.value, allDates[b], allDates)); setRange(null); } }} /></label>
            <label>To <input type="date" min={allDates[0]} max={allDates[lastIdx]} value={allDates[b]} onChange={(e) => { if (e.target.value) { setWin(windowForDates(allDates[a], e.target.value, allDates)); setRange(null); } }} /></label>
          </div>}
        </div>
      </div>
      <div className="cc-chips" role="group" aria-label="Series">
        <button className={`cc-chip${show.price ? ' on' : ''}`} style={{ ['--c' as string]: '#5d544c' }} aria-pressed={show.price} onClick={() => setShow((s) => ({ ...s, price: !s.price }))}><i /> Price</button>
        {[...CDS_TENORS].reverse().map((k) => (
          <button key={k} className={`cc-chip${show[k] ? ' on' : ''}`} style={{ ['--c' as string]: COLORS[k] }} aria-pressed={show[k]} onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))}><i /> {k}</button>
        ))}
        {lastObs && <span className="cc-meta">5Y last traded {lastObs}</span>}
      </div>

      <div className="cc-body" onPointerLeave={() => setHover(null)}>
        <svg ref={plotRef} className="cc-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="CDS spreads and share price" onPointerMove={onPlotMove}>
          {ticks(lo, hi).map((v) => <g key={v}><line className="cc-grid" x1={L} x2={R} y1={y(v)} y2={y(v)} /><text className="cc-axis" x={L - 6} y={y(v) + 4} textAnchor="end">{v.toLocaleString('en-US')}</text></g>)}
          {show.price && pv.length > 0 && ticks(plo, phi, 4).map((v) => <text key={v} className="cc-axis" x={R + 6} y={yp(v) + 4}>${v}</text>)}
          <text className="cc-axis-title" x={L} y={14}>bp</text>
          {show.price && <text className="cc-axis-title" x={R} y={14} textAnchor="end">{ticker} $</text>}
          {alertPeriods.filter((p) => p.to >= dates[0] && p.from <= dates[n - 1]).map((p) => <rect key={p.from} className="cc-inv" x={xd(p.from) - 3} y={T} width={Math.max(6, xd(p.to) - xd(p.from) + 6)} height={B - T} />)}
          {pricePath && <path className="cc-price" d={pricePath} />}
          {vis.map((k) => { const { solid, dots } = linePaths(k); return <g key={k} style={{ ['--c' as string]: COLORS[k] }}>
            <path className="cc-line" d={solid} />
            {dots.map((d, i) => <circle key={i} className="cc-inferred" cx={d.cx} cy={d.cy} r={2.6} />)}
          </g>; })}
          {[0, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4), n - 1].filter((i, j, arr) => n && arr.indexOf(i) === j).map((i) => <text key={i} className="cc-axis" x={x(i)} y={B + 18} textAnchor="middle">{dates[i]?.slice(0, 7)}</text>)}
          {hover !== null && <line className="cc-cross" x1={x(hover)} x2={x(hover)} y1={T} y2={B} />}
          <rect className="cc-hit" x={L} y={T} width={R - L} height={B - T} />
        </svg>
        {hd && <div className={`cc-tip${hover! > n * 0.65 ? ' flip' : ''}`} style={{ left: `${(x(hover!) / W) * 100}%` }}>
          <strong>{hd}{gran === 'W' ? ' (week)' : ''}</strong>
          {vis.map((k) => { const p = byTenor[k].get(hd); return <span key={k}><i style={{ background: COLORS[k] }} />{k}<b>{p ? `${Math.round(p.spread_bp).toLocaleString('en-US')} bp` : '—'}</b>{p && p.status !== 'observed' && <em>{p.status === 'carried' ? `carried from ${p.observed_on}` : `${p.inferred} inferred`}</em>}</span>; })}
          {show.price && <span><i className="cc-key-line" />Price<b>{priceOn(hd) !== undefined ? `$${priceOn(hd)!.toFixed(2)}` : '—'}</b></span>}
          {byTenor['5Y'].get(hd)?.points_pct != null && <span className="cc-tip-sub">5Y upfront {byTenor['5Y'].get(hd)!.points_pct!.toFixed(2)} pts</span>}
        </div>}
        <svg ref={navRef} className="cc-nav" viewBox={`0 0 ${W} ${NAV_H + 16}`} role="group" aria-label="Window selector: drag to select a period, drag the window or its handles to adjust"
          onPointerMove={onNavMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
          <rect className="cc-nav-bg" x={L} y={0} width={R - L} height={NAV_H} onPointerDown={startDrag('new')} />
          <path className="cc-nav-line" d={navPath} />
          <rect className="cc-brush" x={navX(a)} y={0} width={Math.max(2, navX(b) - navX(a))} height={NAV_H} onPointerDown={startDrag('move')} />
          {(['l', 'r'] as const).map((s) => { const cx = navX(s === 'l' ? a : b); return <g key={s} className="cc-handle" onPointerDown={startDrag(s)}><rect x={cx - 5} y={NAV_H / 2 - 11} width={10} height={22} rx={3} /><line x1={cx - 1.5} x2={cx - 1.5} y1={NAV_H / 2 - 5} y2={NAV_H / 2 + 5} /><line x1={cx + 1.5} x2={cx + 1.5} y1={NAV_H / 2 - 5} y2={NAV_H / 2 + 5} /></g>; })}
          {[...new Set(allDates.map((d) => d.slice(0, 7)))].filter((_m, i) => i % 2 === 0).map((m) => { const i = allDates.findIndex((d) => d.startsWith(m)); return <text key={m} className="cc-axis" x={navX(i)} y={NAV_H + 13}>{m}</text>; })}
        </svg>
      </div>
    </section>
  );
}
