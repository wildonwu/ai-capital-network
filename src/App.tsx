import { useCallback, useEffect, useMemo, useState } from 'react';
import Graph from './Graph';
import Mechanisms from './Mechanisms';
import { loadRelease } from './lib/data';
import type { GraphEdge, Layer, Release } from './lib/types';
import { LAYERS } from './lib/types';
import {
  LAYER_STYLE, DEFAULT_FILTERS, type Filters, directionWords, exportCSV, exportJSON, filtersToQuery, formatAmount,
  humanStatus, nodeMap, queryToFilters, safeUrls, searchNodes, shortAmount, tableEdges, visibleEdges,
} from './lib/model';

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
  const [f, setF] = useState<Filters>(DEFAULT_FILTERS);
  const [q, setQ] = useState('');
  const [mobileTab, setMobileTab] = useState<'list' | 'graph'>('list');

  useEffect(() => {
    loadRelease().then((r) => { setRelease(r); setF(queryToFilters(location.search, r)); }).catch((e) => setError(String(e.message ?? e)));
  }, []);

  useEffect(() => {
    if (!release) return;
    const qs = filtersToQuery(f, release.manifest.release_id);
    history.replaceState(null, '', `${location.pathname}?${qs}`);
  }, [f, release]);

  const clear = useCallback(() => setF((p) => ({ ...p, node: null, edge: null })), []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { clear(); setQ(''); } };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [clear]);

  const nodes = useMemo(() => (release ? nodeMap(release) : new Map()), [release]);
  const visible = useMemo(() => (release ? visibleEdges(release, f) : []), [release, f]);
  const rows = useMemo(() => (release ? tableEdges(release, f) : []), [release, f]);
  const results = useMemo(() => (release ? searchNodes(release, q, f.view).slice(0, 12) : []), [release, q, f.view]);

  if (error) return <div className="fatal"><h1>Release could not be loaded</h1><pre>{error}</pre><p>No partial or unvalidated data is displayed.</p></div>;
  if (!release) return <div className="loading">Loading validated release…</div>;

  const m = release.manifest;
  const view = release.views[f.view];
  const selEdge = f.edge ? release.graph.edges.find((e) => e.id === f.edge) ?? null : null;
  const selNode = f.node ? nodes.get(f.node) : null;
  const name = (id: string) => nodes.get(id)?.label_en ?? id;

  const focusNode = (id: string | null) => {
    setF((p) => {
      if (id && !release.views[p.view].node_ids.includes(id)) return { ...p, view: 'full-network', node: id, edge: null };
      return { ...p, node: id, edge: null };
    });
    if (id) setMobileTab('list');
  };
  const selectEdge = (id: string | null) => setF((p) => ({ ...p, edge: id }));
  const toggleLayer = (l: Layer) => setF((p) => ({ ...p, layers: p.layers.includes(l) ? p.layers.filter((x) => x !== l) : LAYERS.filter((x) => p.layers.includes(x) || x === l) }));
  const stamp = m.release_id.replace(/[^\w-]+/g, '_');

  const incoming = selNode ? visible.filter((e) => e.to === selNode.id) : [];
  const outgoing = selNode ? visible.filter((e) => e.from === selNode.id) : [];
  const hiddenIncident = selNode ? release.graph.edges.filter((e) => (e.from === selNode.id || e.to === selNode.id)).length - incoming.length - outgoing.length : 0;

  const EdgeLine = ({ e, dir }: { e: GraphEdge; dir: 'in' | 'out' }) => (
    <li><button className={`rel ${f.edge === e.id ? 'on' : ''}`} onClick={() => selectEdge(e.id)}>
      <LayerSwatch l={e.layer} /> <span className="rel-l">{dir === 'out' ? '→ ' + name(e.to) : '← ' + name(e.from)}</span>
      <span className="rel-a">{shortAmount(e)}</span>{e.october_change && <span className="badge oct">Oct change</span>}
    </button></li>
  );

  return (
    <div className={`app tab-${mobileTab}`}>
      <header className="masthead">
        <div className="kicker"><span>THE AI CAPITAL NETWORK</span><span>OCTOBER 2026 · INTRA-MONTH PREVIEW</span></div>
        <h1>{f.view === 'full-network' ? 'Who funds the AI boom — and who buys the capacity?' : 'The companies and capital behind the AI build-out'}</h1>
        <p className="dek">{f.view === 'full-network'
          ? 'Investors are also suppliers. Customers hold equity. Credit support connects the technology giants to a web of projects.'
          : 'Equity, procurement and credit support link the major AI companies to financial providers and financing vehicles.'}</p>
        <p className="meta"><strong>{view.node_ids.length} {f.view === 'companies-network' ? 'company / financing-channel nodes' : 'nodes'} · {view.edge_ids.length} directed relationships</strong>
          {f.view === 'companies-network' ? ' · Individual sites and project facilities excluded' : ' · project sites in the side columns'}
          {' '}({m.counts.nodes} nodes / {m.counts.relationships} records in release) · showing {visible.length} after filters</p>
        <p className="cutoff" data-testid="cutoff">Intra-month October preview — research cutoff <b>2026-10-28 17:04:34 UTC</b> (2026-10-29 01:04 Asia/Taipei). Not a month-end release. Release <code>{m.release_id}</code>{release.hashVerified ? ' · hashes verified' : ' · hashes not verified (no WebCrypto)'}</p>
      </header>

      <section className="controls" aria-label="Controls">
        <div className="seg" role="group" aria-label="View">
          <button className={f.view === 'companies-network' ? 'on' : ''} onClick={() => setF((p) => ({ ...p, view: 'companies-network', node: p.node && release.views['companies-network'].node_ids.includes(p.node) ? p.node : null, edge: null }))}>Companies &amp; capital channels (36)</button>
          <button className={f.view === 'full-network' ? 'on' : ''} onClick={() => setF((p) => ({ ...p, view: 'full-network' }))}>Full network (91)</button>
        </div>
        <div className="search">
          <input type="search" placeholder="Search entity (English / 中文)…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search entities" />
          {results.length > 0 && <ul className="results" role="listbox">{results.map((n) => (
            <li key={n.id}><button onClick={() => { focusNode(n.id); setQ(''); }}>{n.label_en}{n.label_raw !== n.label_en && <small> {n.label_raw}</small>} <em>{n.kind}{!view.node_ids.includes(n.id) ? ' · full network' : ''}</em></button></li>))}</ul>}
        </div>
        <label className="oct-toggle"><input type="checkbox" checked={f.octOnly} onChange={(e) => setF((p) => ({ ...p, octOnly: e.target.checked }))} /> October-change records only</label>
        <div className="exports">
          <button onClick={() => download(`acn-${stamp}-${f.view}.csv`, exportCSV(release, f), 'text/csv')}>Export CSV</button>
          <button onClick={() => download(`acn-${stamp}-${f.view}.json`, exportJSON(release, f), 'application/json')}>Export JSON</button>
        </div>
      </section>

      <section className="legend" aria-label="Relationship layers (click to filter)">
        {LAYERS.map((l) => {
          const n = visibleEdges(release, { ...f, layers: [l] }).length;
          return <button key={l} className={`lg ${f.layers.includes(l) ? 'on' : 'off'}`} aria-pressed={f.layers.includes(l)} onClick={() => toggleLayer(l)} title={LAYER_STYLE[l].desc}>
            <LayerSwatch l={l} /> {LAYER_STYLE[l].name} <span className="n">{n}</span></button>;
        })}
        <span className="lg-note"><span className="octswatch" /> October-change accent · constant line widths (width never encodes amount)</span>
      </section>

      <div className="mobile-tabs" role="tablist">
        <button className={mobileTab === 'list' ? 'on' : ''} onClick={() => setMobileTab('list')}>List &amp; details</button>
        <button className={mobileTab === 'graph' ? 'on' : ''} onClick={() => setMobileTab('graph')}>Graph</button>
      </div>

      <main className="main">
        <div className="graph-col"><Graph release={release} filters={f} onNode={focusNode} onEdge={(id) => { selectEdge(id); if (id) setMobileTab('list'); }} /></div>
        <aside className={`detail${selNode || selEdge ? ' open' : ''}`} aria-live="polite">
          {!selNode && !selEdge && <div className="hint"><h2>Explore</h2><p>Click or search an entity to see its incoming and outgoing relationships. Click a line or a table row for the exact record and sources. <kbd>Esc</kbd> clears.</p><p className="small">{release.graph.data_quality_notice}</p></div>}
          {selEdge && <EdgeDetail e={selEdge} release={release} name={name} onClose={() => selectEdge(null)} nodesMap={nodes} />}
          {selNode && <div className="node-detail">
            <div className="eyebrow">{selNode.kind}{release.graph.core.includes(selNode.id) ? ' · core company' : ''}</div>
            <h2>{selNode.label_en}</h2>
            {selNode.label_raw !== selNode.label_en && <p className="raw">Original label: {selNode.label_raw}</p>}
            {release.graph.coverage[selNode.id] && <p className="small">Coverage note (raw): {release.graph.coverage[selNode.id]}</p>}
            <h3>Outgoing ({outgoing.length})</h3><ul className="rels">{outgoing.map((e) => <EdgeLine key={e.id} e={e} dir="out" />)}</ul>
            <h3>Incoming ({incoming.length})</h3><ul className="rels">{incoming.map((e) => <EdgeLine key={e.id} e={e} dir="in" />)}</ul>
            {hiddenIncident > 0 && <p className="small">{hiddenIncident} more relationship record(s) hidden by the current view/filters.</p>}
            <button className="link" onClick={clear}>Clear focus (Esc)</button>
          </div>}
        </aside>
      </main>

      <Mechanisms release={release} />

      <section className="table-sec">
        <h2>Relationship records <span className="count" data-testid="row-count">{rows.length}</span>{selNode && <> involving {selNode.label_en}</>}</h2>
        <div className="table-scroll">
          <table>
            <thead><tr><th>ID</th><th>Layer</th><th>From</th><th>To</th><th>Amount</th><th>Status (raw)</th><th>Label (raw)</th><th>Source</th></tr></thead>
            <tbody>{rows.map((e) => (
              <tr key={e.id} className={f.edge === e.id ? 'on' : ''} tabIndex={0} onClick={() => selectEdge(e.id)} onKeyDown={(ev) => { if (ev.key === 'Enter') selectEdge(e.id); }}>
                <td>{e.id}{e.october_change && <span className="badge oct">Oct</span>}</td>
                <td><LayerSwatch l={e.layer} /> {e.layer}</td><td>{name(e.from)}</td><td>{name(e.to)}</td>
                <td className={e.amount === null ? 'unk' : ''}>{e.amount === null ? 'not disclosed' : shortAmount(e)}</td>
                <td>{humanStatus(e.status)}</td><td className="lbl">{e.label}</td><td>{e.source}</td>
              </tr>))}</tbody>
          </table>
        </div>
      </section>

      <footer className="foot">
        <p><b>Reading the map.</b> Arrows follow the labelled economic role, not always cash. Line pattern and arrowhead distinguish all seven layers; colour groups procurement/delivery and warrants/support as in the reference. Null amounts mean “not disclosed”, never zero. “Up to” amounts are maxima; contract values are not cash paid. Do not sum amounts across rows — one contract can generate several edges.</p>
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
        <dt>Source</dt><dd><code>{e.source}</code>{src && <> · access: {src.access} · published: {src.published_at || "unknown"}{src.date_precision ? ` (${src.date_precision})` : ""}</>}</dd>
        {src?.quote && <><dt>Source excerpt (not necessarily verbatim)</dt><dd className="excerpt">{src.quote}</dd></>}
        <dt>Source URLs</dt><dd>{safeUrls(src?.urls).length ? <ul className="urls">{safeUrls(src?.urls).map((u) => <li key={u}><a href={u} target="_blank" rel="noopener noreferrer">{u}</a></li>)}</ul> : 'No public URL in registry'}</dd>
      </dl>
      {parallels.length > 0 && <p className="small">Parallel records between these entities: {parallels.map((p) => p.id).join(', ')}</p>}
      <button className="link" onClick={onClose}>Close record</button>
    </div>
  );
}
