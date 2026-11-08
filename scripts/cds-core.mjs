// Single-name CDS from DTCC public dissemination files, priced with the ISDA CDS Standard Model conventions.
// Pure functions only; I/O lives in fetch-market.mjs.
import zlib from 'node:zlib';

const DAY = 86400000;
export const RECOVERY = 0.4; // ISDA/Markit standard assumption for senior unsecured

// ---------- dates ----------
export const iso = (d) => new Date(d).toISOString().slice(0, 10);
const utc = (s) => Date.parse(`${s}T00:00:00Z`);
const addDays = (s, n) => iso(utc(s) + n * DAY);
const yearFrac = (a, b) => (utc(b) - utc(a)) / DAY / 365; // ACT/365F for curve time
/** Weekend-only "following" adjustment (the full model also skips US holidays; impact is a day of accrual). */
export function adjustFollowing(s) {
  let d = new Date(utc(s));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d = new Date(d.getTime() + DAY);
  return iso(d);
}
const IMM = [3, 6, 9, 12];
/** Unadjusted IMM date (20 Mar/Jun/Sep/Dec) on or before `s`. */
export function prevImm(s) {
  const y = Number(s.slice(0, 4)), m = Number(s.slice(5, 7)), dd = Number(s.slice(8, 10));
  for (let yy = y; yy >= y - 1; yy--) for (const mm of [...IMM].reverse()) {
    if (yy === y && (mm > m || (mm === m && 20 > dd))) continue;
    return `${yy}-${String(mm).padStart(2, '0')}-20`;
  }
  throw new Error('unreachable');
}
/** Accrual start for a standard contract traded on `trade`: previous IMM date as of T+1, business-day adjusted. */
export function accrualStart(trade) { return adjustFollowing(prevImm(addDays(trade, 1))); }
/** On-the-run 5Y maturity under the semi-annual roll (20 Mar and 20 Sep). */
export function onTheRun5y(trade) {
  const y = Number(trade.slice(0, 4)), md = trade.slice(5);
  if (md >= '09-20') return `${y + 5}-12-20`;
  if (md >= '03-20') return `${y + 5}-06-20`;
  return `${y + 4}-12-20`;
}

// ---------- discount curve from the Treasury par curve ----------
const TENORS = { '1 Mo': 1 / 12, '2 Mo': 2 / 12, '3 Mo': 0.25, '4 Mo': 4 / 12, '6 Mo': 0.5, '1 Yr': 1, '2 Yr': 2, '3 Yr': 3, '5 Yr': 5, '7 Yr': 7, '10 Yr': 10, '20 Yr': 20, '30 Yr': 30 };

