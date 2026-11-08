import { useEffect, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import type { Core, ElementDefinition } from 'cytoscape';
import type { Release } from './lib/types';
import { LAYERS } from './lib/types';
import { LAYER_STYLE, nodeMap } from './lib/model';
import { EDGE_WIDTH, bandLabels, labelFont, nodeModel, readableLines, routeEdge, type BandLabel } from './lib/geometry';
import { POSITION_VIEW, type VisibleGraph } from './lib/selection';

interface Props {
  release: Release; vis: VisibleGraph; layout: 'fixed' | 'relayout'; selected: string[]; edge: string | null;
  onNode: (id: string) => void; onEdge: (id: string | null) => void;
}
interface DrawnNode { id: string; lines: string[]; kind: string; cls: string; left: number; top: number; w: number; h: number; font: number }
interface DrawnBand { id: string; title: string; left: number; top: number }

export default function Graph({ release, vis, layout, selected, edge, onNode, onEdge }: Props) {
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
      const cls = ['dim', 'focus', 'shared'].filter((k) => n.hasClass(k)).join(' ');
      return { id: n.id(), lines, kind: String(n.data('kind') ?? ''), cls, left: rp.x - w / 2, top: rp.y - h / 2, w, h, font: labelFont(lines, w, h) };
    }));
    const specs = (c.scratch('bands') as BandLabel[]) ?? [];
    setBands(specs.map((b) => ({ id: b.id, title: b.title, left: b.x * z + pan.x, top: b.y * z + pan.y })));
  };

  useEffect(() => () => { cy.current?.destroy(); cy.current = null; }, []);

  // Rebuild elements whenever the visible set or layout mode changes.
  const key = `${layout}|${vis.nodeIds.join(',')}|${vis.edges.map((e) => e.id).join(',')}`;
  useEffect(() => {
    const pos = release.views[POSITION_VIEW];
    const core = new Set(release.graph.core);
    const nm = nodeMap(release);
    const els: ElementDefinition[] = vis.nodeIds.filter((id) => pos.nodes[id]).map((id) => {
      const m = nodeModel(pos.nodes[id].box);
      const kind = nm.get(id)?.kind ?? 'company';
      return { group: 'nodes', data: { id, lines: readableLines(pos.nodes[id].label || id), kind, w: m.w, h: m.h }, position: { x: m.x, y: m.y }, classes: core.has(id) ? 'core' : kind };
    });
    for (const e of vis.edges) {
      const route = layout === 'fixed' ? pos.edges[e.id] : undefined;
      const routed = route ? routeEdge(pos.nodes[e.from].box, pos.nodes[e.to].box, route) : null;
      els.push({ group: 'edges', data: { id: e.id, source: e.from, target: e.to, layer: e.layer, ...(routed ?? {}) }, classes: `${e.layer}${e.october_change ? ' oct' : ''}${routed ? ' routed' : ''}` });
    }
    // Band titles describe the overview's columns; with a selection they would be placed from a partial set and collide.
    const bandsFor = layout === 'fixed' && !selected.length ? bandLabels(vis.nodeIds.filter((id) => pos.nodes[id]).map((id) => ({ id, kind: nm.get(id)?.kind ?? 'company', box: pos.nodes[id].box }))) : [];

    if (!cy.current) {
      cy.current = cytoscape({
        container: el.current, elements: [], layout: { name: 'preset' }, wheelSensitivity: 0.25, minZoom: 0.15, maxZoom: 4,
        boxSelectionEnabled: false, autoungrabify: true,
        style: ([
          { selector: 'node', style: { shape: 'round-rectangle', 'corner-radius': 3, width: 'data(w)', height: 'data(h)', 'background-color': '#FFFDFB', 'border-width': 1.25, 'border-color': '#D3C2B2', label: '', 'z-index': 10 } },
          { selector: 'node.core', style: { 'background-color': '#E5F1EF', 'border-color': '#2A757C', 'border-width': 2.4 } },
          { selector: 'node.project', style: { 'background-color': '#FFFCF8', 'border-color': '#E0D0C2', 'border-width': 1 } },
          { selector: 'node.funding_category', style: { 'border-style': 'dashed', 'border-color': '#B7A394' } },
          { selector: 'edge', style: { width: EDGE_WIDTH, 'curve-style': 'bezier', 'control-point-step-size': 40, opacity: 0.82, 'arrow-scale': 0.85, 'target-arrow-shape': 'triangle', 'z-index': 1 } },
          { selector: 'edge.routed', style: { 'curve-style': 'unbundled-bezier', 'edge-distances': 'endpoints', 'control-point-weights': 'data(cpw)', 'control-point-distances': 'data(cpd)', 'source-endpoint': 'data(sep)', 'target-endpoint': 'data(tep)' } },
          ...LAYERS.map((l) => ({ selector: `edge.${l}`, style: { 'line-color': LAYER_STYLE[l].color, 'target-arrow-color': LAYER_STYLE[l].color, 'line-style': LAYER_STYLE[l].dash, ...(LAYER_STYLE[l].pattern ? { 'line-dash-pattern': LAYER_STYLE[l].pattern } : {}), 'target-arrow-shape': LAYER_STYLE[l].arrow } })),
          { selector: 'edge.affiliation', style: { opacity: 0.5 } },
          { selector: 'edge.financing', style: { opacity: 0.62 } },
          { selector: 'edge.oct', style: { 'underlay-color': '#D8912B', 'underlay-opacity': 0.28, 'underlay-padding': 2 } },
          { selector: '.dim', style: { opacity: 0.08 } },
          { selector: 'node.focus', style: { 'border-color': '#D8912B', 'border-width': 3.4, 'z-index': 12 } },
          { selector: 'node.shared', style: { 'border-color': '#241F1B', 'border-width': 2.6, 'background-color': '#F6E7CF' } },
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
    if (layout === 'relayout' && els.length) {
      // Concentric: selected companies in the middle, shared counterparties on the inner ring, the rest outside.
      // With nothing selected, the most connected companies sit in the middle.
      const sel = new Set(selected), sh = new Set(vis.shared);
      const deg = new Map<string, number>(); for (const e of vis.edges) { deg.set(e.from, (deg.get(e.from) ?? 0) + 1); deg.set(e.to, (deg.get(e.to) ?? 0) + 1); }
      const level = (id: string) => sel.size ? (sel.has(id) ? 3 : sh.has(id) ? 2 : 1) : Math.min(4, Math.floor((deg.get(id) ?? 0) / 4) + 1);
      c.layout({ name: 'concentric', animate: false, fit: false, avoidOverlap: true, minNodeSpacing: 18, spacingFactor: 1.05, startAngle: -Math.PI / 2,
        concentric: (n: cytoscape.NodeSingular) => level(n.id()), levelWidth: () => 1 } as unknown as cytoscape.LayoutOptions).run();
    }
    if (els.length) c.fit(undefined, 46);
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [release, key]);

  // Highlight classes: selected companies, shared counterparties, edges between selected, selected edge.
  useEffect(() => {
    const c = cy.current; if (!c) return;
    c.batch(() => {
      c.elements().removeClass('dim focus shared between sel');
      for (const id of selected) c.getElementById(id).addClass('focus');
      for (const id of vis.shared) c.getElementById(id).addClass('shared');
      for (const id of vis.between) c.getElementById(id).addClass('between');
      if (edge) {
        const e = c.getElementById(edge);
        if (e.nonempty()) { c.elements().not(e.connectedNodes().union(e)).addClass('dim'); e.addClass('sel'); }
      }
    });
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, selected.join('|'), vis.shared.join('|'), edge]);

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
      {!vis.nodeIds.length && <div className="graph-empty">Pick companies in the list to draw their relationships, or turn on <b>Show all</b>.</div>}
      <div className="zoom">
        <button onClick={() => cy.current?.zoom({ level: cy.current.zoom() * 1.25, renderedPosition: { x: el.current!.clientWidth / 2, y: el.current!.clientHeight / 2 } })} aria-label="Zoom in">+</button>
        <button onClick={() => cy.current?.zoom({ level: cy.current.zoom() / 1.25, renderedPosition: { x: el.current!.clientWidth / 2, y: el.current!.clientHeight / 2 } })} aria-label="Zoom out">−</button>
        <button onClick={() => cy.current?.fit(undefined, 46)} aria-label="Fit">Fit</button>
      </div>
    </div>
  );
}
