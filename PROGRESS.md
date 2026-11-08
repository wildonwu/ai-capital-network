# PROGRESS — AI Capital Network

## Context
Phase 1 shipped a read-only network of contract/capital relationships (release `2026-10-29T010434+0800-research-preview`).
Research on CoreWeave (Nov 2026) showed that relationship records alone cannot answer "when could this company
default and under what conditions". The current phase adds publicly observable market and financial data per company,
starting with CoreWeave. Data-centre construction tracking (Epoch AI, landlord filings, permits) is parked as harder to
quantify.

## Key decisions (2026-11-05)
- Company data lives outside the hashed release (`public/data/market/companies.json`), loaded optionally; a missing
  or invalid snapshot hides the panel and never blocks the release view.
- Generic per-company format; only CoreWeave is populated for now.
- Latest value plus a small trend line for every metric.
- No free CDS or TRACE feed: credit values are hand-recorded from dated secondary reports, each with a source URL,
  and flagged when older than 14 days.
- Daily refresh via GitHub Actions; data-only commits go straight to `main` (Vercel deploys on push).

## Tasks
### Phase 2 — Company data panel
- [x] Manual inputs schema and CoreWeave file (`data/companies/coreweave.json`)
- [x] SEC XBRL + Yahoo fetcher with stale fallback and validation (`scripts/fetch-market.mjs`, `scripts/market-core.mjs`)
- [x] Panel UI above the records table, responsive to 390 px (`src/CompanyPanel.tsx`)
- [x] Tests (`tests/market.test.ts`) — 34/34 passing with existing suite
- [x] Daily workflow (`.github/workflows/market-refresh.yml`)
- [x] Repository secret `SEC_USER_AGENT` set (2026-11-05)
- [x] Feature pushed to `main` and verified on the live site (Vercel success; manual workflow run fetched both sources)
- [ ] Phase retrospective presented to the user

### Phase 2b — CDS from DTCC trade reports (2026-11-08)
- [x] ISDA standard model (`scripts/cds-core.mjs`), DTCC fetch with lifecycle handling (`scripts/fetch-cds.mjs`)
- [x] Upfront convention resolved (cash amount + accrued); one-year backfill: 144 priced days since 2025-10-02
- [x] Calibration vs Markit (news): −0.5% on 2026-10-27; panel row with trade counts and on-date checks
- [x] Pushed and verified live (2026-11-08)
- Note: FINRA's free API has only market-wide TRACE aggregates; per-bond yields stay hand-recorded

### Phase 2c — CDS curve, chart and inversion alert (2026-11-08)
- [x] All tenors kept; 5Y on-the-run as the headline; carried values on no-trade days
- [x] Capped-trade notional inference ($5m–$100m, $1m step, unique 1/8-grid hit within ±5 points): 90 trades resolved
- [x] Inversion rule with a 2-day minimum on the short tenor; banner at top of site
- [x] Chart modelled on the Taiwan dashboard flows chart (D/W, ranges, chips, events, navigator, share price)
- [x] Owner confirmed the draft event list (2026-11-08)
- [x] launchd `com.wildon.dashboard-dispatch.acn` loaded; end-to-end run sent the first inversion alert (2026-11-08)
- [x] Pushed and verified live

### Phase 3 — Network v2 (2026-11-08)
Decisions: risk ranking by impact size (shown later, once obligation fields exist); contractual links only,
market contagion as a separate indicator later; no automatic indirect paths (the user clicks through);
seven categories; detailed data backfill deferred.
- [x] Category list, multi-select union, shared counterparties, unlinked-pair notice
- [x] Show all (36 companies) / Blank; projects appear when their company is selected
- [x] Fixed vs concentric re-layout, both available for comparison
- [x] Credit monitor section with the CDS chart above the network
- [x] Tests (`tests/selection.test.ts`), 62/62 passing
- [x] Four layouts built for comparison; "Bands by category" kept as default for now (owner still deciding)
- [x] Merged to main 2026-11-08 (layout choice still open; Bands by category is the default)