/** Parse treasury.gov daily par yield CSV into { 'YYYY-MM-DD': [[t, yield], ...] }. */
export function parseTreasuryCsv(text) {
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const cols = head.split(',').map((c) => c.replace(/"/g, ''));
  const out = {};
  for (const l of lines) {
    const v = l.split(',');
    const [mm, dd, yy] = v[0].split('/');
    const pts = cols.map((c, i) => [TENORS[c], parseFloat(v[i])]).filter(([t, y]) => t !== undefined && Number.isFinite(y)).sort((a, b) => a[0] - b[0]);
    if (pts.length >= 6) out[`${yy}-${mm}-${dd}`] = pts.map(([t, y]) => [t, y / 100]);
  }
  return out;
}

/**
 * Bootstrap discount factors from par yields: bills (<=1y) as simple money-market yields,
 * notes/bonds as semi-annual par bonds with linearly interpolated par yields. Returns DF(t) with log-linear interpolation.
 */
export function discountCurve(par) {
  const interp = (t) => {
    if (t <= par[0][0]) return par[0][1];
    for (let i = 1; i < par.length; i++) if (t <= par[i][0]) { const [t0, y0] = par[i - 1], [t1, y1] = par[i]; return y0 + ((y1 - y0) * (t - t0)) / (t1 - t0); }
    return par.at(-1)[1];
  };
  const nodes = [[0, 1]];
  for (const [t, y] of par) if (t <= 1) nodes.push([t, 1 / (1 + y * t)]);
  const semi = new Map([[0.5, nodes.find((n) => n[0] === 0.5)?.[1] ?? 1 / (1 + interp(0.5) * 0.5)], [1, nodes.find((n) => n[0] === 1)?.[1] ?? 1 / (1 + interp(1))]]);
  for (let k = 3; k <= 60; k++) {
    const t = k / 2, c = interp(t) / 2;
    let sum = 0; for (let j = 1; j < k; j++) sum += semi.get(j / 2);
    semi.set(t, (1 - c * sum) / (1 + c));
  }
  for (const [t, df] of semi) if (t > 1) nodes.push([t, df]);
  nodes.sort((a, b) => a[0] - b[0]);
  return (t) => {
    if (t <= 0) return 1;
    for (let i = 1; i < nodes.length; i++) if (t <= nodes[i][0]) {
      const [t0, d0] = nodes[i - 1], [t1, d1] = nodes[i];
      return Math.exp(Math.log(d0) + ((Math.log(d1) - Math.log(d0)) * (t - t0)) / (t1 - t0));
    }
    const [tn, dn] = nodes.at(-1); const r = -Math.log(dn) / tn; return Math.exp(-r * t);
  };
}

// ---------- ISDA standard model, flat hazard ----------
/** Premium schedule: quarterly IMM dates from accrual start; last period accrues through maturity (inclusive). */
function schedule(start, maturity) {
  const ends = [];
  let y = Number(start.slice(0, 4)), m = Number(start.slice(5, 7));
  for (;;) {
    m += 3; if (m > 12) { m -= 12; y++; }
    const d = `${y}-${String(m).padStart(2, '0')}-20`;
    if (d >= maturity) break;
    ends.push(adjustFollowing(d));
  }
  const periods = []; let s = start;
  for (const e of ends) { periods.push({ s, e, pay: e }); s = e; }
  periods.push({ s, e: addDays(maturity, 1), pay: maturity });
  return periods;
}

/**
 * Precompute everything that does not depend on the hazard rate (dates, discount factors), so the
 * root search only does arithmetic. Integrals over default time use a daily grid.
 */
export function grid({ trade, maturity, df }) {
  const stepIn = addDays(trade, 1), start = accrualStart(trade);
  const t = (d) => yearFrac(trade, d);
  const prot = [];
  const end = addDays(maturity, 1);
  for (let d = stepIn; d < end; d = addDays(d, 1)) { const n = addDays(d, 1); prot.push([t(d), t(n), df((t(d) + t(n)) / 2)]); }
  const coupons = [], aod = [];
  for (const p of schedule(start, maturity)) {
    coupons.push([(utc(p.e) - utc(p.s)) / DAY / 360, t(addDays(p.e, -1)), df(t(p.pay))]);
    const from = p.s > stepIn ? p.s : stepIn;
    for (let d = from; d < p.e; d = addDays(d, 1)) { const n = addDays(d, 1); aod.push([(utc(d) - utc(p.s)) / DAY / 360 + 0.5 / 360, t(d), t(n), df((t(d) + t(n)) / 2)]); }
  }
  const accrued = (utc(stepIn) - utc(start)) / DAY / 360;
  return { prot, coupons, aod, accrued, dfSettle: df(t(adjustFollowing(addDays(trade, 3)))) };
}

export function legs(g, hazard) {
  const Q = (x) => Math.exp(-hazard * Math.max(0, x));
  let prot = 0; for (const [a, b, d] of g.prot) prot += (Q(a) - Q(b)) * d;
  let rpv = 0; for (const [acc, tq, d] of g.coupons) rpv += acc * Q(tq) * d;
  for (const [acc, a, b, d] of g.aod) rpv += acc * (Q(a) - Q(b)) * d;
  return { prot: prot * (1 - RECOVERY), rpv, accrued: g.accrued, dfSettle: g.dfSettle };
}

/** Clean upfront ("points", fraction of notional) for a coupon under a flat hazard. */
export function pointsFromHazard(g, hazard, coupon) {
  const { prot, rpv, accrued, dfSettle } = legs(g, hazard);
  return (prot - coupon * rpv) / dfSettle + coupon * accrued;
}

/** Conventional (quoted) spread: the flat-curve par spread that reproduces the observed clean upfront. */
export function conventionalSpread({ trade, maturity, coupon, points, df, g = grid({ trade, maturity, df }) }) {
  let lo = 1e-6, hi = 5;
  if (pointsFromHazard(g, hi, coupon) < points || pointsFromHazard(g, lo, coupon) > points) return null; // outside model range
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (pointsFromHazard(g, mid, coupon) < points) lo = mid; else hi = mid;
  }
  const h = (lo + hi) / 2;
  const { prot, rpv, accrued } = legs(g, h);
  return { spread: prot / (rpv - accrued), hazard: h };
}

// ---------- tabulated pricer (fast path for many trades) ----------
/**
 * For one trade date and maturity, tabulate the coupon-independent legs over a log-spaced hazard lattice.
 * Points for any coupon and the conventional spread follow by interpolation, so thousands of trades that share
 * a date and maturity cost one table. Weekly integration steps keep a table cheap; error is well under 1 bp.
 */
export function priceTable({ trade, maturity, df }) {
  const stepIn = addDays(trade, 1), start = accrualStart(trade), end = addDays(maturity, 1);
  const t = (d) => yearFrac(trade, d);
  const prot = []; for (let d = stepIn; d < end;) { const n = addDays(d, 7) < end ? addDays(d, 7) : end; prot.push([t(d), t(n), df((t(d) + t(n)) / 2)]); d = n; }
  const coupons = [], aod = [];
  for (const p of schedule(start, maturity)) {
    coupons.push([(utc(p.e) - utc(p.s)) / DAY / 360, t(addDays(p.e, -1)), df(t(p.pay))]);
    const from = p.s > stepIn ? p.s : stepIn;
    for (let d = from; d < p.e;) { const n = addDays(d, 7) < p.e ? addDays(d, 7) : p.e; aod.push([((utc(d) + utc(n)) / 2 - utc(p.s)) / DAY / 360, t(d), t(n), df((t(d) + t(n)) / 2)]); d = n; }
  }
  const g = { prot, coupons, aod, accrued: (utc(stepIn) - utc(start)) / DAY / 360, dfSettle: df(t(adjustFollowing(addDays(trade, 3)))) };
  const H = []; for (let k = 0; k <= 320; k++) H.push(1e-5 * Math.pow(5 / 1e-5, k / 320));
  const rows = H.map((h) => ({ h, ...legs(g, h) }));
  return { rows, accrued: g.accrued, dfSettle: g.dfSettle };
}
const pointsAt = (row, tb, c) => (row.prot - c * row.rpv) / tb.dfSettle + c * tb.accrued;
const spreadAt = (row, tb) => row.prot / (row.rpv - tb.accrued);
/** Conventional spread for quoted points (fraction) and coupon, or null if outside the lattice. */
export function spreadFromPoints(tb, points, coupon) {
  const r = tb.rows;
  for (let k = 1; k < r.length; k++) {
    const a = pointsAt(r[k - 1], tb, coupon), b = pointsAt(r[k], tb, coupon);
    if ((a - points) * (b - points) <= 0 && a !== b) { const w = (points - a) / (b - a); return spreadAt(r[k - 1], tb) + w * (spreadAt(r[k], tb) - spreadAt(r[k - 1], tb)); }
  }
  return null;
}
/** Quoted points for a conventional spread and coupon (used to show points for spread-quoted trades). */
export function pointsFromSpread(tb, spread, coupon) {
  const r = tb.rows;
  for (let k = 1; k < r.length; k++) {
    const a = spreadAt(r[k - 1], tb), b = spreadAt(r[k], tb);
    if ((a - spread) * (b - spread) <= 0 && a !== b) { const w = (spread - a) / (b - a); return pointsAt(r[k - 1], tb, coupon) + w * (pointsAt(r[k], tb, coupon) - pointsAt(r[k - 1], tb, coupon)); }
  }
  return null;
}

// ---------- DTCC files ----------
/** Minimal ZIP reader (stored / deflate) — DTCC files hold a single CSV. */
export function unzip(buf) {
  const out = {};
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const lnlen = buf.readUInt16LE(off + 26), lxlen = buf.readUInt16LE(off + 28);
    const data = buf.subarray(off + 30 + lnlen + lxlen, off + 30 + lnlen + lxlen + csize);
    out[name] = method === 0 ? data : zlib.inflateRawSync(data);
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

/** RFC 4180 CSV to objects keyed by header. */
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [h, ...rest] = rows;
  return rest.filter((r) => r.length > 1).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])));
}

