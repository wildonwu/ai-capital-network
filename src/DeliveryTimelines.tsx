import { useState } from 'react';
import { keyEvent, quarterDomain, quarterTicks, span, timeScale, type Delivery, type SiteRisk } from './lib/delivery';

const W = 1000, LABEL = 270, PAD_R = 18, AXIS_H = 30;
const RISK: Record<SiteRisk, { label: string; color: string }> = {
  risk: { label: 'At risk', color: 'var(--hot)' },
  watch: { label: 'Watch', color: 'var(--gold)' },
  done: { label: 'Delivered', color: 'var(--good)' },
  cancelled: { label: 'Cancelled', color: 'var(--muted)' },
};

function Axis({ ticks, x, top, bottom, asOf }: { ticks: ReturnType<typeof quarterTicks>; x: (d: string) => number; top: number; bottom: number; asOf: string }) {
  return <g>
    {ticks.map((t) => <g key={t.date}>
      <line x1={x(t.date)} x2={x(t.date)} y1={top} y2={bottom} className={t.year ? 'dt-grid yr' : 'dt-grid'} />
      <text x={x(t.date) + 3} y={top - 8} className={t.year ? 'dt-tick yr' : 'dt-tick'}>{t.label}</text>
    </g>)}
    <line x1={x(asOf)} x2={x(asOf)} y1={top - 4} y2={bottom} className="dt-now" />
    <text x={x(asOf) - 4} y={bottom + 13} className="dt-now-l" textAnchor="end">data as of {asOf}</text>
  </g>;
}

/** A point (diamond) or a window (bar); hollow when the date is inferred rather than announced. */
function Mark({ x, y, start, end, inferred, color, big, past }: { x: (d: string) => number; y: number; start: string; end?: string; inferred: boolean; color: string; big?: boolean; past?: boolean }) {
  const op = past ? 0.4 : 1;
  if (end && end !== start) {
    const a = x(start), b = Math.max(x(end), a + 4);
    return <rect x={a} y={y - (big ? 6 : 4)} width={b - a} height={big ? 12 : 8} rx={3} fill={inferred ? 'var(--card)' : color} stroke={color} strokeWidth={1.5} strokeDasharray={inferred ? '3 2' : undefined} opacity={op} />;
  }
  const r = big ? 7 : 4.5, cx = x(start);
  return <path d={`M${cx} ${y - r}L${cx + r} ${y}L${cx} ${y + r}L${cx - r} ${y}Z`} fill={inferred ? 'var(--card)' : color} stroke={color} strokeWidth={1.5} opacity={op} />;
}

function Legend() {
  return <div className="dt-legend">
    <span><svg width="14" height="14" aria-hidden="true"><path d="M7 2L12 7L7 12L2 7Z" fill="var(--ink2)" /></svg>Announced date</span>
    <span><svg width="14" height="14" aria-hidden="true"><path d="M7 2L12 7L7 12L2 7Z" fill="var(--card)" stroke="var(--ink2)" strokeWidth="1.5" /></svg>Inferred from backtested lead times</span>
    <span><svg width="22" height="10" aria-hidden="true"><rect x="1" y="1" width="20" height="8" rx="3" fill="var(--ink2)" /></svg>Window (e.g. “early 2027”)</span>
    <span><svg width="10" height="14" aria-hidden="true"><line x1="5" x2="5" y1="0" y2="14" className="dt-now" /></svg>Research cut-off</span>
  </div>;
}

