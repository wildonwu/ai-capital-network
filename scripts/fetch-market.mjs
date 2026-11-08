// Refreshes public/data/market/companies.json from SEC XBRL and Yahoo daily closes.
// Manual inputs (CDS, bond marks, power, reference prices) live in data/companies/*.json.
// A source that fails keeps its previous values, marked stale; nothing is ever silently zeroed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARKET_SCHEMA, buildCompany, contentKey, earningsEvents, financialsFromCompanyFacts, priceFromYahoo, validateMarket } from './market-core.mjs';
import { refreshCds } from './fetch-cds.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manualDir = path.join(root, 'data/companies');
const outFile = path.join(root, 'public/data/market/companies.json');
// SEC requires a descriptive User-Agent with a contact address; supplied by the workflow secret.
const SEC_UA = process.env.SEC_USER_AGENT;

async function getJSON(url, headers) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

const previous = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : null;
const now = new Date().toISOString();
const companies = {};
const problems = [];

for (const file of fs.readdirSync(manualDir).filter((f) => f.endsWith('.json')).sort()) {
  const manual = JSON.parse(fs.readFileSync(path.join(manualDir, file), 'utf8'));
  let financials = null, price = null, cds = null, earnings = null;
  if (manual.sec_cik) {
    if (!SEC_UA) problems.push(`${manual.node_id}: SEC_USER_AGENT not set, financials kept from previous snapshot`);
    else {
      try { financials = financialsFromCompanyFacts(await getJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${manual.sec_cik}.json`, { 'User-Agent': SEC_UA }), now); }
      catch (e) { problems.push(`${manual.node_id}: SEC ${e.message}`); }
      try { earnings = earningsEvents(await getJSON(`https://data.sec.gov/submissions/CIK${manual.sec_cik}.json`, { 'User-Agent': SEC_UA }), manual.sec_cik); }
      catch (e) { problems.push(`${manual.node_id}: SEC submissions ${e.message}`); }
    }
  }
  if (manual.yahoo_symbol) {
    try { price = priceFromYahoo(await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(manual.yahoo_symbol)}?range=1y&interval=1d`, { 'User-Agent': 'Mozilla/5.0' }), now); }
    catch (e) { problems.push(`${manual.node_id}: price ${e.message}`); }
  }
  if (manual.cds?.source === 'dtcc-sec') {
    try { const r = await refreshCds({ nodeId: manual.node_id, cds: manual.cds }, root, now); cds = r.block; for (const l of r.log) console.log(`${manual.node_id} cds ${l}`); }
    catch (e) { problems.push(`${manual.node_id}: CDS ${e.message}`); }
  }
  companies[manual.node_id] = buildCompany(manual, { financials, price, cds, earnings }, previous?.companies?.[manual.node_id]);
}

const next = { schema: MARKET_SCHEMA, generated_at: now, companies };
const errs = validateMarket(next);
if (errs.length) { console.error('Market snapshot failed validation:\n' + errs.join('\n')); process.exit(1); }
for (const p of problems) console.warn('warn:', p);

if (previous && contentKey(previous) === contentKey(next)) {
  console.log('Market data unchanged; snapshot not rewritten.');
} else {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(next, null, 1) + '\n');
  console.log(`Wrote ${path.relative(root, outFile)} (${Object.keys(companies).length} companies).`);
}
