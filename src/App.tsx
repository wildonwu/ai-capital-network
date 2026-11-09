import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FlowGraph from './FlowGraph';
import Mechanisms from './Mechanisms';
import CompanyPanel from './CompanyPanel';
import CreditCards from './CreditCards';
import CompanyList from './CompanyList';
import { loadRelease } from './lib/data';
import { loadMarket, type MarketSnapshot } from './lib/market';
import type { GraphEdge, Layer, Release } from './lib/types';
import { LAYERS } from './lib/types';
import { LAYER_STYLE, directionWords, exportCSVFor, exportJSONFor, formatAmount, humanStatus, nodeMap, safeUrls, shortAmount } from './lib/model';
import { DEFAULT_SELECTION, queryToSelection, selectionToQuery, toggle, visibleGraph, type Selection } from './lib/selection';
import { shortName } from './lib/tickers';
import { CATEGORIES, categoryOf, type CategoryId } from './lib/categories';
import { CAT_SHORT, FLOW_COLOR, FLOW_NAME, FLOW_OF, MAX_SELECTED, flowLayout, fmtBn, payerOf, usdBn, type Flow } from './lib/flow';

/** "$300bn" for dollar amounts, the record's own unit otherwise (GW, shares, percent). */
const amountOf = (e: GraphEdge) => { const a = usdBn(e); return a !== null ? fmtBn(a) : shortAmount(e); };

function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function FlowSwatch({ f }: { f: Flow }) {
  return <svg width="26" height="8" aria-hidden="true"><line x1="1" y1="4" x2="25" y2="4" stroke={FLOW_COLOR[f]} strokeWidth={f === 'guar' ? 2.5 : 4} strokeDasharray={f === 'guar' ? '5 4' : f === 'other' ? '2 4' : undefined} strokeLinecap="round" /></svg>;
}
const Dot = ({ l }: { l: Layer }) => <span className="dot" style={{ background: FLOW_COLOR[FLOW_OF[l]] }} />;

/** Width of an element, kept current on resize (callback ref, so it attaches whenever the element mounts). */
function useWidth<T extends HTMLElement>() {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 1280 : Math.min(1280, window.innerWidth - 32)));
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    ro.current?.disconnect();
    if (!el) return;
    setW(Math.round(el.getBoundingClientRect().width));
    ro.current = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.current.observe(el);
  }, []);
  return [ref, w] as const;
}

/** True while the viewport matches the media query. */
function useMedia(q: string) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => { const mq = window.matchMedia(q); const h = () => setM(mq.matches); mq.addEventListener('change', h); return () => mq.removeEventListener('change', h); }, [q]);
  return m;
}