const nyDate = (ts) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));

/** Keep senior single-name USD CDS rows on the reference entity; normalise the fields we use. */
export function selectTrades(records, entityPattern) {
  const re = new RegExp(entityPattern, 'i');
  // Package legs (e.g. several names traded together) report a shared upfront, not this name's price: leave them out.
  return records.filter((r) => r['UPI FISN'] === 'NA/CDS Corp SN Sr' && re.test(r['Underlying Asset Name'] || '') && (r['Notional currency-Leg 1'] || 'USD') === 'USD' && r['Package indicator'] !== 'TRUE').map((r) => {
    const raw = (r['Notional amount-Leg 1'] || '').replace(/,/g, '');
    // Some trades are quoted directly in spread (decimal notation, e.g. 0.0293 = 293 bp) instead of points.
    const sp = parseFloat(r['Spread-Leg 1']);
    const spread = r['Spread notation-Leg 1'] === '3' && sp > 0 && sp < 0.5 ? sp : null;
    return {
      id: r['Dissemination Identifier'], orig: r['Original Dissemination Identifier'] || null, action: r['Action type'],
      ts: r['Execution Timestamp'], trade: r['Execution Timestamp'] ? nyDate(r['Execution Timestamp']) : null,
      maturity: r['Expiration Date'], coupon: parseFloat(r['Fixed rate-Leg 1']),
      notional: raw.endsWith('+') ? null : parseFloat(raw), capped: raw.endsWith('+'),
      upfront: r['Other payment amount'] ? parseFloat(r['Other payment amount']) : null, upfrontType: r['Other payment type'] || null,
      ...(spread !== null ? { spread } : {}),
    };
  });
}

