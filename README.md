# AI Capital Network — Phase 1 (read-only interactive site)

Static Vite + React + TypeScript site (network drawn as plain SVG) built from the handoff starter package
(`AI_CAPITAL_NETWORK_WEBSITE_HANDOFF.md`, 2026-10-29). Data is an **intra-month October preview**,
research cutoff **2026-10-28 17:04:34 UTC** (2026-10-29 01:04:34 Asia/Taipei). It is not a month-end
release and not independently re-verified.

## Run

```bash
npm install
npm test                 # vitest regression tests (handoff §13.3, Phase-1 subset)
npm run dev              # dev server (http://localhost:5173)
npm run build            # builds release JSON + dist/
npx vite preview --port 4173   # serve dist/
npm run build:single     # dist-single/index.html — one self-contained file, works from file://
npx playwright install chromium && node scripts/screenshots.mjs http://localhost:4173/   # browser QA + screenshots
node scripts/check-single.mjs   # opens the single-file build via file:// and checks counts
```

## Data flow (no data in components)

`data/seed/` holds the immutable starter files (checksums matched `PACKAGE_MANIFEST.json`).
`scripts/build-release.mjs` validates the seed (unique IDs, endpoints, source refs, status, amount⇒unit,
view membership) and writes an immutable release to `public/data/releases/<release_id>/`
(`manifest.json`, `graph.json`, `sources.json`, `baseline.json`, `views/*.json`), staged then renamed,
and only then atomically rewrites `public/data/latest.json` (pointer + manifest SHA-256).

The browser loads: `latest.json` → manifest (hash checked) → every pinned file (SHA-256 checked via
WebCrypto) → reference validation → render. Any mismatch shows an error instead of partial data.
The single-file build embeds the same files in `window.__ACN_EMBED__` and goes through the same loader.

## Features

- Default view: exact 36-node / 89-edge membership from `companies-network.view.json`; toggle to the full
  91 / 213 view using `full-network.view.json` box positions (10000×8000 space normalised to 2000×1600).
- 7 layers distinguished by colour (§11.1 tokens) **and** line pattern + arrowhead; constant edge widths.
- Search over IDs, English display labels and original (Chinese) labels; picking a node outside the
  current view switches to the full network.
- Node focus: dims unrelated content, panel lists outgoing / incoming records separately.
- Edge selection: direction in words, qualified amount + unit + raw status, raw label/note, October flag,
  source access/date, excerpt (marked not-necessarily-verbatim), http(s)-only source links, parallel record IDs.
- Layer filter (legend buttons with counts), October-change-only toggle; graph, table, counts and exports share one predicate.
- URL state (`release, view, layers, oct, node, edge`), Esc clears selection.
- ≤760 px: List/Graph tabs, list+detail first.
- CSV/JSON export of the filtered table, carrying release id, cutoff, scope and raw status/amount fields; null amounts export empty/null.

## Network page (redesign, 2026-11-08)

- Layout logic is one pure function, `flowLayout` in `src/lib/flow.ts` (tested in `tests/flow.test.ts`); the SVG
  component is `src/FlowGraph.tsx`.
- Nothing selected: the 36-company overview in six columns in the order money and compute move — capital, AI
  labs, hyperscalers, neoclouds, developers & SPVs, chips — with each column ordered to cut line crossings
  (barycentre sweeps). Hovering a company or picking a category chip lights up its lines.
- Lines come in three colours only: money (equity, debt), compute (purchase, delivery), guarantees & options
  (credit support, warrants); project affiliation is a faint dotted grey. Width follows the disclosed US$ amount;
  undisclosed amounts are thin. The overview prints no amounts, so a label can never sit on the wrong line.
- One company selected: it alone in the middle, whoever pays, funds or backs it on the left, whom it pays on the
  right (a delivery record runs provider → recipient, so its recipient counts as the payer). The largest lines carry
  their amounts; a drawer lists its links.
- Two or three selected (the cap; a fourth pick is refused with a note): stacked in the middle with the links
  between them drawn there, a link that skips a box bowing round it. Counterparties are grouped by exactly which
  selected companies they link to — all, each pair, then "only X" — and a panel below lists direct links and a
  table of shared counterparties.
- Clicking any line or amount opens its record with sources. Phones scroll the drawing sideways at full size,
  opening a selection centred on the selected companies.
- Amounts are never summed across records: one contract can produce several records.
- One predicate (`visibleGraph` in `src/lib/selection.ts`) drives the graph, table, counts and exports.
  URL state: `sel=A|B|C` (at most three), `all=0`; old `node=` links still work.
