import { useCallback, useEffect, useMemo, useState } from 'react';
import Graph from './Graph';
import Mechanisms from './Mechanisms';
import CompanyPanel from './CompanyPanel';
import CompanyList from './CompanyList';
import CdsChart from './CdsChart';
import { loadRelease } from './lib/data';
import { loadMarket, type MarketSnapshot } from './lib/market';
import type { GraphEdge, Layer, Release } from './lib/types';
import { LAYERS } from './lib/types';
import { LAYER_STYLE, directionWords, exportCSVFor, exportJSONFor, formatAmount, humanStatus, nodeMap, safeUrls, shortAmount } from './lib/model';
import { DEFAULT_SELECTION, queryToSelection, selectionToQuery, toggle, visibleGraph, type Selection } from './lib/selection';

function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function LayerSwatch({ l }: { l: Layer }) {
  const s = LAYER_STYLE[l];
  const dash = s.dash === 'dotted' ? '1.5 2.5' : s.pattern ? s.pattern.map((x) => x / 1.5).join(' ') : undefined;
  return <svg width="28" height="8" aria-hidden="true"><line x1="0" y1="4" x2="28" y2="4" stroke={s.color} strokeWidth="2" strokeDasharray={dash} strokeLinecap={s.dash === 'dotted' ? 'round' : 'butt'} /></svg>;
}