/** Apply DTCC lifecycle: CORR/MODI replace the original record, EROR cancels it. Input in dissemination order. */
export function applyLifecycle(store, trades) {
  for (const t of trades) {
    if (t.action === 'EROR') { delete store[t.orig ?? t.id]; continue; }
    if ((t.action === 'CORR' || t.action === 'MODI') && t.orig) {
      const prev = store[t.orig];
      // A MODI is a lifecycle change (e.g. partial unwind), not a new price: keep the original price observation.
      if (t.action === 'MODI') { if (prev) store[t.orig] = { ...prev, modified: true }; continue; }
      store[t.orig] = { ...t, id: t.orig, corrected: true };
      continue;
    }
    if (t.action === 'NEWT') store[t.id] = t;
  }
  return store;
}

/** Daily on-the-run 5Y observations: median conventional spread and points from trades with a visible notional. */
// DTCC's "Other payment amount" is the cash settlement amount (quoted points minus accrued premium):
// adding accrued back puts 73% of CoreWeave trades on the 1/8-point quoting grid versus 7% without it.
export function dailySeries(store, curves, { minTrades = 1, upfrontIsCash = true } = {}) {
  const byDay = new Map();
  const curveDates = Object.keys(curves).sort();
  const curveOn = (d) => { let best = null; for (const c of curveDates) { if (c <= d) best = c; else break; } return best; };
  const dfCache = new Map();
  for (const t of Object.values(store)) {
    if (!t.trade || t.maturity !== onTheRun5y(t.trade) || !Number.isFinite(t.coupon)) continue;
    const day = byDay.get(t.trade) ?? { date: t.trade, trades: 0, capped: 0, priced: [] };
    day.trades++; if (t.capped) day.capped++;
    if (t.notional && t.upfront !== null && t.upfrontType === 'UFRO') {
      const cd = curveOn(t.trade);
      if (cd) {
        if (!dfCache.has(cd)) dfCache.set(cd, discountCurve(curves[cd]));
        const points = t.upfront / t.notional + (upfrontIsCash ? t.coupon * (utc(addDays(t.trade, 1)) - utc(accrualStart(t.trade))) / DAY / 360 : 0);
        const r = conventionalSpread({ trade: t.trade, maturity: t.maturity, coupon: t.coupon, points, df: dfCache.get(cd) });
        if (r) day.priced.push({ points, spread: r.spread });
      }
    }
    byDay.set(t.trade, day);
  }
  const med = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
  return [...byDay.values()].filter((d) => d.priced.length >= minTrades).sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({
    date: d.date, spread_bp: Math.round(med(d.priced.map((p) => p.spread)) * 1e4 * 10) / 10,
    points_pct: Math.round(med(d.priced.map((p) => p.points)) * 1e4) / 100,
    priced: d.priced.length, trades: d.trades, capped: d.capped,
  }));
}