function CompanyTimeline({ d, name }: { d: Delivery; name: string }) {
  const [on, setOn] = useState<number | null>(null);
  const rows = d.company.map((m, i) => ({ m, i })).sort((a, b) => (a.m.end ?? a.m.start).localeCompare(b.m.end ?? b.m.start) || a.m.start.localeCompare(b.m.start));
  const dom = quarterDomain(d.as_of, span(d.company.flatMap((m) => [m.start, m.end ?? m.start]))[1]);
  const x = timeScale(dom, LABEL, W - PAD_R);
  const RH = 26, top = AXIS_H, h = top + rows.length * RH + 22;
  return (
    <section className="ex-block dt" aria-label={`${name} company-level delivery timeline`} data-testid="delivery-company">
      <div className="ex-h">
        <h3>{name} delivery checkpoints<span>company level · what to check, when, and what counts as a delay</span></h3>
        <p>Each row is a dated checkpoint: an earnings filing, a debt draw deadline, or a landlord’s promised handover that feeds {name}’s reported capacity. Grey rows have passed the research cut-off and need their outcome checked. Click a row for the reference value and the delay trigger.</p>
      </div>
      <Legend />
      <div className="dt-scroll"><svg viewBox={`0 0 ${W} ${h}`} className="dt-svg" role="img" aria-label={`${rows.length} checkpoints from ${dom[0]} to ${dom[1]}`}>
        <Axis ticks={quarterTicks(dom)} x={x} top={top} bottom={h - 22} asOf={d.as_of} />
        {rows.map(({ m, i }, r) => {
          const y = top + r * RH + RH / 2, past = (m.end ?? m.start) < d.as_of;
          return <g key={i} className={`dt-row${on === i ? ' on' : ''}${past ? ' past' : ''}`} onClick={() => setOn(on === i ? null : i)} tabIndex={0} role="button" aria-pressed={on === i}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOn(on === i ? null : i); } }}>
            <rect x={0} y={y - RH / 2} width={W} height={RH} className="dt-hit" />
            <text x={8} y={y + 4} className="dt-lbl">{m.item.length > 40 ? `${m.item.slice(0, 39)}…` : m.item}<title>{m.item}</title></text>
            <Mark x={x} y={y} start={m.start} end={m.end} inferred={m.kind === 'inferred'} color={m.site ? 'var(--goods)' : 'var(--money)'} past={past} big={on === i} />
            {x(m.end ?? m.start) > W - 140
              ? <text x={x(m.start) - 10} y={y + 4} className="dt-when" textAnchor="end">{m.when}</text>
              : <text x={x(m.end ?? m.start) + 10} y={y + 4} className="dt-when">{m.when}</text>}
          </g>;
        })}
      </svg></div>
      <div className="dt-key"><span><i style={{ background: 'var(--money)' }} />Company filings and financing</span><span><i style={{ background: 'var(--goods)' }} />Landlord / site handover</span></div>
      <div className="table-scroll dt-table"><table>
        <thead><tr><th>When</th><th>Checkpoint</th><th>What to look at</th><th>Reference</th><th>Counts as a delay if</th></tr></thead>
        <tbody>{rows.map(({ m, i }) => <tr key={i} className={`${on === i ? 'on' : ''}${(m.end ?? m.start) < d.as_of ? ' past' : ''}`} onClick={() => setOn(on === i ? null : i)}>
          <td className="dt-nowrap">{m.when}</td><td><b>{m.item}</b></td><td>{m.watch}</td><td>{m.reference}</td><td>{m.slip}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="dt-foot"><b>Every quarter:</b> {d.recurring.join(' ')}</p>
    </section>
  );
}

