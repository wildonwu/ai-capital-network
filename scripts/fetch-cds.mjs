// Daily CDS refresh from DTCC SEC public dissemination (end-of-day cumulative credit files).
// Trade state per company is committed to data/derived/cds/<node_id>.json; each file is downloaded once per run
// and handed to every company that has not processed it yet (a newly added company backfills a year).
import fs from 'node:fs';
import path from 'node:path';
import { applyLifecycle, compactTrade, crossNameDuplicates, curveSeries, inversionAlert, inversionHistory, inversionPeriods, parseCsv, parseTreasuryCsv, selectTrades, unzip, RECOVERY } from './cds-core.mjs';

const UA = { 'User-Agent': 'Mozilla/5.0 (ai-capital-network research)' };
const BACKFILL_DAYS = 370;
const fileDate = (name) => name.replace(/^SEC_CUMULATIVE_CREDITS_/, '').replace('.zip', '');

async function get(url, as = 'text') {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return as === 'buffer' ? Buffer.from(await r.arrayBuffer()) : r.text();
}

async function treasuryCurves(years) {
  const curves = {};
  for (const y of years) {
    const csv = await get(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${y}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${y}&page&_format=csv`);
    Object.assign(curves, parseTreasuryCsv(csv));
  }
  return curves;
}

/**
 * companies: [{ nodeId, cds: { entity_pattern, label } }]. Returns { blocks: { nodeId: block }, log }.
 * A company whose processing fails is left out of `blocks` (the caller keeps its previous values, marked stale).
 */
export async function refreshAllCds(companies, root, now) {
  const log = [];
  const states = new Map(companies.map(({ nodeId, cds }) => {
    const f = path.join(root, 'data/derived/cds', `${nodeId}.json`);
    const st = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { entity_pattern: cds.entity_pattern, processed: [], trades: {} };
    if (st.entity_pattern !== cds.entity_pattern) Object.assign(st, { entity_pattern: cds.entity_pattern, processed: [], trades: {} }); // pattern changed: rebuild
    return [nodeId, { file: f, st, done: new Set(st.processed) }];
  }));

  // The dashboard API names its S3 bucket; fall back to the last known name when that API is unavailable.
  let bucket = 'kgc0418-tdw-data-0';
  try {
    const b = (await get('https://pddata.dtcc.com/ppd/api/general/bucketname')).trim();
    try { const j = JSON.parse(b); bucket = typeof j === 'string' ? j : Object.values(j)[0]; } catch { if (/^[a-z0-9.-]+$/.test(b)) bucket = b; }
  } catch (e) { log.push(`bucket lookup failed (${e.message}); using ${bucket}`); }
  const list = JSON.parse(await get(`https://${bucket}.s3.amazonaws.com/dashboard/Cumulative.json`)).SEC_CR ?? [];
  const cutoff = new Date(Date.parse(now) - BACKFILL_DAYS * 86400000).toISOString().slice(0, 10).replace(/-/g, '_');
  const files = list.filter((f) => fileDate(f.fileName) >= cutoff).sort((a, b) => a.fileName.localeCompare(b.fileName));

  let downloaded = 0;
  for (const f of files) {
    const need = [...states].filter(([, s]) => !s.done.has(f.fileName));
    if (!need.length) continue;
    const records = Object.values(unzip(await get(f.fullFilePath, 'buffer'))).flatMap((csv) => parseCsv(csv.toString('utf8')));
    downloaded++;
    for (const [, s] of need) { applyLifecycle(s.st.trades, selectTrades(records, s.st.entity_pattern)); s.st.processed.push(f.fileName); s.done.add(f.fileName); }
  }
  log.push(`${downloaded} DTCC file(s) downloaded`);

  const lastFile = files.at(-1)?.fileName;
  const lastDate = lastFile ? fileDate(lastFile).replace(/_/g, '-') : now.slice(0, 10);
  const years = new Set();
  for (const [, s] of states) for (const t of Object.values(s.st.trades)) if (t.trade) years.add(t.trade.slice(0, 4));
  const curves = await treasuryCurves([...years].sort());

  const drop = crossNameDuplicates(Object.fromEntries([...states].map(([id, s]) => [id, s.st.trades])));
  const blocks = {};
  for (const { nodeId, cds } of companies) {
    const s = states.get(nodeId);
    for (const [id, t] of Object.entries(s.st.trades)) s.st.trades[id] = compactTrade(t);
    s.st.processed = s.st.processed.filter((n) => fileDate(n) >= cutoff).sort();
    fs.mkdirSync(path.dirname(s.file), { recursive: true });
    fs.writeFileSync(s.file, JSON.stringify(s.st, null, 0) + '\n');
    try {
      // Lifecycle events on old contracts carry their original trade date (Oracle back to 2022); price only trades
      // executed inside the backfill window, so the series does not open with a years-old print.
      const since = cutoff.replace(/_/g, '-');
      const priced = Object.fromEntries(Object.entries(s.st.trades).filter(([id, t]) => !drop[nodeId].has(id) && t.trade >= since));
      const { tenors, inferredCount, cappedSkipped, ambiguous, outliers } = curveSeries(priced, curves, lastDate);
      if (!tenors['5Y']?.length) { log.push(`${nodeId}: no priced 5Y trades`); continue; }
      const history = inversionHistory(tenors);
      blocks[nodeId] = {
        status: 'ok', fetched_at: now,
        source: 'DTCC SEC public dissemination, end-of-day cumulative credit files',
        method: `Senior single-name USD trades bucketed by tenor (5Y = on-the-run contract). Spread-quoted trades are used as is. For upfront trades DTCC gives the amount without direction, so points are +(cash + accrued) or −(cash − accrued): the reading on the 1/8-point grid wins, else the one nearer the tenor's last level. Trades above the $5m cap get a notional only for 5% coupons when exactly one $5m–$100m ($1m step) candidate fits the grid within ±5 points. ISDA standard model, flat hazard, ${RECOVERY * 100}% recovery, Treasury par curve of the trade date. Daily median; days without a priced trade carry the previous value.`,
        reference_entity: cds.label ?? nodeId,
        latest_file: lastFile ?? null,
        inferred_trades: inferredCount, capped_unresolved: cappedSkipped, ambiguous_skipped: ambiguous, outliers_dropped: outliers, package_legs_dropped: drop[nodeId].size,
        series: tenors['5Y'],
        tenors,
        inversion: { rule: 'Any of 1Y–3Y above 5Y: medians of observed (not carried) values over the last 5 business days, short tenor observed on at least 2 of those days', alert: inversionAlert(history), periods: inversionPeriods(history) },
      };
    } catch (e) { log.push(`${nodeId}: ${e.message}`); }
  }
  return { blocks, log };
}
