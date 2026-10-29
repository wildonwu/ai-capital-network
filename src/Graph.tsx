import { useEffect, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import type { Core, ElementDefinition } from 'cytoscape';
import type { Release } from './lib/types';
import { LAYERS } from './lib/types';
import { LAYER_STYLE, visibleEdges, type Filters } from './lib/model';
import { EDGE_WIDTH, bandLabels, labelFont, nodeModel, readableLines, routeEdge, type BandLabel } from './lib/geometry';

interface Props { release: Release; filters: Filters; onNode: (id: string | null) => void; onEdge: (id: string | null) => void }

interface DrawnNode {
  id: string; lines: string[]; kind: string; dim: boolean; focus: boolean;
  left: number; top: number; w: number; h: number; font: number;
}
interface DrawnBand { id: string; title: string; left: number; top: number }

export default function Graph({ release, filters, onNode, onEdge }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const cy = useRef<Core | null>(null);
  const cb = useRef({ onNode, onEdge });
  cb.current = { onNode, onEdge };
  const [nodes, setNodes] = useState<DrawnNode[]>([]);
  const [bands, setBands] = useState<DrawnBand[]>([]);

  const paint = () => {
    const c = cy.current;
    if (!c) return;
    const z = c.zoom();
    const pan = c.pan();
    setNodes(c.nodes().map((n) => {
      const rp = n.renderedPosition();
      const w = n.width() * z;
      const h = n.height() * z;
      const lines = (n.data('lines') as string[]) ?? [];
      return {
        id: n.id(), lines, kind: String(n.data('kind') ?? ''),
        dim: n.hasClass('dim'), focus: n.hasClass('focus'),
        left: rp.x - w / 2, top: rp.y - h / 2, w, h,
        font: labelFont(lines, w, h),
      };
    }));
    const specs = (c.scratch('bands') as BandLabel[]) ?? [];
    setBands(specs.map((b) => ({ id: b.id, title: b.title, left: b.x * z + pan.x, top: b.y * z + pan.y })));
  };

  useEffect(() => {
    return () => { cy.current?.destroy(); cy.current = null; };
  }, []);

  useEffect(() => {
    const view = release.views[filters.view];
    const core = new Set(release.graph.core);
    const kinds = new Map(release.graph.nodes.map((n) => [n.id, n.kind]));
    const els: ElementDefinition[] = view.node_ids.map((id) => {
      const box = view.nodes[id].box;
      const m = nodeModel(box);
      const label = view.nodes[id].label || id;
      const nkind = kinds.get(id) ?? 'company';
      return {
        group: 'nodes',
        data: { id, lines: readableLines(label), kind: nkind, w: m.w, h: m.h },
        position: { x: m.x, y: m.y },
        classes: [core.has(id) ? 'core' : nkind].join(' '),
      };
    });
    for (const e of visibleEdges(release, filters)) {
      const route = view.edges[e.id];
      const routed = route ? routeEdge(view.nodes[e.from].box, view.nodes[e.to].box, route) : null;
      els.push({
        group: 'edges',
        data: { id: e.id, source: e.from, target: e.to, layer: e.layer, ...(routed ?? {}) },
        classes: `${e.layer}${e.october_change ? ' oct' : ''}${routed ? ' routed' : ''}`,
      });
    }
    const bandsForView = bandLabels(view.node_ids.map((id) => ({ id, kind: kinds.get(id) ?? 'company', box: view.nodes[id].box })));

    if (!cy.current) {
      cy.current = cytoscape({
        container: el.current, elements: els, layout: { name: 'preset' }, wheelSensitivity: 0.25, minZoom: 0.15, maxZoom: 4,
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
          { selector: 'edge.hl', style: { opacity: 1, 'z-index': 4 } },
          { selector: 'node.hl', style: { 'border-color': '#292524', 'border-width': 2.2 } },
          { selector: 'node.focus', style: { 'border-color': '#D8912B', 'border-width': 3.2, 'z-index': 12 } },
          { selector: 'edge.sel', style: { width: EDGE_WIDTH + 1.4, opacity: 1, 'z-index': 8, 'underlay-color': '#D8912B', 'underlay-opacity': 0.45, 'underlay-padding': 3 } },
        ] as unknown as cytoscape.StylesheetJson),
      });
      cy.current.on('tap', 'node', (ev) => cb.current.onNode(ev.target.id()));
      cy.current.on('tap', 'edge', (ev) => cb.current.onEdge(ev.target.id()));
      cy.current.on('tap', (ev) => { if (ev.target === cy.current) { cb.current.onNode(null); cb.current.onEdge(null); } });
      cy.current.on('pan zoom resize', () => paint());
      (window as unknown as { __cy: Core }).__cy = cy.current;
    } else {
      const c = cy.current;
      const prevView = c.scratch('view');
      c.batch(() => { c.elements().remove(); c.add(els); });
      if (prevView !== filters.view) c.fit(undefined, 46);
    }
    cy.current.scratch('view', filters.view);
    cy.current.scratch('bands', bandsForView);
    if (!cy.current.scratch('fitted')) { cy.current.fit(undefined, 46); cy.current.scratch('fitted', true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [release, filters.view, filters.layers.join(','), filters.octOnly]);

  useEffect(() => {
    const c = cy.current; if (!c) return;
    c.batch(() => {
      c.elements().removeClass('dim hl focus sel');
      if (filters.node) {
        const n = c.getElementById(filters.node);
        if (n.nonempty()) {
          const nb = n.closedNeighborhood();
          c.elements().not(nb).addClass('dim');
          nb.addClass('hl'); n.addClass('focus');
        }
      }
      if (filters.edge) {
        const e = c.getElementById(filters.edge);
        if (e.nonempty()) {
          if (!filters.node) { c.elements().not(e.connectedNodes().union(e)).addClass('dim'); e.connectedNodes().addClass('hl'); }
          e.removeClass('dim').addClass('sel');
        }
      }
    });
    paint();
    // Re-apply highlight after the element rebuild. paint() reads classes; it does not change these deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.node, filters.edge, filters.view, filters.layers.join(','), filters.octOnly]);

  useEffect(() => {
    const ro = new ResizeObserver(() => { cy.current?.resize(); paint(); });
    if (el.current) ro.observe(el.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="graph-wrap">
      <div ref={el} className="graph" role="img" aria-label={`Network graph, ${filters.view}. Use the relationship table for keyboard access.`} />
      <div className="band-layer" aria-hidden="true">
        {bands.map((b) => <div key={b.id} className="band-label" style={{ left: b.left, top: b.top }}>{b.title}</div>)}
      </div>
      <div className="label-layer" aria-hidden="true">
        {nodes.map((n) => (
          <div key={n.id} className={`node-label ${n.kind}${n.dim ? ' dim' : ''}${n.focus ? ' focus' : ''}`} style={{ left: n.left, top: n.top, width: n.w, height: n.h, fontSize: n.font }}>
            {n.lines.map((line, i) => <span key={i}>{line}</span>)}
          </div>
        ))}
      </div>
      <div className="zoom">
        <button onClick={() => cy.current?.zoom({ level: cy.current.zoom() * 1.25, renderedPosition: { x: el.current!.clientWidth / 2, y: el.current!.clientHeight / 2 } })} aria-label="Zoom in">+</button>
        <button onClick={() => cy.current?.zoom({ level: cy.current.zoom() / 1.25, renderedPosition: { x: el.current!.clientWidth / 2, y: el.current!.clientHeight / 2 } })} aria-label="Zoom out">−</button>
        <button onClick={() => cy.current?.fit(undefined, 46)} aria-label="Fit">Fit</button>
      </div>
    </div>
  );
}
