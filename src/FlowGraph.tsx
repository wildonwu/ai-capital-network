import { useState } from 'react';
import { CAT_COLOR, FLOW_COLOR, type FlowLayout } from './lib/flow';
import type { CategoryId } from './lib/categories';

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const TONE = { all: '#A0712A', some: '#B08A4A', one: '#8A8077' };

/**
 * The network as plain SVG. Click a company to select it (or drop it), a line to open its record. In the overview,
 * hovering a company or picking a category lights up its lines and fades the rest.
 */
export default function FlowGraph({ f, focusCat, activeEdge, onNode, onEdge }: {
  f: FlowLayout; focusCat: CategoryId | null; activeEdge: string | null; onNode: (id: string) => void; onEdge: (id: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const overview = !f.nodes.some((n) => n.selected);
  const lit = (id: string) => (hover ? id === hover : focusCat ? f.nodes.find((n) => n.id === id)?.cat === focusCat : true);
  const edgeLit = (from: string, to: string) => !overview || (!hover && !focusCat) || lit(from) || lit(to);
  const nodeLit = (id: string) => {
    if (!overview || (!hover && !focusCat)) return true;
    if (lit(id)) return true;
    return f.edges.some((e) => (e.e.from === id && lit(e.e.to)) || (e.e.to === id && lit(e.e.from)));
  };
  const chars = Math.floor((f.nodes[0]?.w ?? 140) / 7.2) - 2;
  return (
    <svg className="flow" width={f.width} height={f.height} viewBox={`0 0 ${f.width} ${f.height}`} role="img" aria-label="Network of relationships">
      {f.headers.map((h, i) => h.text && <g key={i}><text className="fg-head" x={h.x} y={h.y}>{h.text}</text><text className="fg-sub" x={h.x} y={h.y + 16}>{h.sub}</text></g>)}
      {f.captions.map((c, i) => <text key={i} className="fg-cap" x={c.x} y={c.y} fill={TONE[c.tone ?? 'one']}>{c.text}</text>)}
      {f.edges.map((x) => {
        const on = edgeLit(x.e.from, x.e.to), act = activeEdge === x.e.id;
        return <g key={x.e.id} className="fg-edge" onClick={() => onEdge(x.e.id)}>
          <path d={x.d} fill="none" stroke="transparent" strokeWidth={Math.max(10, x.width + 6)} />
          <path d={x.d} fill="none" stroke={FLOW_COLOR[x.flow]} strokeWidth={x.width} strokeOpacity={act ? 1 : on ? (hover || focusCat ? Math.max(0.75, x.opacity) : x.opacity) : 0.05}
            strokeDasharray={x.flow === 'guar' ? '6 5' : x.flow === 'other' ? '2 5' : undefined} strokeLinecap={x.head ? 'butt' : 'round'} />
          {x.head && on && <polygon points={x.head.points} fill={FLOW_COLOR[x.flow]} fillOpacity={act ? 1 : Math.min(1, (hover || focusCat ? Math.max(0.75, x.opacity) : x.opacity) + 0.2)} />}
          <title>{`${x.e.from} → ${x.e.to} · ${x.e.layer}${x.label ? ' · ' + x.label : ''} (${x.e.id})`}</title>
        </g>;
      })}
      {f.nodes.map((n) => {
        const dim = !nodeLit(n.id);
        const two = !!n.tick && n.tick !== n.name;
        return <g key={n.id} className={`fg-node${n.selected ? ' sel' : ''}`} opacity={dim ? 0.25 : 1} tabIndex={0} role="button" aria-pressed={n.selected}
          aria-label={`${n.tick ?? n.name}${two ? ' ' + n.name : ''}${n.selected ? ' (selected, click to remove)' : ''}`}
          onClick={() => onNode(n.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNode(n.id); } }}
          onPointerEnter={() => overview && setHover(n.id)} onPointerLeave={() => setHover(null)}>
          <rect className="fg-box" x={n.x} y={n.y} width={n.w} height={n.h} rx="8" />
          <rect x={n.x} y={n.y + 8} width="3.5" height={n.h - 16} rx="1.75" fill={CAT_COLOR[n.cat]} />
          {two ? <><text className="fg-tick" x={n.x + 14} y={n.y + n.h / 2 - 3}>{n.tick}</text><text className="fg-name" x={n.x + 14} y={n.y + n.h / 2 + 12}>{clip(n.name, chars + 3)}</text></>
            : <text className="fg-only" x={n.x + 14} y={n.y + n.h / 2 + 4.5}>{clip(n.tick ?? n.name, chars)}</text>}
          <title>{n.name}</title>
        </g>;
      })}
      {f.edges.filter((x) => x.label && edgeLit(x.e.from, x.e.to)).map((x) => {
        const w = x.label!.length * 6.6 + 12;
        return <g key={'l' + x.e.id} transform={`translate(${x.lx},${x.ly})`} className="fg-label" onClick={() => onEdge(x.e.id)}>
          <rect x={-w / 2} y={-10} width={w} height={20} rx={10} fill="#fff" stroke={FLOW_COLOR[x.flow]} strokeOpacity={0.5} />
          <text textAnchor="middle" y={4} fill={FLOW_COLOR[x.flow]}>{x.label}</text>
        </g>;
      })}
    </svg>
  );
}