export default function App() {
  const [release, setRelease] = useState<Release | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [s, setS] = useState<Selection>(DEFAULT_SELECTION);
  const [mobileTab, setMobileTab] = useState<'list' | 'graph'>('graph');
  const [market, setMarket] = useState<MarketSnapshot | null>(null);
  const [today] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    loadRelease().then((r) => { setRelease(r); setS(queryToSelection(location.search, r)); }).catch((e) => setError(String(e.message ?? e)));
  }, []);
  useEffect(() => { loadMarket().then(setMarket); }, []);
  useEffect(() => {
    if (!release) return;
    history.replaceState(null, '', `${location.pathname}?${selectionToQuery(s, release.manifest.release_id)}`);
  }, [s, release]);

  const clearEdge = useCallback(() => setS((p) => ({ ...p, edge: null })), []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') clearEdge(); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [clearEdge]);

  const nodes = useMemo(() => (release ? nodeMap(release) : new Map()), [release]);
  const vis = useMemo(() => (release ? visibleGraph(release, s) : null), [release, s]);

  if (error) return <div className="fatal"><h1>Release could not be loaded</h1><pre>{error}</pre><p>No partial or unvalidated data is displayed.</p></div>;
  if (!release || !vis) return <div className="loading">Loading validated release…</div>;

  const m = release.manifest;
  const name = (id: string) => nodes.get(id)?.label_en?.replace(/\n.*/s, '') ?? id;
  const rows = vis.edges;
  const selEdge = s.edge ? release.graph.edges.find((e) => e.id === s.edge) ?? null : null;
  const toggleNode = (id: string) => setS((p) => ({ ...p, selected: toggle(p.selected, id), edge: null }));
  const toggleLayer = (l: Layer) => setS((p) => ({ ...p, layers: p.layers.includes(l) ? p.layers.filter((x) => x !== l) : LAYERS.filter((x) => p.layers.includes(x) || x === l) }));
  const stamp = m.release_id.replace(/[^\w-]+/g, '_');
  const scope = s.selected.length ? `selected=${s.selected.join('|')}` : s.showAll ? 'overview=companies' : 'blank';
  const focus = s.selected.at(-1) ?? null;
  const cdsCompanies = market ? Object.values(market.companies).filter((c) => c.cds && c.cds.status !== 'missing' && (c.cds.tenors || c.cds.series)) : [];
  const panels = market ? s.selected.map((id) => market.companies[id]).filter(Boolean) : [];

  const EdgeLine = ({ e, dir, who }: { e: GraphEdge; dir: 'in' | 'out'; who: string }) => (
    <li><button className={`rel ${s.edge === e.id ? 'on' : ''}`} onClick={() => setS((p) => ({ ...p, edge: e.id }))}>
      <LayerSwatch l={e.layer} /> <span className="rel-l">{dir === 'out' ? `${name(who)} → ${name(e.to)}` : `${name(who)} ← ${name(e.from)}`}</span>
      <span className="rel-a">{shortAmount(e)}</span>{e.october_change && <span className="badge oct">Oct change</span>}
    </button></li>
  );

  return (
    <div className={`app tab-${mobileTab}`}>
      {cdsCompanies.filter((c) => c.cds?.inversion?.alert.active).map((c) => {
        const al = c.cds!.inversion!.alert;
        return <div key={c.node_id} className="alert-banner" role="alert">
          <b>⚠ {c.name}: CDS curve inverted</b> since {al.since} — {al.short!.map((x) => `${x.tenor} ${x.spread_bp.toLocaleString('en-US')} bp (${x.days} trading days)`).join(', ')} above 5Y {al.five_bp!.toLocaleString('en-US')} bp, medians of the last 5 sessions to {al.as_of}. Short tenors trade thinly; check the trades before acting.
          <a className="link" href="#credit-monitor">See the curve</a>
        </div>;
      })}
      <header className="masthead">
        <div className="kicker"><span>THE AI CAPITAL NETWORK</span><span>OCTOBER 2026 · INTRA-MONTH PREVIEW</span></div>
        <h1>Who funds the AI boom — and who is exposed if it slows?</h1>
        <p className="dek">Pick companies on the left to draw their direct relationships. Pick several to see where they meet: shared counterparties are highlighted, and companies with no recorded link are flagged.</p>
        <p className="meta"><strong>{m.counts.nodes} entities · {m.counts.relationships} relationship records</strong> · showing {vis.nodeIds.length} entities / {rows.length} records</p>
        <p className="cutoff" data-testid="cutoff">Intra-month October preview — research cutoff <b>2026-10-28 17:04:34 UTC</b> (2026-10-29 01:04 Asia/Taipei). Not a month-end release. Release <code>{m.release_id}</code>{release.hashVerified ? ' · hashes verified' : ' · hashes not verified (no WebCrypto)'}</p>
      </header>

      {cdsCompanies.length > 0 && <section id="credit-monitor" className="credit-monitor" aria-label="Credit monitor">
        <h2>Credit monitor <small>single-name CDS from public DTCC trade reports</small></h2>
        {cdsCompanies.map((c) => <div key={c.node_id} className="cm-company">
          <div className="cm-name"><b>{c.name}</b> <button className="link" onClick={() => setS((p) => ({ ...p, selected: p.selected.includes(c.node_id) ? p.selected : [...p.selected, c.node_id] }))}>Show in network</button></div>
          <CdsChart cds={c.cds!} price={c.price.history ?? []} events={c.chart_events ?? []} alertPeriods={c.cds!.inversion?.periods ?? []} />
        </div>)}
      </section>}

      <section className="controls" aria-label="Controls">
        <div className="seg" role="group" aria-label="With nothing selected">
          <button className={s.showAll ? 'on' : ''} aria-pressed={s.showAll} onClick={() => setS((p) => ({ ...p, showAll: true }))}>Show all</button>
          <button className={!s.showAll ? 'on' : ''} aria-pressed={!s.showAll} onClick={() => setS((p) => ({ ...p, showAll: false }))}>Blank</button>
        </div>
        <div className="seg" role="group" aria-label="Layout">
          <button className={s.layout === 'fixed' ? 'on' : ''} onClick={() => setS((p) => ({ ...p, layout: 'fixed' }))}>Fixed positions</button>
          <button className={s.layout === 'relayout' ? 'on' : ''} onClick={() => setS((p) => ({ ...p, layout: 'relayout' }))}>Re-layout</button>
        </div>
        <label className="oct-toggle"><input type="checkbox" checked={s.octOnly} onChange={(e) => setS((p) => ({ ...p, octOnly: e.target.checked }))} /> October-change records only</label>
        <div className="exports">
          <button onClick={() => download(`acn-${stamp}.csv`, exportCSVFor(release, rows, scope), 'text/csv')}>Export CSV</button>
          <button onClick={() => download(`acn-${stamp}.json`, exportJSONFor(release, rows, { selection: s.selected, show_all: s.showAll, layers: s.layers, october_change_only: s.octOnly }), 'application/json')}>Export JSON</button>
        </div>
      </section>

      <section className="legend" aria-label="Relationship layers (click to filter)">
        {LAYERS.map((l) => {
          const n = visibleGraph(release, { ...s, layers: [l] }).edges.length;
          return <button key={l} className={`lg ${s.layers.includes(l) ? 'on' : 'off'}`} aria-pressed={s.layers.includes(l)} onClick={() => toggleLayer(l)} title={LAYER_STYLE[l].desc}>
            <LayerSwatch l={l} /> {LAYER_STYLE[l].name} <span className="n">{n}</span></button>;
        })}
        <span className="lg-note"><span className="octswatch" /> October-change accent · <span className="sharedswatch" /> shared counterparty · constant line widths</span>
      </section>

      <div className="mobile-tabs" role="tablist">
        <button className={mobileTab === 'list' ? 'on' : ''} onClick={() => setMobileTab('list')}>Companies</button>
        <button className={mobileTab === 'graph' ? 'on' : ''} onClick={() => setMobileTab('graph')}>Graph &amp; details</button>
      </div>

      <main className="main three">
        <CompanyList release={release} selected={s.selected} shared={vis.shared} onToggle={(id) => { toggleNode(id); setMobileTab('graph'); }} onClear={() => setS((p) => ({ ...p, selected: [], edge: null }))} />
        <div className="graph-col">
          {s.selected.length > 0 && <div className="sel-bar">
            {s.selected.map((id) => <button key={id} className="sel-chip" onClick={() => toggleNode(id)} title="Remove">{name(id)} ×</button>)}
            {vis.unlinkedPairs.map(([a, b]) => <span key={a + b} className="unlinked">No recorded contractual link between {name(a)} and {name(b)} in this dataset (coverage is partial; market contagion is not modelled).</span>)}
            {vis.shared.length > 0 && <span className="shared-note">Shared counterparties: {vis.shared.map(name).join(', ')}</span>}
          </div>}
          <Graph release={release} vis={vis} layout={s.layout} selected={s.selected} edge={s.edge} onNode={toggleNode} onEdge={(id) => setS((p) => ({ ...p, edge: id }))} />
        </div>
        <aside className={`detail${focus || selEdge ? ' open' : ''}`} aria-live="polite">
          {!focus && !selEdge && <div className="hint"><h2>Explore</h2><p>Click companies in the list (or on the graph) to add them. Click a line or a table row for the exact record and sources. Clicking a selected company again removes it. <kbd>Esc</kbd> closes a record.</p><p className="small">{release.graph.data_quality_notice}</p></div>}
          {selEdge && <EdgeDetail e={selEdge} release={release} name={name} onClose={clearEdge} nodesMap={nodes} />}
          {!selEdge && focus && (() => {
            const out = rows.filter((e) => e.from === focus), inc = rows.filter((e) => e.to === focus);
            const n = nodes.get(focus)!;
            return <div className="node-detail">
              <div className="eyebrow">{n.kind}{release.graph.core.includes(focus) ? ' · core company' : ''}{s.selected.length > 1 ? ` · last of ${s.selected.length} selected` : ''}</div>
              <h2>{name(focus)}</h2>
              {n.label_raw !== n.label_en && <p className="raw">Original label: {n.label_raw}</p>}
              {release.graph.coverage[focus] && <p className="small">Coverage note (raw): {release.graph.coverage[focus]}</p>}
              <h3>Outgoing ({out.length})</h3><ul className="rels">{out.map((e) => <EdgeLine key={e.id} e={e} dir="out" who={focus} />)}</ul>
              <h3>Incoming ({inc.length})</h3><ul className="rels">{inc.map((e) => <EdgeLine key={e.id} e={e} dir="in" who={focus} />)}</ul>
            </div>;
          })()}
        </aside>
      </main>

      <Mechanisms release={release} />

      {panels.map((c) => <CompanyPanel key={c.node_id} c={c} today={today} />)}

      <section className="table-sec">
        <h2>Relationship records <span className="count" data-testid="row-count">{rows.length}</span>{s.selected.length > 0 && <> involving {s.selected.map(name).join(' + ')}</>}</h2>
        {!rows.length && <p className="small">Nothing selected. Pick companies on the left or switch to Show all.</p>}
        {rows.length > 0 && <div className="table-scroll">
          <table>
            <thead><tr><th>ID</th><th>Layer</th><th>From</th><th>To</th><th>Amount</th><th>Status (raw)</th><th>Label (raw)</th><th>Source</th></tr></thead>
            <tbody>{rows.map((e) => (
              <tr key={e.id} className={`${s.edge === e.id ? 'on' : ''}${vis.between.includes(e.id) ? ' between' : ''}`} tabIndex={0} onClick={() => setS((p) => ({ ...p, edge: e.id }))} onKeyDown={(ev) => { if (ev.key === 'Enter') setS((p) => ({ ...p, edge: e.id })); }}>
                <td>{e.id}{e.october_change && <span className="badge oct">Oct</span>}</td>
                <td><LayerSwatch l={e.layer} /> {e.layer}</td><td>{name(e.from)}</td><td>{name(e.to)}</td>
                <td className={e.amount === null ? 'unk' : ''}>{e.amount === null ? 'not disclosed' : shortAmount(e)}</td>
                <td>{humanStatus(e.status)}</td><td className="lbl">{e.label}</td><td>{e.source}</td>
              </tr>))}</tbody>
          </table>
        </div>}
      </section>

      <footer className="foot">
        <p><b>Reading the map.</b> Arrows follow the labelled economic role, not always cash. Line pattern and arrowhead distinguish all seven layers. Null amounts mean “not disclosed”, never zero. “Up to” amounts are maxima; contract values are not cash paid. Do not sum amounts across rows — one contract can generate several edges. No line between two companies means no recorded contractual link in this dataset, not that one is immune to the other.</p>
        <p className="small">{m.coverage_note} Historical illustration inspired by financial-editorial design; not affiliated with any publication.</p>
      </footer>
    </div>
  );
}

