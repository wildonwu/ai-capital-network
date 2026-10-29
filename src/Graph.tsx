import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import type { Core, ElementDefinition } from 'cytoscape';
import type { Release } from './lib/types';
import { LAYERS } from './lib/types';
import { LAYER_STYLE, visibleEdges, type Filters } from './lib/model';

const W = 2000; // normalized logical width (10000 -> 2000)

interface Props { release: Release; filters: Filters; onNode: (id: string | null) => void; onEdge: (id: string | null) => void }

export default function Graph({ release, filters, onNode, onEdge }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const cy = useRef<Core | null>(null);
  const cb = useRef({ onNode, onEdge });
  cb.current = { onNode, onEdge };

  // (re)build elements when the view / filters change; positions come from view manifest only
  useEffect(() => {
    const view = release.views[filters.view];
    const sx = W / view.coordinate_system.width;
    const sy = (W * 0.8) / view.coordinate_system.height;
    const core = new Set(release.graph.core);
    const nodes = new Map(release.graph.nodes.map((n) => [n.id, n]));
    const els: ElementDefinition[] = view.node_ids.map((id) => {
      const [cx, cyy, w] = view.nodes[id].box;
      const n = nodes.get(id)!;
      return {
        group: 'nodes',
        data: { id, label: view.nodes[id].label || n.label_en, w: Math.max(w * sx, 60), h: core.has(id) ? 46 : (view.nodes[id].label || '').includes('\n') ? 40 : 30, kind: n.kind },
        position: { x: cx * sx, y: cyy * sy },
        classes: core.has(id) ? 'core' : n.kind,
      };
    });
    for (const e of visibleEdges(release, filters)) {
      els.push({ group: 'edges', data: { id: e.id, source: e.from, target: e.to, layer: e.layer }, classes: `${e.layer}${e.october_change ? ' oct' : ''}` });
    }
    if (!cy.current) {
      cy.current = cytoscape({
        container: el.current, elements: els, layout: { name: 'preset' }, wheelSensitivity: 0.25, minZoom: 0.2, maxZoom: 4,
        boxSelectionEnabled: false, autoungrabify: true,
        style: ([
          { selector: 'node', style: { shape: 'rectangle', width: 'data(w)', height: 'data(h)', 'background-color': '#FFF8F1', 'border-width': 0.8, 'border-color': '#D9C9BB', label: 'data(label)', 'font-family': 'Inter, Helvetica, Arial, sans-serif', 'font-size': 17, color: '#292524', 'text-valign': 'center', 'text-halign': 'center', 'text-wrap': 'wrap', 'text-max-width': 'data(w)', 'line-height': 1.15 } },
          { selector: 'node.core', style: { 'background-color': '#E3ECEA', 'border-color': '#4F8F92', 'border-width': 2, 'font-size': 26, 'font-weight': 'bold' } },
          { selector: 'node.project', style: { 'font-size': 13, color: '#5A524C' } },
          { selector: 'node.funding_category', style: { 'border-style': 'dashed' } },
          { selector: 'edge', style: { width: 2.4, 'curve-style': 'bezier', 'control-point-step-size': 26, opacity: 0.75, 'arrow-scale': 1.3, 'target-arrow-shape': 'triangle' } },
          ...LAYERS.map((l) => ({ selector: `edge.${l}`, style: { 'line-color': LAYER_STYLE[l].color, 'target-arrow-color': LAYER_STYLE[l].color, 'line-style': LAYER_STYLE[l].dash, ...(LAYER_STYLE[l].pattern ? { 'line-dash-pattern': LAYER_STYLE[l].pattern } : {}), 'target-arrow-shape': LAYER_STYLE[l].arrow } })),
          { selector: 'edge.affiliation', style: { opacity: 0.55 } },
          { selector: 'edge.financing', style: { opacity: 0.5 } },
          { selector: 'edge.oct', style: { 'underlay-color': '#D8912B', 'underlay-opacity': 0.22, 'underlay-padding': 3 } },
          { selector: '.dim', style: { opacity: 0.07, 'text-opacity': 0.3, 'underlay-opacity': 0 } },
          { selector: 'edge.hl', style: { opacity: 1, width: 3.2, 'z-index': 10 } },
          { selector: 'node.hl', style: { 'border-color': '#292524', 'border-width': 2.5 } },
          { selector: 'node.focus', style: { 'border-color': '#D8912B', 'border-width': 4 } },
          { selector: 'edge.sel', style: { width: 5, opacity: 1, 'z-index': 20, 'underlay-color': '#D8912B', 'underlay-opacity': 0.5, 'underlay-padding': 5 } },
        ] as unknown as cytoscape.StylesheetJson),
      });
      cy.current.on('tap', 'node', (ev) => cb.current.onNode(ev.target.id()));
      cy.current.on('tap', 'edge', (ev) => cb.current.onEdge(ev.target.id()));
      cy.current.on('tap', (ev) => { if (ev.target === cy.current) { cb.current.onNode(null); cb.current.onEdge(null); } });
      (window as unknown as { __cy: Core }).__cy = cy.current;
    } else {
      const c = cy.current;
      const prevView = c.scratch('view');
      c.batch(() => { c.elements().remove(); c.add(els); });
      if (prevView !== filters.view) c.fit(undefined, 20);
    }
    cy.current.scratch('view', filters.view);
    if (!cy.current.scratch('fitted')) { cy.current.fit(undefined, 20); cy.current.scratch('fitted', true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [release, filters.view, filters.layers.join(','), filters.octOnly]);

  // highlight state
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
  });

  useEffect(() => {
    const ro = new ResizeObserver(() => { cy.current?.resize(); });
    if (el.current) ro.observe(el.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="graph-wrap">
      <div ref={el} className="graph" role="img" aria-label={`Network graph, ${filters.view}. Use the relationship table for keyboard access.`} />
      <div className="zoom">
        <button onClick={() => cy.current?.zoom({ level: cy.current.zoom() * 1.25, renderedPosition: { x: el.current!.clientWidth / 2, y: el.current!.clientHeight / 2 } })} aria-label="Zoom in">+</button>
        <button onClick={() => cy.current?.zoom({ level: cy.current.zoom() / 1.25, renderedPosition: { x: el.current!.clientWidth / 2, y: el.current!.clientHeight / 2 } })} aria-label="Zoom out">−</button>
        <button onClick={() => cy.current?.fit(undefined, 20)} aria-label="Fit">Fit</button>
      </div>
    </div>
  );
}