export default function App() {
  const [release, setRelease] = useState<Release | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [s, setS] = useState<Selection>(DEFAULT_SELECTION);
  const [market, setMarket] = useState<MarketSnapshot | null>(null);
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const [focusCat, setFocusCat] = useState<CategoryId | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<string>('between');
  const [stageRef, stageW] = useWidth<HTMLDivElement>();
  // The company drawer beside the graph can be folded away to give the graph the full width;
  // the choice is remembered in this browser only.
  const [drawerOpen, setDrawerOpen] = useState(() => { try { return localStorage.getItem('acn.drawer') !== 'collapsed'; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem('acn.drawer', drawerOpen ? 'open' : 'collapsed'); } catch { /* storage unavailable */ } }, [drawerOpen]);
  // On a narrow screen a selection opens scrolled to the selected companies in the middle.
  const selKey = s.selected.join('|');
  const centre = useCallback((el: HTMLDivElement | null) => { if (el && selKey) requestAnimationFrame(() => { el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2; }); }, [selKey]);

  useEffect(() => {
    loadRelease().then((r) => { setRelease(r); setS(queryToSelection(location.search, r)); }).catch((e) => setError(String(e.message ?? e)));
  }, []);
  useEffect(() => { loadMarket().then(setMarket); }, []);
  useEffect(() => {
    if (!release) return;
    history.replaceState(null, '', `${location.pathname}?${selectionToQuery(s, release.manifest.release_id)}${location.hash}`);
  }, [s, release]);
  const clearEdge = useCallback(() => setS((p) => ({ ...p, edge: null })), []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') clearEdge(); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [clearEdge]);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 4000); return () => clearTimeout(t); }, [notice]);

  const nodes = useMemo(() => (release ? nodeMap(release) : new Map()), [release]);
  const vis = useMemo(() => (release ? visibleGraph(release, s) : null), [release, s]);
  const phone = useMedia('(max-width: 900px)');
  const narrow = phone || stageW < 700;
  const single = s.selected.length === 1;
  const showDrawer = single && !narrow && drawerOpen;
  // Phones keep the drawing at full size and scroll sideways rather than shrinking text below legibility.
  const graphW = s.selected.length ? Math.max(narrow ? 780 : 640, stageW - (showDrawer ? 320 : single && !narrow ? 34 : 0)) : Math.max(narrow ? 1180 : 980, stageW);
  const flow = useMemo(() => (release && vis ? flowLayout(release, vis, s.selected, graphW) : null), [release, vis, s.selected, graphW]);

  if (error) return <div className="fatal"><h1>Release could not be loaded</h1><pre>{error}</pre><p>No partial or unvalidated data is displayed.</p></div>;
  if (!release || !vis || !flow) return <div className="loading">Loading validated release…</div>;

  const m = release.manifest;
  const name = (id: string) => shortName(nodes.get(id), id);
  const rows = vis.edges;
  const selEdge = s.edge ? release.graph.edges.find((e) => e.id === s.edge) ?? null : null;
  const toggleNode = (id: string) => {
    if (!s.selected.includes(id) && s.selected.length >= MAX_SELECTED) { setNotice(`Up to ${MAX_SELECTED} companies can be compared at once — remove one first.`); return; }
    setS((p) => ({ ...p, selected: toggle(p.selected, id, MAX_SELECTED), edge: null }));
    setTab('between'); setFocusCat(null);
  };
  const clearSel = () => setS((p) => ({ ...p, selected: [], edge: null }));
  const toggleLayer = (l: Layer) => setS((p) => ({ ...p, layers: p.layers.includes(l) ? p.layers.filter((x) => x !== l) : LAYERS.filter((x) => p.layers.includes(x) || x === l) }));
  const stamp = m.release_id.replace(/[^\w-]+/g, '_');
  const scope = s.selected.length ? `selected=${s.selected.join('|')}` : s.showAll ? 'overview=companies' : 'blank';
  const cdsCompanies = market ? Object.values(market.companies).filter((c) => c.cds && c.cds.status !== 'missing' && c.cds.series?.length) : [];
  const alerts = cdsCompanies.filter((c) => c.cds?.inversion?.alert.active);
  const widest = [...cdsCompanies].sort((a, b) => b.cds!.series!.at(-1)!.spread_bp - a.cds!.series!.at(-1)!.spread_bp)[0];
  const dataTo = cdsCompanies.reduce((d, c) => (c.cds!.series!.at(-1)!.date > d ? c.cds!.series!.at(-1)!.date : d), '');
  const panels = market ? s.selected.map((id) => market.companies[id]).filter(Boolean) : [];
  const overviewIds = release.views['companies-network'].node_ids;
  const catCount = (c: CategoryId) => overviewIds.filter((id) => categoryOf(nodes.get(id)!) === c).length;
  const relsOf = (id: string) => rows.filter((e) => e.from === id || e.to === id).sort((p, q) => (usdBn(q) ?? -1) - (usdBn(p) ?? -1));
  const RelRow = ({ e, me }: { e: GraphEdge; me: string }) => (
    <button className={`rel${s.edge === e.id ? ' on' : ''}`} onClick={() => setS((p) => ({ ...p, edge: e.id }))}>
      <span className="rel-l"><Dot l={e.layer} />{payerOf(e) === me ? '→' : '←'} <b>{name(e.from === me ? e.to : e.from)}</b><small>{LAYER_STYLE[e.layer].name.toLowerCase()} · {humanStatus(e.status)}</small></span>
      <span className="rel-a">{e.amount === null ? '—' : amountOf(e)}</span>
    </button>
  );

  return (
    <div className="app">
      <header className="top"><div className="wrap top-in">
        <span className="brand">AI CAPITAL NETWORK</span>
        <nav className="nav"><a href="#network">Network</a><a href="#credit">Credit</a><a href="#records">Records</a><a href="#method">Method</a></nav>
        {alerts.map((c) => { const al = c.cds!.inversion!.alert; return <a key={c.node_id} className="alert-pill" href="#credit" role="alert" title="Short tenors trade thinly; check the trades before acting.">
          <i />{name(c.node_id)} CDS curve inverted since {al.since} — {al.short!.map((x) => `${x.tenor} ${x.spread_bp.toLocaleString('en-US')} bp`).join(', ')} &gt; 5Y {al.five_bp!.toLocaleString('en-US')} bp</a>; })}
        {dataTo && <span className="asof">Market data to {dataTo}</span>}
      </div></header>

      <div className="wrap">
        <section className="hero">
          <div>
            <h1>Who funds the AI boom — and who is exposed if it slows?</h1>
            <p className="lede">Money, compute and guarantees between the companies at the centre of AI capex. Line width is the disclosed amount. Click a company in the list or on the map to trace its links; add up to {MAX_SELECTED} to see where they meet.</p>
          </div>
          <div className="kpis">
            <div><b>{overviewIds.length}</b><span>companies</span></div>
            <div><b>{m.counts.relationships}</b><span>relationship records</span></div>
            {widest && <div><b className="hot">{Math.round(widest.cds!.series!.at(-1)!.spread_bp).toLocaleString('en-US')}</b><span>{name(widest.node_id)} 5Y CDS, bp</span></div>}
          </div>
        </section>

        <section id="network" className="controls" aria-label="Pick companies">
          {s.selected.length > 0 && <span className="chip on sel">{s.selected.map((id, i) => <span key={id}>{i > 0 && ' + '}<button className="chip-x" onClick={() => toggleNode(id)} aria-label={`Remove ${name(id)}`}>{name(id)} ×</button></span>)}</span>}
          <button className={`chip${!s.selected.length && !focusCat ? ' on' : ''}`} onClick={() => { clearSel(); setFocusCat(null); setS((p) => ({ ...p, showAll: true })); }}>All {overviewIds.length}</button>
          {CATEGORIES.map((c) => <button key={c.id} className={`chip${focusCat === c.id ? ' on' : ''}`} title={c.hint} onClick={() => { if (s.selected.length) clearSel(); setFocusCat((f) => (f === c.id ? null : c.id)); }}>{CAT_SHORT[c.id]} <span className="n">{catCount(c.id)}</span></button>)}
        </section>
        {notice && <p className="notice" role="status">{notice}</p>}
        <div className="legend">
          {(['money', 'goods', 'guar'] as Flow[]).map((f) => <span key={f}><FlowSwatch f={f} />{FLOW_NAME[f]}</span>)}
          <span className="note">Thicker = larger disclosed amount · thin = not disclosed · click a line for its record</span>
        </div>

        <div className="netgrid">
        {phone ? <details className="cl-fold"><summary>Companies by category{s.selected.length ? ` · ${s.selected.length} selected` : ''}</summary><CompanyList release={release} selected={s.selected} shared={vis.shared} max={MAX_SELECTED} onToggle={toggleNode} onClear={clearSel} /></details>
          : <CompanyList release={release} selected={s.selected} shared={vis.shared} max={MAX_SELECTED} onToggle={toggleNode} onClear={clearSel} />}
        <div className={`stage${showDrawer ? ' with-drawer' : ''}`} ref={stageRef}>
          {!s.selected.length && !s.showAll ? <p className="empty">Pick a company above, or click All to see the whole network.</p>
            : <div className="stage-scroll" ref={centre}>{narrow && <p className="swipe">{s.selected.length ? 'Swipe sideways for both sides' : 'Swipe sideways to see the whole network · tap a company to focus on it'}</p>}<FlowGraph f={flow} focusCat={s.selected.length ? null : focusCat} activeEdge={s.edge} onNode={toggleNode} onEdge={(id) => setS((p) => ({ ...p, edge: id }))} /></div>}
          {single && !narrow && !drawerOpen && !selEdge && <button className="drawer-tab" onClick={() => setDrawerOpen(true)} aria-label="Show company details" title="Show details"><span aria-hidden="true">‹</span><em>Details</em></button>}
          {(selEdge || showDrawer) && <aside className={`drawer${selEdge ? ' record' : ''}`} aria-live="polite">
            {selEdge ? <EdgeDetail e={selEdge} release={release} name={name} onClose={clearEdge} nodesMap={nodes} />
              : (() => { const id = s.selected[0], n = nodes.get(id)!, rels = relsOf(id); return <>
                <button className="close" onClick={clearSel} aria-label="Clear selection">×</button>
                <button className="collapse" onClick={() => setDrawerOpen(false)} aria-label="Collapse company details" title="Collapse — show the full graph">›</button>
                <h3>{name(id)}</h3><p className="sub">{n.label_en.replace(/\n.*/s, '') !== name(id) ? n.label_en.replace(/\n.*/s, '') + ' · ' : ''}{CAT_SHORT[categoryOf(n)]} · {rels.length} relationships</p>
                <div className="sect">Largest links</div>
                {rels.slice(0, 10).map((e) => <RelRow key={e.id} e={e} me={id} />)}
                {rels.length > 10 && <p className="small">+ {rels.length - 10} more in the records below</p>}
                <p className="small">Amounts are per record and are not added up: one contract can appear in several records.</p>
              </>; })()}
          </aside>}
        </div>
        </div>

        {(s.selected.length > 1 || (single && narrow)) && <section className="panel" aria-label="Selection details">
          <div className="tabs" role="tablist">
            {s.selected.length > 1 && <button role="tab" aria-selected={tab === 'between'} className={tab === 'between' ? 'on' : ''} onClick={() => setTab('between')}>Between them</button>}
            {s.selected.map((id) => <button key={id} role="tab" aria-selected={tab === id || (single && true)} className={tab === id || single ? 'on' : ''} onClick={() => setTab(id)}>{name(id)}</button>)}
            <button className="tabs-x" onClick={clearSel}>Clear selection ×</button>
          </div>
          {s.selected.length > 1 && tab === 'between' ? (() => {
            const between = rows.filter((e) => s.selected.includes(e.from) && s.selected.includes(e.to)).sort((p, q) => (usdBn(q) ?? -1) - (usdBn(p) ?? -1));
            const shared = vis.shared.map((id) => ({ id, by: flow.groups.get(id) ?? [] })).sort((a, b) => b.by.length - a.by.length);
            return <div className="pgrid">
              <div><div className="sect">Direct links</div>
                {between.map((e) => <button key={e.id} className={`rel${s.edge === e.id ? ' on' : ''}`} onClick={() => setS((p) => ({ ...p, edge: e.id }))}><span className="rel-l"><Dot l={e.layer} /><b>{name(e.from)}</b> → <b>{name(e.to)}</b><small>{LAYER_STYLE[e.layer].name.toLowerCase()} · {humanStatus(e.status)}</small></span><span className="rel-a">{e.amount === null ? '—' : amountOf(e)}</span></button>)}
                {!between.length && <p className="small">No direct link recorded between them.</p>}
                {vis.unlinkedPairs.map(([a, b]) => <p key={a + b} className="unlinked">No recorded contractual link between {name(a)} and {name(b)}, directly or through a shared counterparty (coverage is partial; market contagion is not modelled).</p>)}
              </div>
              <div><div className="sect">Shared counterparties · {shared.length}</div>
                {shared.length ? <table className="shtab"><thead><tr><th></th>{s.selected.map((id) => <th key={id}>{name(id)}</th>)}</tr></thead>
                  <tbody>{shared.map(({ id }) => <tr key={id}><td><b>{name(id)}</b></td>{s.selected.map((me) => {
                    const es = rows.filter((e) => (e.from === id && e.to === me) || (e.from === me && e.to === id));
                    return <td key={me}>{es.length ? es.map((e) => <button key={e.id} className="pill" style={{ color: FLOW_COLOR[FLOW_OF[e.layer]] }} onClick={() => setS((p) => ({ ...p, edge: e.id }))}>{payerOf(e) === me ? '→' : '←'} {e.amount !== null ? amountOf(e) : 'n/d'}</button>) : <span className="na">—</span>}</td>;
                  })}</tr>)}</tbody></table> : <p className="small">None.</p>}
                <p className="small">→ the selected company pays it · ← it pays, funds or backs the selected company · n/d = amount not disclosed</p>
              </div>
            </div>;
          })() : (() => { const id = single ? s.selected[0] : tab; const rels = relsOf(id); return <div className="plist">{rels.map((e) => <RelRow key={e.id} e={e} me={id} />)}</div>; })()}
        </section>}

        {panels.map((c) => <CompanyPanel key={c.node_id} c={c} today={today} />)}

        {cdsCompanies.length > 0 && <section id="credit" className="sec" aria-label="Credit stress"><CreditCards companies={cdsCompanies} tickerOf={name} /></section>}

        <section className="folds">
          <details className="fold"><summary>Three mechanisms behind the network<span>investor → customer · credit support → equity · capital → equipment → lease</span></summary><Mechanisms release={release} /></details>
          <details className="fold" id="records" open={!!s.edge && false}><summary>Relationship records <span className="count" data-testid="row-count">{rows.length}</span><span>{s.selected.length ? `involving ${s.selected.map(name).join(' + ')}` : 'amounts, status and sources'}</span></summary>
            <div className="rec-tools">
              <div className="layer-filter" aria-label="Relationship layers (click to filter)">{LAYERS.map((l) => <button key={l} className={`lg ${s.layers.includes(l) ? 'on' : 'off'}`} aria-pressed={s.layers.includes(l)} onClick={() => toggleLayer(l)} title={LAYER_STYLE[l].desc}><Dot l={l} />{LAYER_STYLE[l].name}</button>)}</div>
              <label className="oct-toggle"><input type="checkbox" checked={s.octOnly} onChange={(e) => setS((p) => ({ ...p, octOnly: e.target.checked }))} /> October-change records only</label>
              <span className="exports">
                <button onClick={() => download(`acn-${stamp}.csv`, exportCSVFor(release, rows, scope), 'text/csv')}>Export CSV</button>
                <button onClick={() => download(`acn-${stamp}.json`, exportJSONFor(release, rows, { selection: s.selected, show_all: s.showAll, layers: s.layers, october_change_only: s.octOnly }), 'application/json')}>Export JSON</button>
              </span>
            </div>
            {rows.length > 0 && <div className="table-scroll"><table>
              <thead><tr><th>ID</th><th>Layer</th><th>From</th><th>To</th><th>Amount</th><th>Status</th><th>Label (raw)</th><th>Source</th></tr></thead>
              <tbody>{rows.map((e) => (
                <tr key={e.id} className={`${s.edge === e.id ? 'on' : ''}${vis.between.includes(e.id) ? ' between' : ''}`} tabIndex={0} onClick={() => setS((p) => ({ ...p, edge: e.id }))} onKeyDown={(ev) => { if (ev.key === 'Enter') setS((p) => ({ ...p, edge: e.id })); }}>
                  <td>{e.id}{e.october_change && <span className="badge oct">Oct</span>}</td>
                  <td><Dot l={e.layer} />{e.layer}</td><td>{name(e.from)}</td><td>{name(e.to)}</td>
                  <td className={e.amount === null ? 'unk' : ''}>{e.amount === null ? 'not disclosed' : amountOf(e)}</td>
                  <td>{humanStatus(e.status)}</td><td className="lbl">{e.label}</td><td>{e.source}</td>
                </tr>))}</tbody>
            </table></div>}
          </details>
          <details className="fold" id="method"><summary>Method &amp; sources<span>research cut-off 28 Oct 2026 · DTCC, SEC, US Treasury</span></summary>
            <div className="method">
              <p className="cutoff" data-testid="cutoff">Intra-month October preview — research cutoff <b>2026-10-28 17:04:34 UTC</b> (2026-10-29 01:04 Asia/Taipei). Not a month-end release. Release <code>{m.release_id}</code>{release.hashVerified ? ' · hashes verified' : ' · hashes not verified (no WebCrypto)'}. {m.counts.nodes} entities, {m.counts.relationships} relationship records; the overview shows the {overviewIds.length} companies at the centre.</p>
              <p><b>Reading the map.</b> Arrows follow the labelled economic role, not always cash: purchases point from buyer to supplier, deliveries from provider to recipient. Line colour groups the seven record layers into money (equity, debt), compute (purchase, delivery) and guarantees &amp; options (credit support, warrants). Null amounts mean “not disclosed”, never zero. “Up to” amounts are maxima; contract values are not cash paid. Do not sum amounts across rows — one contract can generate several records. No line between two companies means no recorded contractual link in this dataset, not that one is immune to the other.</p>
              <p><b>Credit.</b> CDS levels are derived from public DTCC trade reports with the ISDA standard model and the US Treasury curve; they are not dealer quotes. Share prices from Yahoo Finance; financials from SEC filings.</p>
              <p className="small">{release.graph.data_quality_notice} {m.coverage_note}</p>
            </div>
          </details>
        </section>
        <footer className="foot small">Research illustration, not investment advice. Not affiliated with any publication.</footer>
      </div>
    </div>
  );
}

function EdgeDetail({ e, release, name, onClose, nodesMap }: { e: GraphEdge; release: Release; name: (id: string) => string; onClose: () => void; nodesMap: Map<string, import('./lib/types').GraphNode> }) {
  const src = release.sources[e.source];
  const parallels = release.graph.edges.filter((x) => x.id !== e.id && ((x.from === e.from && x.to === e.to) || (x.from === e.to && x.to === e.from)));
  return (
    <div className="edge-detail" data-testid="edge-detail">
      <button className="close" onClick={onClose} aria-label="Close record">×</button>
      <div className="eyebrow"><Dot l={e.layer} /> {LAYER_STYLE[e.layer].name} · record {e.id}{e.deal_id ? ` · deal ${e.deal_id}` : ''}</div>
      <h3>{name(e.from)} → {name(e.to)}</h3>
      <p className="dir">{directionWords(e, nodesMap)}.</p>
      <dl>
        <dt>Amount</dt><dd className={e.amount === null ? 'unk' : 'amt'}>{formatAmount(e)}</dd>
        <dt>Status</dt><dd>{humanStatus(e.status)}</dd>
        <dt>Label (raw)</dt><dd>{e.label || '—'}</dd>
        <dt>Note (raw)</dt><dd>{e.note || '—'}</dd>
        {e.october_change && <><dt>October change</dt><dd>Flagged as changed in this preview (new event, backfill or correction)</dd></>}
        <dt>Source</dt><dd><code>{e.source}</code>{src && <> · {src.access} · published {src.published_at || 'unknown'}{src.date_precision ? ` (${src.date_precision})` : ''}</>}</dd>
        {src?.quote && <><dt>Source excerpt</dt><dd className="excerpt">{src.quote}</dd></>}
        <dt>Source URLs</dt><dd>{safeUrls(src?.urls).length ? <ul className="urls">{safeUrls(src?.urls).map((u) => <li key={u}><a href={u} target="_blank" rel="noopener noreferrer">{u}</a></li>)}</ul> : 'No public URL in registry'}</dd>
      </dl>
      {parallels.length > 0 && <p className="small">Other records between these two: {parallels.map((p) => p.id).join(', ')}</p>}
    </div>
  );
}