/** Fields kept in the committed trade store (keeps the file small and stable). */
export function compactTrade(t) {
  const { id, trade, ts, maturity, coupon, notional, capped, upfront, upfrontType, spread, corrected, modified } = t;
  return { id, trade, ts, maturity, coupon, notional, capped, upfront, upfrontType, ...(spread ? { spread } : {}), ...(corrected ? { corrected } : {}), ...(modified ? { modified } : {}) };
}

// ---------- tenors, capped-notional inference, daily curve, inversion ----------
export const CDS_TENORS = ['1Y', '2Y', '3Y', '4Y', '5Y'];
/** 5Y = the on-the-run contract; other buckets by remaining years (old 5Y contracts fall into 4Y after a roll). */
export function tenorOf(t) {
  if (t.maturity === onTheRun5y(t.trade)) return '5Y';
  const y = (utc(t.maturity) - utc(t.trade)) / DAY / 365.25;
  return y < 1.5 ? '1Y' : y < 2.5 ? '2Y' : y < 3.5 ? '3Y' : y < 5.6 ? '4Y' : null;
}
const accruedFrac = (t) => (t.coupon * (utc(addDays(t.trade, 1)) - utc(accrualStart(t.trade))) / DAY) / 360;
/** Quoted points (fraction) from DTCC's cash upfront: cash / notional + accrued premium. */
export const quotedPoints = (t, notional) => t.upfront / notional + accruedFrac(t);
/** On the 1/8-point quoting grid within 0.004 points (a random value lands there ~6% of the time). */
export const onEighthGrid = (p) => Math.abs(p / 0.00125 - Math.round(p / 0.00125)) * 0.00125 < 0.00004;

/**
 * Notional of a capped (> $5m) trade: try $5m–$100m in $1m steps; keep candidates whose quoted points sit on the
 * 1/8 grid and within ±5 points of the tenor's latest known level. Accept only a single surviving candidate.
 */
export function inferNotional(t, refPoints) {
  if (refPoints === null || refPoints === undefined || t.upfront === null) return null;
  const hits = [];
  for (let n = 5e6; n <= 1e8; n += 1e6) {
    const p = quotedPoints(t, n);
    if (onEighthGrid(p) && Math.abs(p - refPoints) <= 0.05) hits.push({ notional: n, points: p });
  }
  return hits.length === 1 ? hits[0] : null;
}

// SIFMA-recommended full closes for US bond markets (credit derivatives follow them).
const HOLIDAYS = new Set([
  '2025-01-01', '2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26', '2025-06-19', '2025-07-04', '2025-09-01', '2025-10-13', '2025-11-11', '2025-11-27', '2025-12-25',
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06', '2027-10-11', '2027-11-11', '2027-11-25', '2027-12-24',
]);
export function businessDays(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) { const w = new Date(utc(d)).getUTCDay(); if (w && w !== 6 && !HOLIDAYS.has(d)) out.push(d); }
  return out;
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

/** Both readings of an upfront trade: +(cash + accrued) and −(cash − accrued), with spreads and grid flags. */
export function readings(t, notional, tb, coupon) {
  const cash = t.upfront / notional, acc = accruedFrac(t);
  return [cash + acc, -(cash - acc)].map((p) => ({ p, s: spreadFromPoints(tb, p, coupon), grid: onEighthGrid(p) })).filter((c) => c.s !== null && c.s > 0);
}

