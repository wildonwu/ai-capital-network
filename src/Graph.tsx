import { useEffect, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import type { Core, ElementDefinition } from 'cytoscape';
import type { Release } from './lib/types';
import { LAYERS } from './lib/types';
import { LAYER_STYLE } from './lib/model';
import { EDGE_WIDTH, bandLabels, labelFont, nodeModel, routeEdge, type BandLabel } from './lib/geometry';
import { POSITION_VIEW, type VisibleGraph } from './lib/selection';
import { displayGraph, type DisplayNode } from './lib/display';
import { boxFor, egoLayout, tierLayout, type LayoutMode } from './lib/layouts';

interface Props {
  release: Release; vis: VisibleGraph; layout: LayoutMode; selected: string[]; edge: string | null; expanded: Set<string>;
  labelOf: (id: string) => string; onNode: (id: string) => void; onEdge: (id: string | null) => void;
}
interface DrawnNode { id: string; lines: string[]; kind: string; cls: string; left: number; top: number; w: number; h: number; font: number }
interface DrawnBand { id: string; title: string; left: number; top: number }

export default function Graph({ release, vis, layout: chosen, selected, edge, expanded, labelOf, onNode, onEdge }: Props) {
  // The overview always uses the editorial positions; the other layouts are for selections.
  const layout: LayoutMode = selected.length ? chosen : 'fixed';
  const el = useRef<HTMLDivElement>(null);
  const cy = useRef<Core | null>(null);
  const cb = useRef({ onNode, onEdge });
  cb.current = { onNode, onEdge };
  const [nodes, setNodes] = useState<DrawnNode[]>([]);
  const [bands, setBands] = useState<DrawnBand[]>([]);

  const paint = () => {
    const c = cy.current; if (!c) return;
    const z = c.zoom(), pan = c.pan();
    setNodes(c.nodes().map((n) => {
      const rp = n.renderedPosition(), w = n.width() * z, h = n.height() * z;
      const lines = (n.data('lines') as string[]) ?? [];
      const cls = ['dim', 'focus', 'shared', 'combo', 'round'].filter((k) => n.hasClass(k)).join(' ');
      return { id: n.id(), lines, kind: String(n.data('kind') ?? ''), cls, left: rp.x - w / 2, top: rp.y - h / 2, w, h, font: labelFont(lines, w * (n.hasClass('round') ? 0.8 : 1), h) };
    }));
    const specs = (c.scratch('bands') as BandLabel[]) ?? [];
    setBands(specs.map((b) => ({ id: b.id, title: b.title, left: b.x * z + pan.x, top: b.y * z + pan.y })));
  };

  useEffect(() => () => { cy.current?.destroy(); cy.current = null; }, []);

  const key = `${layout}|${vis.nodeIds.join(',')}|${vis.edges.map((e) => e.id).join(',')}|${[...expanded].join(',')}|${selected.join(',')}`;
  const sharedRef = useRef<string[]>([]);
  useEffect(() => {
    const pos = release.views[POSITION_VIEW];
    const sel = new Set(selected);
    const els: ElementDefinition[] = [];
    let bandsFor: BandLabel[] = [];
    const nodeLabel = (n: DisplayNode) => n.lines[0];

    if (layout === 'fixed') {
      // Editorial coordinates, no merging (project boxes have their own fixed places).
      const g = displayGraph(release, vis, labelOf, expanded, selected, false);
      for (const n of g.nodes) {
        const m = nodeModel(pos.nodes[n.id].box);
        els.push({ group: 'nodes', data: { id: n.id, lines: n.lines, kind: n.kind, w: m.w, h: m.h }, position: { x: m.x, y: m.y }, classes: n.core ? 'core' : n.kind });
      }
      for (const e of g.edges) {
        const route = pos.edges[e.id];
        const routed = route && e.count === 1 ? routeEdge(pos.nodes[e.source].box, pos.nodes[e.target].box, route) : null;
        els.push({ group: 'edges', data: { id: e.id, ids: e.ids, source: e.source, target: e.target, label: selected.length ? e.label : '', ...(routed ?? {}) }, classes: `${e.layer}${e.october ? ' oct' : ''}${routed ? ' routed' : ''}` });
      }
      if (!selected.length) bandsFor = bandLabels(g.nodes.map((n) => ({ id: n.id, kind: n.kind, box: pos.nodes[n.id].box })));
      sharedRef.current = vis.shared;
    } else {
      const g = displayGraph(release, vis, labelOf, expanded, selected);
      // Shared counterparties on the drawn graph (a merged project box can be shared).
      const touch = new Map<string, Set<string>>();
      for (const e of g.edges) for (const [a, b] of [[e.source, e.target], [e.target, e.source]]) if (sel.has(a) && !sel.has(b)) touch.set(b, new Set([...(touch.get(b) ?? []), a]));
      const shared = new Set([...touch].filter(([, s]) => s.size >= 2).map(([id]) => id));
      sharedRef.current = [...shared];
      const placed = layout === 'ego' ? egoLayout(g, selected, shared, nodeLabel) : layout === 'tiers' ? tierLayout(g, selected, nodeLabel) : null;
      for (const n of g.nodes) {
        const size = placed?.size.get(n.id) ?? boxFor(n, sel.has(n.id), true);
        const p = placed?.pos.get(n.id) ?? { x: 0, y: 0 };
        els.push({ group: 'nodes', data: { id: n.id, lines: n.lines, kind: n.kind, w: size.w, h: size.h }, position: p, classes: [n.core ? 'core' : n.kind, n.combo ? 'combo' : '', layout === 'bubble' ? 'round' : ''].join(' ') });
      }
      for (const e of g.edges) els.push({ group: 'edges', data: { id: e.id, ids: e.ids, source: e.source, target: e.target, label: e.label }, classes: `${e.layer}${e.october ? ' oct' : ''}` });
      bandsFor = (placed?.headers ?? []).map((h) => ({ id: h.id, title: h.title, x: h.x, y: h.y }));
    }

    if (!cy.current) {
      cy.current = cytoscape({
        container: el.current, elements: [], layout: { name: 'preset' }, wheelSensitivity: 0.25, minZoom: 0.1, maxZoom: 2.2,
        boxSelectionEnabled: false, autoungrabify: true,
        style: ([
          { selector: 'node', style: { shape: 'round-rectangle', 'corner-radius': 4, width: 'data(w)', height: 'data(h)', 'background-color': '#FFFDFB', 'border-width': 1.4, 'border-color': '#D3C2B2', label: '', 'z-index': 10 } },
          { selector: 'node.core', style: { 'background-color': '#E5F1EF', 'border-color': '#2A757C', 'border-width': 2.4 } },
          { selector: 'node.project', style: { 'background-color': '#FFFCF8', 'border-color': '#E0D0C2', 'border-width': 1 } },
          { selector: 'node.combo', style: { 'border-style': 'double', 'border-width': 4, 'border-color': '#B7A394', 'background-color': '#FBF5EC' } },
          { selector: 'node.round', style: { shape: 'ellipse' } },
          { selector: 'node.funding_category', style: { 'border-style': 'dashed', 'border-color': '#B7A394' } },
          { selector: 'edge', style: { width: EDGE_WIDTH, 'curve-style': 'bezier', 'control-point-step-size': 26, opacity: 0.85, 'arrow-scale': 0.9, 'target-arrow-shape': 'triangle', 'z-index': 1,
            label: 'data(label)', 'font-size': 12, 'font-weight': 600, color: '#3b342e', 'text-background-color': '#F7EDE1', 'text-background-opacity': 0.92, 'text-background-padding': '2px', 'min-zoomed-font-size': 7 } },
          { selector: 'edge.routed', style: { 'curve-style': 'unbundled-bezier', 'edge-distances': 'endpoints', 'control-point-weights': 'data(cpw)', 'control-point-distances': 'data(cpd)', 'source-endpoint': 'data(sep)', 'target-endpoint': 'data(tep)' } },
          ...LAYERS.map((l) => ({ selector: `edge.${l}`, style: { 'line-color': LAYER_STYLE[l].color, 'target-arrow-color': LAYER_STYLE[l].color, 'line-style': LAYER_STYLE[l].dash, ...(LAYER_STYLE[l].pattern ? { 'line-dash-pattern': LAYER_STYLE[l].pattern } : {}), 'target-arrow-shape': LAYER_STYLE[l].arrow } })),
          { selector: 'edge.affiliation', style: { opacity: 0.55 } },
          { selector: 'edge.oct', style: { 'underlay-color': '#D8912B', 'underlay-opacity': 0.28, 'underlay-padding': 2 } },
          { selector: '.dim', style: { opacity: 0.08 } },
          { selector: 'node.focus', style: { 'border-color': '#D8912B', 'border-width': 3.6, 'z-index': 12 } },
          { selector: 'node.shared', style: { 'border-color': '#241F1B', 'border-width': 2.8, 'background-color': '#F6E7CF' } },
          { selector: 'edge.between', style: { width: EDGE_WIDTH + 1.6, opacity: 1, 'z-index': 6 } },
          { selector: 'edge.sel', style: { width: EDGE_WIDTH + 1.4, opacity: 1, 'z-index': 8, 'underlay-color': '#D8912B', 'underlay-opacity': 0.45, 'underlay-padding': 3 } },
        ] as unknown as cytoscape.StylesheetJson),
      });
      cy.current.on('tap', 'node', (ev) => cb.current.onNode(ev.target.id()));
      cy.current.on('tap', 'edge', (ev) => cb.current.onEdge(ev.target.id()));
      cy.current.on('tap', (ev) => { if (ev.target === cy.current) cb.current.onEdge(null); });
      cy.current.on('pan zoom resize', () => paint());
      (window as unknown as { __cy: Core }).__cy = cy.current;
    }
    const c = cy.current;
    c.batch(() => { c.elements().remove(); c.add(els); });
    c.scratch('bands', bandsFor);
    if (layout === 'bubble' && els.length) {
      c.layout({ name: 'cose', animate: false, randomize: true, fit: false, idealEdgeLength: () => 90, nodeRepulsion: () => 600000, edgeElasticity: () => 120,
        nodeOverlap: 30, gravity: 60, numIter: 3000, componentSpacing: 60, nestingFactor: 1 } as unknown as cytoscape.LayoutOptions).run();
    }
    if (els.length) c.fit(undefined, layout === 'fixed' ? 40 : 28);
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [release, key]);

  useEffect(() => {
    const c = cy.current; if (!c) return;
    const sel = new Set(selected);
    c.batch(() => {
      c.elements().removeClass('dim focus shared between sel');
      for (const id of selected) c.getElementById(id).addClass('focus');
      for (const id of sharedRef.current) c.getElementById(id).addClass('shared');
      c.edges().forEach((e) => { if (sel.has(e.source().id()) && sel.has(e.target().id())) e.addClass('between'); });
      if (edge) {
        const e = c.edges().filter((x) => x.id() === edge || ((x.data('ids') as string[] | undefined) ?? []).includes(edge));
        if (e.nonempty()) { c.elements().not(e.connectedNodes().union(e)).addClass('dim'); e.addClass('sel'); }
      }
    });
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, edge]);

  useEffect(() => {
    const ro = new ResizeObserver(() => { cy.current?.resize(); paint(); });
    if (el.current) ro.observe(el.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="graph-wrap">
      <div ref={el} className="graph" role="img" aria-label="Relationship graph. Use the relationship table for keyboard access." />
      <div className="band-layer" aria-hidden="true">
        {bands.map((b) => <div key={b.id} className="band-label" style={{ left: b.left, top: b.top }}>{b.title}</div>)}
      </div>
      <div className="label-layer" aria-hidden="true">
        {nodes.map((n) => (
          <div key={n.id} className={`node-label ${n.kind} ${n.cls}`} style={{ left: n.left, top: n.top, width: n.w, height: n.h, fontSize: n.font }}>
            {n.lines.map((line, i) => <span key={i}>{line}</span>)}
          </div>
        ))}
      </div>
      {!vis.nodeIds.length && <div className="graph-empty">Pick companies in the list to draw their relationships, or tick <b>Show all</b>.</div>}
      <div className="zoom">
        <button onClick={() => cy.current?.zoom({ level: cy.current.zoom() * 1.25, renderedPosition: { x: el.current!.clientWidth / 2, y: el.current!.clientHeight / 2 } })} aria-label="Zoom in">+</button>
        <button onClick={() => cy.current?.zoom({ level: cy.current.zoom() / 1.25, renderedPosition: { x: el.current!.clientWidth / 2, y: el.current!.clientHeight / 2 } })} aria-label="Zoom out">−</button>
        <button onClick={() => cy.current?.fit(undefined, 28)} aria-label="Fit">Fit</button>
      </div>
    </div>
  );
}
