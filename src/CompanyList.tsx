import { useMemo, useState } from 'react';
import type { Release } from './lib/types';
import { CATEGORIES, categoryOf } from './lib/categories';
import { degree } from './lib/selection';

/** Grouped, searchable company list. Clicking toggles a company in the selection. */
export default function CompanyList({ release, selected, shared, onToggle, onClear }: {
  release: Release; selected: string[]; shared: string[]; onToggle: (id: string) => void; onClear: () => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({ vehicles: false });
  const deg = useMemo(() => degree(release), [release]);
  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const nodes = release.graph.nodes.filter((n) => !s || [n.id, n.label_en, n.label_raw].some((x) => x.toLowerCase().includes(s)));
    return CATEGORIES.map((c) => ({
      ...c,
      nodes: nodes.filter((n) => categoryOf(n) === c.id).sort((a, b) => Number(b.kind === 'core') - Number(a.kind === 'core') || (deg.get(b.id) ?? 0) - (deg.get(a.id) ?? 0) || a.label_en.localeCompare(b.label_en)),
    })).filter((g) => g.nodes.length);
  }, [release, q, deg]);
  const sel = new Set(selected), sh = new Set(shared);

  return (
    <nav className="company-list" aria-label="Companies by category">
      <div className="cl-head">
        <input type="search" placeholder="Filter companies (English / 中文)…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter companies" />
        {selected.length > 0 && <button className="link" onClick={onClear}>Clear {selected.length}</button>}
      </div>
      {groups.map((g) => {
        // Large groups (projects) start collapsed unless filtering or something inside is selected.
        const isOpen = q.trim() !== '' || open[g.id] !== false || g.nodes.some((n) => sel.has(n.id));
        return (
          <section key={g.id} className="cl-group">
            <button className="cl-title" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [g.id]: !isOpen }))}>
              <span>{isOpen ? '▾' : '▸'} {g.title}</span><small>{g.nodes.length}</small>
            </button>
            {isOpen && <ul>
              {g.nodes.map((n) => (
                <li key={n.id}>
                  <button className={`cl-item${sel.has(n.id) ? ' on' : ''}${sh.has(n.id) ? ' shared' : ''}`} aria-pressed={sel.has(n.id)} onClick={() => onToggle(n.id)} title={n.label_raw !== n.label_en ? n.label_raw : undefined}>
                    <span className="cl-check" aria-hidden="true">{sel.has(n.id) ? '✓' : ''}</span>
                    <span className="cl-name">{n.label_en.replace(/\n.*/s, '')}</span>
                    <span className="cl-deg">{deg.get(n.id) ?? 0}</span>
                  </button>
                </li>
              ))}
            </ul>}
          </section>
        );
      })}
      <p className="small cl-foot">Numbers = relationship records. Selecting several companies overlays their direct relationships; counterparties shared by two or more selected companies are highlighted.</p>
    </nav>
  );
}
