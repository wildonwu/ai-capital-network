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

/** Keep senior single-name CDS rows on the reference entity; normalise the fields we use. */
export function selectTrades(records, entityPattern) {
  const re = new RegExp(entityPattern, 'i');
  return records.filter((r) => r['UPI FISN'] === 'NA/CDS Corp SN Sr' && re.test(r['Underlying Asset Name'] || '')).map((r) => {
    const raw = (r['Notional amount-Leg 1'] || '').replace(/,/g, '');
    return {
      id: r['Dissemination Identifier'], orig: r['Original Dissemination Identifier'] || null, action: r['Action type'],
      ts: r['Execution Timestamp'], trade: r['Execution Timestamp'] ? nyDate(r['Execution Timestamp']) : null,
      maturity: r['Expiration Date'], coupon: parseFloat(r['Fixed rate-Leg 1']),
      notional: raw.endsWith('+') ? null : parseFloat(raw), capped: raw.endsWith('+'),
      upfront: r['Other payment amount'] ? parseFloat(r['Other payment amount']) : null, upfrontType: r['Other payment type'] || null,
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
  const { id, trade, ts, maturity, coupon, notional, capped, upfront, upfrontType, corrected, modified } = t;
  return { id, trade, ts, maturity, coupon, notional, capped, upfront, upfrontType, ...(corrected ? { corrected } : {}), ...(modified ? { modified } : {}) };
}