function EdgeDetail({ e, release, name, onClose, nodesMap }: { e: GraphEdge; release: Release; name: (id: string) => string; onClose: () => void; nodesMap: Map<string, import('./lib/types').GraphNode> }) {
  const src = release.sources[e.source];
  const parallels = release.graph.edges.filter((x) => x.id !== e.id && ((x.from === e.from && x.to === e.to) || (x.from === e.to && x.to === e.from)));
  return (
    <div className="edge-detail" data-testid="edge-detail">
      <div className="eyebrow"><LayerSwatch l={e.layer} /> {LAYER_STYLE[e.layer].name} · record {e.id}{e.deal_id ? ` · deal ${e.deal_id}` : ' · no deal ID linked'}</div>
      <h2>{name(e.from)} → {name(e.to)}</h2>
      <p className="dir"><b>Direction:</b> {directionWords(e, nodesMap)}.</p>
      <dl>
        <dt>Amount</dt><dd className={e.amount === null ? 'unk' : 'amt'}>{formatAmount(e)}</dd>
        <dt>Status (raw)</dt><dd><code>{e.status}</code></dd>
        <dt>Label (raw)</dt><dd>{e.label || '—'}</dd>
        <dt>Note (raw)</dt><dd>{e.note || '—'}</dd>
        <dt>October change</dt><dd>{e.october_change ? 'Flagged as changed in this preview (reason not classified: may be new event, backfill or correction)' : 'No'}</dd>
        <dt>Source</dt><dd><code>{e.source}</code>{src && <> · access: {src.access} · published: {src.published_at || 'unknown'}{src.date_precision ? ` (${src.date_precision})` : ''}</>}</dd>
        {src?.quote && <><dt>Source excerpt (not necessarily verbatim)</dt><dd className="excerpt">{src.quote}</dd></>}
        <dt>Source URLs</dt><dd>{safeUrls(src?.urls).length ? <ul className="urls">{safeUrls(src?.urls).map((u) => <li key={u}><a href={u} target="_blank" rel="noopener noreferrer">{u}</a></li>)}</ul> : 'No public URL in registry'}</dd>
      </dl>
      {parallels.length > 0 && <p className="small">Parallel records between these entities: {parallels.map((p) => p.id).join(', ')}</p>}
      <button className="link" onClick={onClose}>Close record</button>
    </div>
  );
}
