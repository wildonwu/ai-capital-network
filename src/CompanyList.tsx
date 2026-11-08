import { useMemo, useState } from 'react';
import type { Release } from './lib/types';
import { CATEGORIES, categoryOf } from './lib/categories';
import { degree } from './lib/selection';
import { TICKERS, shortName } from './lib/tickers';
import { CAT_COLOR } from './lib/flow';

/** Companies grouped by category beside the network; a click adds or removes a company from the selection. */
export default function CompanyList({ release, selected, shared, max, onToggle, onClear }: {
  release: Release; selected: string[]; shared: string[]; max: number; onToggle: (id: string) => void; onClear: () => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({ vehicles: false });
  const deg = useMemo(() => degree(release), [release]);
  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const nodes = release.graph.nodes.filter((n) => !s || [n.id, n.label_en, n.label_raw, TICKERS[n.id] ?? ''].some((x) => x.toLowerCase().includes(s)));
    return CATEGORIES.map((c) => ({
      ...c,
      nodes: nodes.filter((n) => categoryOf(n) === c.id).sort((a, b) => Number(b.kind === 'core') - Number(a.kind === 'core') || (deg.get(b.id) ?? 0) - (deg.get(a.id) ?? 0) || shortName(a).localeCompare(shortName(b))),
    })).filter((g) => g.nodes.length);
  }, [release, q, deg]);
  const sel = new Set(selected), sh = new Set(shared), full = selected.length >= max;

  return (
    <nav className="company-list" aria-label="Companies by category">
      <div className="cl-head">
        <input type="search" placeholder="Filter companies…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter companies" />
        <span className="cl-count">{selected.length ? <>{selected.length}/{max} selected · <button className="link" onClick={onClear}>clear</button></> : `Pick up to ${max}`}</span>
      </div>
      <div className="cl-body">
        {groups.map((g) => {
          // The large projects group starts folded unless filtering or something inside is selected.
          const isOpen = q.trim() !== '' || open[g.id] !== false || g.nodes.some((n) => sel.has(n.id));
          return (
            <section key={g.id} className="cl-group">
              <button className="cl-title" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [g.id]: !isOpen }))}>
                <i style={{ background: CAT_COLOR[g.id] }} /><span>{g.title}</span><small>{g.nodes.length}</small><b>{isOpen ? '–' : '+'}</b>
              </button>
              {isOpen && <ul>
                {g.nodes.map((n) => {
                  const on = sel.has(n.id), tick = TICKERS[n.id], label = shortName(n), full_ = n.label_en.replace(/\n.*/s, '');
                  return <li key={n.id}>
                    <button className={`cl-item${on ? ' on' : ''}${sh.has(n.id) ? ' shared' : ''}${full && !on ? ' full' : ''}`} aria-pressed={on} onClick={() => onToggle(n.id)} title={full_}>
                      <span className="cl-check" aria-hidden="true">{on ? '✓' : ''}</span>
                      <span className="cl-name"><b>{label}</b>{tick && full_ !== label && <small>{full_}</small>}</span>
                      <span className="cl-deg" title="relationship records">{deg.get(n.id) ?? 0}</span>
                    </button>
                  </li>;
                })}
              </ul>}
            </section>
          );
        })}
      </div>
    </nav>
  );
}
