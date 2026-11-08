// Daily CDS refresh from DTCC SEC public dissemination (end-of-day cumulative credit files).
// Trade state is committed to data/derived/cds/<node_id>.json so each run only downloads new files.
import fs from 'node:fs';
import path from 'node:path';
import { applyLifecycle, compactTrade, curveSeries, inversionAlert, inversionHistory, inversionPeriods, parseCsv, parseTreasuryCsv, selectTrades, unzip, RECOVERY } from './cds-core.mjs';

const UA = { 'User-Agent': 'Mozilla/5.0 (ai-capital-network research)' };
const BACKFILL_DAYS = 370;

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

/** Returns { block, log } where block is the snapshot's `cds` entry (or null on failure). */
export async function refreshCds({ nodeId, cds }, root, now) {
  const stateFile = path.join(root, 'data/derived/cds', `${nodeId}.json`);
  const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { entity_pattern: cds.entity_pattern, processed: [], trades: {} };
  const log = [];

  // The dashboard API names its S3 bucket; fall back to the last known name when that API is unavailable.
  let bucket = 'kgc0418-tdw-data-0';
  try {
    const b = (await get('https://pddata.dtcc.com/ppd/api/general/bucketname')).trim();
    try { const j = JSON.parse(b); bucket = typeof j === 'string' ? j : Object.values(j)[0]; } catch { if (/^[a-z0-9.-]+$/.test(b)) bucket = b; }
  } catch (e) { log.push(`bucket lookup failed (${e.message}); using ${bucket}`); }
  const list = JSON.parse(await get(`https://${bucket}.s3.amazonaws.com/dashboard/Cumulative.json`)).SEC_CR ?? [];
  const cutoff = new Date(Date.parse(now) - BACKFILL_DAYS * 86400000).toISOString().slice(0, 10).replace(/-/g, '_');
  const done = new Set(state.processed);
  const todo = list.filter((f) => !done.has(f.fileName) && f.fileName.replace(/^SEC_CUMULATIVE_CREDITS_/, '').replace('.zip', '') >= cutoff)
    .sort((a, b) => a.fileName.localeCompare(b.fileName));

  for (const f of todo) {
    const buf = await get(f.fullFilePath, 'buffer');
    let rows = [];
    for (const csv of Object.values(unzip(buf))) rows = rows.concat(selectTrades(parseCsv(csv.toString('utf8')), cds.entity_pattern));
    applyLifecycle(state.trades, rows);
    state.processed.push(f.fileName);
    log.push(`${f.fileName}: ${rows.length} rows`);
  }
  for (const [id, t] of Object.entries(state.trades)) state.trades[id] = compactTrade(t);
  state.processed = state.processed.filter((n) => n.replace(/^SEC_CUMULATIVE_CREDITS_/, '').replace('.zip', '') >= cutoff).sort();
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 0) + '\n');

  const years = [...new Set(Object.values(state.trades).map((t) => t.trade?.slice(0, 4)).filter(Boolean))].sort();
  const lastFile = state.processed.at(-1);
  const lastDate = lastFile ? lastFile.replace(/^SEC_CUMULATIVE_CREDITS_/, '').replace('.zip', '').replace(/_/g, '-') : now.slice(0, 10);
  const { tenors, inferredCount, cappedSkipped } = curveSeries(state.trades, await treasuryCurves(years), lastDate);
  const history = inversionHistory(tenors);
  return {
    log,
    block: {
      status: 'ok', fetched_at: now,
      source: 'DTCC SEC public dissemination, end-of-day cumulative credit files',
      method: `Senior single-name trades bucketed by tenor (5Y = on-the-run contract). Quoted points = cash upfront / notional + accrued. Trades above the $5m disclosure cap get a notional only when exactly one $5m–$100m ($1m step) candidate puts the points on the 1/8 grid within ±5 points of the tenor's last level. ISDA standard model, flat hazard, ${RECOVERY * 100}% recovery, Treasury par curve of the trade date. Daily median; days without a priced trade carry the previous value.`,
      reference_entity: cds.label ?? nodeId,
      latest_file: lastFile ?? null,
      inferred_trades: inferredCount, capped_unresolved: cappedSkipped,
      series: tenors['5Y'] ?? [],
      tenors,
      inversion: { rule: 'Any of 1Y–3Y above 5Y: medians of observed (not carried) values over the last 5 business days, short tenor observed on at least 2 of those days', alert: inversionAlert(history), periods: inversionPeriods(history) },
    },
  };
}