### Phase 3b — 5Y CDS for every bond issuer in the network (2026-11-08)
Decision: track the 5Y CDS of every network company with bonds and DTCC single-name trades, not only CoreWeave.
- [x] Company files for ORCL, NVDA, AVGO, AMZN, META, GOOGL, AMD, MSFT, BAC, C, MS (entity patterns on DTCC names)
- [x] One DTCC download per file shared by all companies; package legs and identical cross-name prints dropped
- [x] Sign of the undirected upfront chosen per tenor by least total movement (Viterbi); spread quotes pin the path;
      the 1/8-point grid is only a small bonus for 5% names (most prints miss it, so lone hits were misleading)
- [x] Spread quotes reported ×100 too small rescaled; zero upfronts and pre-window lifecycle trades ignored
- [x] Day-level spike filter; outlier guard anchored on the chosen readings, not on sparse "certain" ones
- [x] Credit monitor: sortable 5Y table (1W/1M/3M change, curve status), log-scale comparison, per-company detail
- [x] Share price and 1-month price change beside each company's CDS; detail chart for every company
- [x] 74/74 tests passing; merged to main and live 2026-11-08
Excluded: SoftBank (JPY contracts, needs a JPY curve); NBIS, IREN, WULF, CIFR, APLD, HUT and private firms (no trades).

### Phase 4 — Page redesign (2026-11-08)
Decisions (from static mockups the owner approved): the network is the first screen at full width; company-level
columns in flow order (capital → AI labs → hyperscalers → neoclouds → developers & SPVs → chips) with crossings
reduced by barycentre ordering; only three line colours (money, compute, guarantees & options) and width by
disclosed amount; no amount labels in the overview. Selecting a company redraws it alone in the middle: who pays,
funds or backs it on the left, whom it pays on the right, every line labelled. Two or three companies: stacked in
the middle, links between them drawn there, counterparties grouped by exactly which selected companies they link
to (all, each pair, only X). At most three selected. Credit monitor becomes small-multiple cards (5Y CDS vs share
price), a card opens the full tenor chart. Mechanisms, records and method fold into collapsible sections. Amounts
are never summed across records (one contract can create several records).
- [x] Pure layout module `src/lib/flow.ts` with tests (columns, ego sides, grouping, between-links, cap of 3)
- [x] SVG network component replacing Cytoscape; record detail on line click; keyboard access
- [x] Page shell: top bar with alert, hero, category chips + search, legend, drawer / panel, credit cards, folds
- [x] Phone layout (graph scrolls sideways in overview; selection fits the width)
- [x] Remove Cytoscape, old layouts, company list; tests, lint, build, screenshots; push to main

### Backlog
- [ ] Obligation fields per record (type, contingent, max amount, trigger, end obligor, loss rank) → guarantor
      and end-obligor exposure totals, then risk tiers by impact size
- [ ] Market-contagion indicator (CDS / equity co-movement) kept separate from contractual links
- [ ] Fuse timeline (dated covenant tests, maturities, drawdown deadlines) — mockup approved in principle
- [ ] Optional: FINRA 144A market breadth as a high-yield market stress indicator (credential stored)
- [ ] Data-centre delivery tracking from Epoch AI CSVs (`data_center_timelines.csv`), per-site slip alerts
- [ ] DDTL ↔ customer ↔ site mapping with confidence levels (confirmed / inferred / unknown)
- [ ] Fix inherited record errors found during research: F06 convertible closed at $4.2bn (2.875%, due 2033), not
      $3.7bn; R075 links DDTL 3.0 to Oracle although its source says OpenAI; R213 "67% of 2025 revenue" needs a source

## Blockers / next steps
1. After the Q3 2026 filing (results 2026-11-10), confirm the fetcher picks up the new 10-Q and update manual series
   (power MW, undrawn facilities, CDS/bond marks).

## Verification
- `npm test`, `npx tsc -b`, `npx oxlint src scripts` pass.
- `?node=CoreWeave` shows the panel above the records table; no horizontal scroll at 390 px.
- Snapshot figures match the Q2 2026 10-Q: revenue $2.575bn, H1 OCF $3.66bn, H1 capex $14.1bn, cash $5.52bn,
  debt principal $35.55bn with maturities 4.41 / 6.18 / 4.42 / 2.42 / 3.22 / 14.90 ($bn).