function SiteTimelines({ d, name }: { d: Delivery; name: string }) {
  const [sel, setSel] = useState<string>(() => d.sites.find((s) => s.risk === 'risk')?.id ?? d.sites[0].id);
  const dom = quarterDomain(...span(d.sites.flatMap((s) => s.events.flatMap((e) => [e.date, e.end ?? e.date]))));
  const x = timeScale(dom, LABEL, W - PAD_R);
  const RH = 34, top = AXIS_H, h = top + d.sites.length * RH + 22;
  const site = d.sites.find((s) => s.id === sel) ?? d.sites[0];
  const pick = (id: string) => setSel(id);
  return (
    <section className="ex-block dt" aria-label={`${name} site timelines`} data-testid="delivery-sites">
      <div className="ex-h">
        <h3>{name} site timelines<span>{d.sites.length} campuses · announced dates and inferred signal dates</span></h3>
        <p>One row per campus. The large mark is the next pending handover; small marks are filings, jobs, permits and inferred checks (if a hollow mark’s date passes without the signal, treat it as an early delay warning). Click a campus for its full event list.</p>
      </div>
      <Legend />
      <div className="dt-scroll"><svg viewBox={`0 0 ${W} ${h}`} className="dt-svg" role="img" aria-label={`${d.sites.length} site timelines from ${dom[0]} to ${dom[1]}`}>
        <Axis ticks={quarterTicks(dom)} x={x} top={top} bottom={h - 22} asOf={d.as_of} />
        {d.sites.map((s, r) => {
          const y = top + r * RH + RH / 2, k = keyEvent(s, d.as_of), c = RISK[s.risk].color;
          const first = s.events[0]?.date, last = s.events.at(-1)?.end ?? s.events.at(-1)?.date;
          return <g key={s.id} className={`dt-row${sel === s.id ? ' on' : ''}`} onClick={() => pick(s.id)} tabIndex={0} role="button" aria-pressed={sel === s.id}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(s.id); } }}>
            <rect x={0} y={y - RH / 2} width={W} height={RH} className="dt-hit" />
            <circle cx={12} cy={y} r={4.5} fill={c} />
            <text x={24} y={y - 1} className="dt-lbl">{s.name} <tspan className="dt-st">{s.state}</tspan></text>
            <text x={24} y={y + 12} className="dt-sub">{s.next_when !== '—' ? `${s.next} · ${s.next_when}` : s.status}</text>
            {first && last && <line x1={x(first)} x2={x(last)} y1={y} y2={y} className="dt-span" />}
            {s.events.filter((e) => e !== k).map((e, j) => <Mark key={j} x={x} y={y} start={e.date} end={e.end} inferred={e.kind === 'inferred'} color="var(--ink2)" past={(e.end ?? e.date) < d.as_of} />)}
            {k && <Mark x={x} y={y} start={k.date} end={k.end} inferred={k.kind === 'inferred'} color={c} big />}
          </g>;
        })}
      </svg></div>
      <div className="dt-key">{(Object.keys(RISK) as SiteRisk[]).map((r) => <span key={r}><i style={{ background: RISK[r].color }} />{RISK[r].label}</span>)}</div>

      <div className="dt-site" data-testid="delivery-site-detail">
        <div className="dt-site-h">
          <h4><i style={{ background: RISK[site.risk].color }} />{site.name}, {site.state}<small>{RISK[site.risk].label} · {site.status}</small></h4>
          <select value={site.id} onChange={(e) => pick(e.target.value)} aria-label="Choose a campus">{d.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </div>
        <dl className="dt-facts">
          <div><dt>Landlord / developer</dt><dd>{site.landlord}</dd></div>
          <div><dt>{name} capacity</dt><dd>{site.capacity}</dd></div>
          <div><dt>Delivered</dt><dd>{site.delivered}</dd></div>
          <div><dt>Next pending</dt><dd>{site.next}{site.next_when !== '—' && <> · <b>{site.next_when}</b></>}</dd></div>
        </dl>
        <div className="table-scroll dt-table"><table>
          <thead><tr><th>Date</th><th>Type</th><th>Event</th><th>Counts as a delay if</th></tr></thead>
          <tbody>{site.events.map((e, j) => <tr key={j} className={`${e.key ? 'key' : ''}${(e.end ?? e.date) < d.as_of ? ' past' : ''}`}>
            <td className="dt-nowrap">{e.when}</td>
            <td><span className={`dt-kind ${e.kind}`}>{e.kind === 'inferred' ? 'Inferred' : 'Announced'}</span></td>
            <td>{e.event}</td><td>{e.slip ?? '—'}</td>
          </tr>)}</tbody>
        </table></div>
        <p className="dt-note">{site.note}</p>
      </div>
      <div className="dt-foot">
        <p><b>Coverage.</b> {d.gap}</p>
        <p><b>Inference rules.</b></p>
        <ol>{d.rules.map((r) => <li key={r}>{r}</li>)}</ol>
        <p className="small">{d.source_note} Research cut-off {d.as_of}.</p>
      </div>
    </section>
  );
}

/** Two blocks under a selected company that has curated delivery data: company checkpoints and per-site timelines. */
export default function DeliveryTimelines({ d, name }: { d: Delivery; name: string }) {
  return <><CompanyTimeline d={d} name={name} /><SiteTimelines d={d} name={name} /></>;
}