const tableCache = new Map();
/** Shared across companies: tables depend only on trade date, maturity and the day's curve. */
export function tableFor(trade, maturity, curveDate, curves) {
  const k = `${trade}|${maturity}|${curveDate}`;
  if (!tableCache.has(k)) tableCache.set(k, priceTable({ trade, maturity, df: discountCurve(curves[curveDate]) }));
  return tableCache.get(k);
}

/**
 * Price every trade, then build one value per business day and tenor.
 * - A trade quoted in spread is used as is.
 * - DTCC reports the upfront amount without its direction, so points can be +(cash + accrued) or −(cash − accrued).
 *   The reading that lands on the 1/8-point quoting grid wins; otherwise the one nearer the tenor's last level;
 *   with no reference yet the trade is skipped.
 * - Trades above the $5m cap get a notional only for 5% coupons (points-quoted names), see inferNotional.
 * Days without a priced trade carry the previous value forward and are marked `carried`.
 */
export function curveSeries(store, curves, lastDate) {
  const curveDates = Object.keys(curves).sort();
  const curveOn = (d) => { let best = null; for (const c of curveDates) { if (c <= d) best = c; else break; } return best; };
  const trades = Object.values(store).filter((t) => t.trade && t.maturity).sort((a, b) => (a.ts ?? '').localeCompare(b.ts ?? ''));
  let inferredCount = 0, cappedSkipped = 0, ambiguous = 0, outliers = 0;

  // Candidate readings for every trade. `certain` = one unambiguous reading (spread quote on the normal scale, or a
  // disclosed-notional upfront with exactly one reading on the 1/8 grid). Capped trades wait for pass 2.
  const priced = [];
  for (const t of trades) {
    const k = tenorOf(t); if (!k) continue;
    const cd = curveOn(t.trade); if (!cd) continue;
    const tb = tableFor(t.trade, t.maturity, cd, curves);
    const coupon = Number.isFinite(t.coupon) ? t.coupon : null;
    if (t.spread) {
      const cands = [t.spread, t.spread * 100].filter((s) => s >= 0.0005 && s <= 0.5).map((s) => ({ s, p: coupon !== null ? pointsFromSpread(tb, s, coupon) : null }));
      // One candidate in range, or a value already on the normal scale (>= 10bp), is unambiguous.
      if (cands.length) priced.push({ t, k, cands, certain: cands.length === 1 || t.spread >= 0.001 ? cands[0] : null });
      continue;
    }
    // A zero upfront is a missing amount, not a trade at the coupon.
    if (coupon === null || t.upfrontType !== 'UFRO' || !t.upfront) continue;
    if (!t.notional) { if (coupon === 0.05) priced.push({ t, k, tb, coupon, capped: true }); else cappedSkipped++; continue; }
    const cands = readings(t, t.notional, tb, coupon);
    // Even for 5% names most prints miss the grid, so a lone grid hit is weak evidence: a bonus in the branch choice
    // below, not a certainty. Only a single valid reading (the other sign gives no spread) is certain.
    if (cands.length) priced.push({ t, k, cands, certain: cands.length === 1 ? cands[0] : null });
  }

  // Branch choice: near the coupon both sign readings form a smooth path, so pick per tenor the sequence of readings
  // with the least total day-to-day movement (Viterbi over the trades in time order). Single-reading trades (spread
  // quotes, or readings where the other sign is impossible) pin the path; for 5% names a reading on the 1/8 grid gets a
  // small bonus (1% names are quoted in spread, so their grid hits are chance).
  // Later unambiguous prints therefore also decide earlier ambiguous ones, which a running anchor cannot do.
  const branch = new Map();
  for (const k of CDS_TENORS) {
    const seq = priced.filter((x) => x.k === k && !x.capped);
    if (!seq.length) continue;
    const opts = seq.map((x) => (x.certain ? [x.certain] : x.cands));
    const own = (c, i) => (seq[i].t.coupon === 0.05 && c.grid && opts[i].length > 1 && !opts[i].every((o) => o.grid) ? -0.1 : 0);
    let cost = opts[0].map((c) => own(c, 0)); const back = [];
    for (let i = 1; i < seq.length; i++) {
      const prev = opts[i - 1], cur = opts[i];
      const step = cur.map((c) => {
        let best = Infinity, arg = 0;
        prev.forEach((q, j) => { const v = cost[j] + Math.abs(Math.log(c.s / q.s)); if (v < best) { best = v; arg = j; } });
        return [best + own(c, i), arg];
      });
      cost = step.map(([v]) => v); back.push(step.map(([, a]) => a));
    }
    let j = cost.indexOf(Math.min(...cost));
    for (let i = seq.length - 1; i >= 0; i--) { branch.set(seq[i], opts[i][j]); if (i > 0) j = back[i - 1][j]; }
  }

  // Outlier anchor per tenor = median of the branch-chosen readings within ±14 days (widening to ±60), 5Y as fallback.
  // A window of many prints, so a single bad print (a mis-scaled spread quote, say) is itself the outlier.
  const pickedBy = Object.fromEntries(CDS_TENORS.map((k) => [k, []]));
  for (const [x, c] of branch) pickedBy[x.k].push([utc(x.t.trade), c.s]);
  const anchorAt = (k, d) => {
    const at = utc(d);
    for (const kk of [k, '5Y']) for (const w of [14, 60]) {
      const v = pickedBy[kk].filter(([day]) => Math.abs(day - at) <= w * DAY).map(([, s]) => s);
      if (v.length) return median(v);
    }
    return null;
  };

  // Pass 2, in time order: resolve each trade against the anchor; capped 5% trades get an inferred notional using
  // the tenor's last decided points; prints more than 2.5x from the anchor are dropped.
  const obs = Object.fromEntries(CDS_TENORS.map((k) => [k, new Map()]));
  const refPts = {}, lastS = {};
  for (const x of priced) {
    // No certain reading nearby: stay on the branch the tenor was last on.
    const anchor = anchorAt(x.k, x.t.trade) ?? lastS[x.k] ?? null;
    let pick = x.certain ?? null, inferred = false;
    if (x.capped) {
      const r = inferNotional(x.t, refPts[x.k] ?? null);
      if (!r) { cappedSkipped++; continue; }
      const c = readings(x.t, r.notional, x.tb, x.coupon).find((c) => Math.abs(c.p - r.points) < 1e-9);
      if (!c) { cappedSkipped++; continue; }
      pick = c; inferred = true; inferredCount++;
    }
    if (!pick) pick = branch.get(x) ?? null;
    if (!pick) { ambiguous++; continue; }
    if (anchor !== null && Math.abs(Math.log(pick.s / anchor)) > Math.log(2.5)) { outliers++; continue; }
    if (pick.p !== null && pick.p !== undefined) refPts[x.k] = pick.p;
    lastS[x.k] = pick.s;
    const day = obs[x.k].get(x.t.trade) ?? { spreads: [], points: [], inferred: 0, disclosed: 0 };
    day.spreads.push(pick.s); if (pick.p !== null && pick.p !== undefined) day.points.push(pick.p);
    if (inferred) day.inferred++; else day.disclosed++;
    obs[x.k].set(x.t.trade, day);
  }
  // A one-day excursion that both neighbouring observed days contradict is a spike: drop it
  // (the day then carries the previous value).
  let spikes = 0;
  for (const k of CDS_TENORS) {
    const days = [...obs[k].keys()].sort();
    const val = (d) => median(obs[k].get(d).spreads);
    const drop = days.filter((d, i) => {
      if (i === 0 || i === days.length - 1) return false;
      const o = obs[k].get(d), v = val(d), a = val(days[i - 1]), b = val(days[i + 1]);
      const off = (x) => Math.abs(Math.log(v / x));
      // Single print >25% off both neighbours; or any day >35% off both neighbours that agree with each other within 25%.
      return (o.spreads.length === 1 && off(a) > Math.log(1.25) && off(b) > Math.log(1.25))
        || (off(a) > Math.log(1.35) && off(b) > Math.log(1.35) && Math.abs(Math.log(a / b)) < Math.log(1.25));
    });
    for (const d of drop) obs[k].delete(d);
    spikes += drop.length;
  }
  outliers += spikes;
  const first = trades[0]?.trade; if (!first) return { tenors: {}, inferredCount, cappedSkipped, ambiguous, outliers };
  const days = businessDays(first, lastDate);
  const tenors = {};
  for (const k of CDS_TENORS) {
    let prev = null; const out = [];
    for (const d of days) {
      const o = obs[k].get(d);
      if (o) {
        prev = { date: d, spread_bp: Math.round(median(o.spreads) * 1e5) / 10, points_pct: o.points.length ? Math.round(median(o.points) * 1e4) / 100 : null, status: o.inferred ? 'inferred' : 'observed', priced: o.disclosed, inferred: o.inferred, observed_on: d };
        out.push(prev);
      } else if (prev) out.push({ ...prev, date: d, status: 'carried', priced: 0, inferred: 0 });
    }
    tenors[k] = out;
  }
  return { tenors, inferredCount, cappedSkipped, ambiguous, outliers };
}

