# AI Capital Network — Phase 1 (read-only interactive site)

Static Vite + React + TypeScript + Cytoscape.js site built from the handoff starter package
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

## Known data gaps / limitations

- 159/213 edges have no `deal_id`; 115 have unknown amounts (shown as “not disclosed”, never 0).
- Many edge labels/notes, node IDs and coverage notes are Chinese only; shown raw — no reviewed English translation yet.
- `status` is the raw mixed legal/evidence/attribution string; not yet split into separate dimensions, so no legal-stage/cash/evidence filters.
- `october_change` does not say *why* (new event vs backfill vs correction); the UI says so.
- Source `published_at` precision is heterogeneous; shown raw. Source URLs were not re-fetched/validated.
- Full-network project labels include editorial amount callouts taken from the view manifest (historical principal/facility).
- Not implemented (Phase 2+): release history/comparison, refresh polling, deal/project pages, two-hop expansion,
  mechanism story cards, band section headers, image/SVG export, reference-style curved routing (Cytoscape auto bezier is used, not the manifest control points).
