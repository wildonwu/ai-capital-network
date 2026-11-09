import { useState } from 'react';
import type { GraphEdge, Release } from './lib/types';
import { DIR_LABEL, FLOWS, OVERLAPS, exposure, type Dir, type ExpRow, type ExpSide } from './lib/exposure';
import { FLOW_COLOR, fmtBn } from './lib/flow';
import { humanStatus, shortAmount } from './lib/model';

const money = (v: number) => (v > 0 ? fmtBn(Math.round(v * 1000) / 1000) : '$0');
const FLOW_TITLE = { money: 'Money', goods: 'Compute', guar: 'Guarantees & options' } as const;
const FLOW_SUB = { money: 'equity, loans, bonds', goods: 'purchase and delivery', guar: 'credit support, warrants' } as const;
const SHOWN = 6;

function Side({ side, label, color, name, active, onRecord }: { side: ExpSide; label: string; color: string; name: (id: string) => string; active: string | null; onRecord: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const rows = all ? side.rows : side.rows.slice(0, SHOWN);
  const Row = ({ x }: { x: ExpRow }) => {
    const amount = x.e.amount === null ? 'n/d' : x.usd !== null ? fmtBn(x.usd) : shortAmount(x.e);
    return <button className={`ex-row${x.within ? ' within' : ''}${active === x.e.id ? ' on' : ''}`} onClick={() => onRecord(x.e.id)} title={x.within ? OVERLAPS[x.e.id].why : `${x.e.label} (${x.e.id})`}>
      <span className="ex-who"><b>{name(x.other)}</b><small>{humanStatus(x.e.status)}{x.conditional ? ' · conditional' : ''}</small></span>
      <span className="ex-amt">{amount}{x.within && <small>in {x.within}</small>}</span>
    </button>;
  };
  return (
    <div className="ex-side">
      <div className="ex-side-h">{label}</div>
      {side.rows.length ? <>
        <div className="ex-total">
          {side.firm > 0 && <span><b style={{ color }}>{money(side.firm)}</b> firm</span>}
          {side.conditional > 0 && <span><b>{money(side.conditional)}</b> conditional</span>}
          {side.firm === 0 && side.conditional === 0 && <span>No US$ amount disclosed</span>}
          {side.uncounted > 0 && <span className="ex-nd">{side.firm + side.conditional > 0 ? '+' : ''}{side.uncounted} record{side.uncounted > 1 ? 's' : ''} without a $ amount</span>}
        </div>
        {rows.map((x, i) => (
          <div key={x.e.id}>
            {x.via && x.via !== rows[i - 1]?.via && <div className="ex-via">Via {name(x.via)} <small>project-level; no parent guarantee recorded</small></div>}
            <Row x={x} />
          </div>
        ))}
        {side.rows.length > SHOWN && <button className="link" onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `Show all ${side.rows.length}`}</button>}
      </> : <p className="ex-none">None recorded</p>}
    </div>
  );
}

/** One block per selected company: money, compute and guarantees, each split into what comes in and what goes out. */
export default function ExposureBlocks({ release, companies, edges, name, active, onRecord }: {
  release: Release; companies: string[]; edges: GraphEdge[]; name: (id: string) => string; active: string | null; onRecord: (id: string) => void;
}) {
  return <>{companies.map((id) => {
    const x = exposure(release, id, edges);
    const full = release.graph.nodes.find((n) => n.id === id)?.label_en.replace(/\n.*/s, '');
    return (
      <section key={id} className="ex-block" aria-label={`${name(id)} money, compute and guarantees`}>
        <div className="ex-h">
          <h3>{name(id)}{full && full !== name(id) && <span>{full}</span>}</h3>
          <p>Disclosed US$ by line type and direction{x.projects.length ? `, including ${x.projects.length} project-level vehicle${x.projects.length > 1 ? 's' : ''}` : ''}. Firm = contracted, paid or on the balance sheet; conditional = options, caps, announcements and unconfirmed links. A record already inside another counted record is shown in grey and not added. Click a row for its source.</p>
        </div>
        <div className="ex-grid">
          {FLOWS.map((f) => (
            <div key={f} className="ex-col" style={{ ['--c' as string]: FLOW_COLOR[f] }}>
              <div className="ex-col-h"><i />{FLOW_TITLE[f]}<small>{FLOW_SUB[f]}</small></div>
              {(['in', 'out'] as Dir[]).map((d) => <Side key={d} side={x.sides[f][d]} label={DIR_LABEL[f][d]} color={FLOW_COLOR[f]} name={name} active={active} onRecord={onRecord} />)}
            </div>
          ))}
        </div>
      </section>
    );
  })}</>;
}
