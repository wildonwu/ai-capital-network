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
- [ ] Repository secret `SEC_USER_AGENT` set (blocked: needs the owner's chosen contact string)
- [ ] Feature pushed to `main` and verified on the live site
- [ ] Phase retrospective presented to the user

### Backlog
- [ ] Fuse timeline (dated covenant tests, maturities, drawdown deadlines) — mockup approved in principle
- [ ] Find a scrapeable public source for bond quotes; until then update `manual_series` by hand
- [ ] Data-centre delivery tracking from Epoch AI CSVs (`data_center_timelines.csv`), per-site slip alerts
- [ ] DDTL ↔ customer ↔ site mapping with confidence levels (confirmed / inferred / unknown)
- [ ] Fix inherited record errors found during research: F06 convertible closed at $4.2bn (2.875%, due 2033), not
      $3.7bn; R075 links DDTL 3.0 to Oracle although its source says OpenAI; R213 "67% of 2025 revenue" needs a source

## Blockers / next steps
1. Owner to supply the SEC contact string for the `SEC_USER_AGENT` secret.
2. After the Q3 2026 filing (results 2026-11-10), confirm the fetcher picks up the new 10-Q and update manual series
   (power MW, undrawn facilities, CDS/bond marks).

## Verification
- `npm test`, `npx tsc -b`, `npx oxlint src scripts` pass.
- `?node=CoreWeave` shows the panel above the records table; no horizontal scroll at 390 px.
- Snapshot figures match the Q2 2026 10-Q: revenue $2.575bn, H1 OCF $3.66bn, H1 capex $14.1bn, cash $5.52bn,
  debt principal $35.55bn with maturities 4.41 / 6.18 / 4.42 / 2.42 / 3.22 / 14.90 ($bn).