- Under the network, each selected company gets a block (`src/ExposureBlocks.tsx`, logic in `src/lib/exposure.ts`):
  money, compute and guarantees, each split into what comes in (raised; sold to customers; backing received) and
  what goes out (invested or lent; bought from suppliers; backing given), with firm and conditional US$ subtotals.
  Project-level vehicles linked by an affiliation record (e.g. CoreWeave's DDTL facilities) are listed in their own
  sub-sections. A record whose amount is already inside another counted record (`OVERLAPS`, taken from the records'
  notes — e.g. the DDTLs inside CoreWeave's book debt) is shown in grey and not added. Undisclosed and non-dollar
  amounts are listed and counted separately.
- Credit stress: one card per company with CDS (5Y CDS against share price, one-month changes); a card opens the
  full tenor chart. Mechanisms, the record table and the method notes are collapsible sections.

## Company data panel (market, credit, balance sheet)

Selecting a company that has a file in `data/companies/` shows a panel above the records table.
It is deliberately **outside** the hashed release: market data changes daily, the release does not.

| Block | Source | Refresh |
|---|---|---|
| Equity price, 1-year history, distance to reference prices | Yahoo Finance chart endpoint (unofficial) | daily, automatic |
| Cash, debt principal, RPO, revenue, OCF, capex, FCF, interest, maturities | SEC XBRL `companyfacts` | daily check, changes after each 10-Q/10-K |
| 5Y CDS conventional spread, daily | DTCC SEC public dissemination files (trade reports), ISDA standard model | daily, automatic |
| News-reported CDS, bond yields, active/contracted power, undrawn facilities, events | hand-recorded in `data/companies/<company>.json`, each point dated with an https source | manual |

- `scripts/fetch-market.mjs` writes `public/data/market/companies.json`; pure logic lives in `scripts/market-core.mjs`.
  A source that fails keeps its last values, marked `stale`; nothing is zeroed. Unchanged data is not rewritten.
- 10-Q cash flows are year-to-date; quarters are derived by differencing. Debt maturities are placed by calendar
  year (CoreWeave tags its first full year as `NextTwelveMonths`) and the tail is derived as total minus listed years.
- `.github/workflows/market-refresh.yml` runs weekdays after the US close, validates (`vitest`, `tsc`) and commits the
  snapshot to `main` only when it changed. It needs a repository secret `SEC_USER_AGENT` (SEC requires a
  descriptive User-Agent with a contact address); without it the financial block stays at its last values, marked stale.
- Local refresh: `SEC_USER_AGENT="<name> <contact>" node scripts/fetch-market.mjs`.
- CDS: `scripts/fetch-cds.mjs` downloads new `SEC_CUMULATIVE_CREDITS_*.zip` end-of-day files (one-year backfill),
  applies DTCC corrections/cancellations, and keeps trade state in `data/derived/cds/<node>.json` for every company
  file with a `cds.entity_pattern` (12 names; one download per file is shared). Senior USD single-name trades inside
  the backfill window are priced; package legs and prints identical across names are dropped. DTCC's upfront is the
  cash amount without direction, so quoted points are +(cash + accrued) or −(cash − accrued). Per tenor the sign
  sequence with the least total day-to-day movement is chosen (Viterbi); spread-quoted trades (rescaled when
  reported ×100 too small) pin it, and for 5% names a reading on the 1/8-point grid gets a small bonus. Points convert
  to a conventional spread with the ISDA standard model: flat hazard, 40% recovery, ACT/360 quarterly IMM premiums
  with accrual on default, discounting on the US Treasury par curve of the trade date. Checked against a
  news-reported Markit level: 1,036 vs 1,041.4 bp for CoreWeave on 2026-10-27 (−0.5%). Prints >2.5x from the
  ±14-day median and one-day excursions contradicted by both neighbours are dropped.
- CDS curve: trades are bucketed 1Y–4Y by remaining years and 5Y = the on-the-run contract. A trade above the $5m
  disclosure cap gets a notional only when exactly one $5m–$100m ($1m step) candidate puts its quoted points on the
  1/8 grid and within ±5 points of that tenor's last level; otherwise it is left out. Days without a priced trade
  carry the previous value (`status: carried`; the chart line skips them and joins traded sessions). Inversion = any of 1Y–3Y above 5Y on medians of
  observed values over the last 5 sessions, with the short tenor observed on at least 2 of them (single prints on
  thin tenors produced four false alarms in 2026). An active inversion shows a banner at the top of the site.
- Chart (`src/CdsChart.tsx`): D/W, YTD/6M/1Y/2Y/All, tenor and share-price chips, events from
  `chart_events` in the company file plus SEC results dates (8-K item 2.02), and a draggable navigator.
- Telegram alerts run on the owner's Mac, not in GitHub (the bot token must not leave that host):
  `~/dashboard-dispatch/acn-refresh.sh` dispatches this workflow and then runs `acn-cds-alert.mjs`.
- To add a company: create `data/companies/<name>.json` with the release `node_id`, `sec_cik` and `yahoo_symbol`.

## Known data gaps / limitations

- 159/213 edges have no `deal_id`; 115 have unknown amounts (shown as “not disclosed”, never 0).
- Many edge labels/notes, node IDs and coverage notes are Chinese only; shown raw — no reviewed English translation yet.
- `status` is the raw mixed legal/evidence/attribution string; not yet split into separate dimensions, so no legal-stage/cash/evidence filters.
- `october_change` does not say *why* (new event vs backfill vs correction); the UI says so.
- Source `published_at` precision is heterogeneous; shown raw. Source URLs were not re-fetched/validated.
- Full-network project labels include editorial amount callouts taken from the view manifest (historical principal/facility).
- Edges follow each view manifest's quadratic Bézier (start, control, end) at a constant width. Band headers mark capital providers, chips, model developers, cloud & capacity, operators, and project sites. Three mechanism cards under the map read amounts and status qualifiers from cited records (R003/R004, R054/R055, R191–R193); a null amount stays “not disclosed”.
- Not implemented (later phases): release history/comparison, refresh polling, deal/project pages, two-hop expansion, image/SVG export.