/**
 * Inversion: any of 1Y–3Y above 5Y, comparing medians of each tenor's own observations over the last 5 business days.
 * Carried values are excluded so a stale print cannot trigger it.
 */
export function inversionHistory(tenors, window = 5, minDays = 2) {
  const five = tenors['5Y'] ?? []; const out = [];
  for (let i = 0; i < five.length; i++) {
    const d = five[i].date, from = five[Math.max(0, i - window + 1)].date;
    const obs = (k) => (tenors[k] ?? []).filter((p) => p.date >= from && p.date <= d && p.status !== 'carried');
    const f5 = obs('5Y'); if (!f5.length) { out.push({ date: d, inverted: false }); continue; }
    const f = median(f5.map((p) => p.spread_bp));
    // A single print on a thin short tenor is not a curve: require observations on at least `minDays` days.
    const short = ['1Y', '2Y', '3Y'].map((k) => { const o = obs(k); return { tenor: k, days: o.length, spread_bp: o.length ? median(o.map((p) => p.spread_bp)) : null }; })
      .filter((x) => x.days >= minDays && x.spread_bp > f);
    out.push({ date: d, inverted: short.length > 0, five_bp: f, five_days: f5.length, short });
  }
  return out;
}

export function inversionAlert(history) {
  const last = history.at(-1); if (!last) return { active: false };
  if (!last.inverted) return { active: false, as_of: last.date };
  let i = history.length - 1; while (i > 0 && history[i - 1].inverted) i--;
  return { active: true, as_of: last.date, since: history[i].date, five_bp: Math.round(last.five_bp), five_days: last.five_days, short: last.short.map((s) => ({ tenor: s.tenor, spread_bp: Math.round(s.spread_bp), days: s.days })) };
}

/** Inverted stretches for chart shading. */
export function inversionPeriods(history) {
  const out = []; let cur = null;
  for (const h of history) { if (h.inverted) { if (!cur) cur = { from: h.date, to: h.date }; else cur.to = h.date; } else if (cur) { out.push(cur); cur = null; } }
  if (cur) out.push(cur);
  return out;
}

/**
 * Prints that appear identically (same minute, notional and upfront) under several reference entities are
 * package legs reported with one shared amount. Returns the trade ids to drop, per company.
 */
export function crossNameDuplicates(stores) {
  const seen = new Map();
  for (const [name, store] of Object.entries(stores)) for (const t of Object.values(store)) {
    if (!t.ts || t.upfront === null) continue;
    const k = `${t.ts.slice(0, 16)}|${t.notional ?? 'cap'}|${t.upfront}`;
    if (!seen.has(k)) seen.set(k, []);
    seen.get(k).push([name, t.id]);
  }
  const drop = Object.fromEntries(Object.keys(stores).map((n) => [n, new Set()]));
  for (const hits of seen.values()) if (new Set(hits.map(([n]) => n)).size > 1) for (const [n, id] of hits) drop[n].add(id);
  return drop;
}
