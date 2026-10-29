import type { Release } from './lib/types';
import { directionWords, nodeMap } from './lib/model';
import { mechanismCards, type MechanismLine } from './lib/mechanisms';

function Amount({ line, hero }: { line: MechanismLine; hero?: boolean }) {
  const a = line.amount;
  return (
    <span className={hero ? 'mech-amt' : 'mech-amt-sm'}>
      {a.disclosed ? <><b>{a.numberText}</b> {a.unit && <span className="unit">{a.unit}</span>}</> : <i className="undisclosed">Not disclosed</i>}
      <span className="mech-qual">{a.qualifier}</span>
    </span>
  );
}

export default function Mechanisms({ release }: { release: Release }) {
  const nodes = nodeMap(release);
  const cards = mechanismCards(release);
  return (
    <section className="mechanisms" data-testid="mechanisms" aria-label="Three mechanisms behind the network">
      <h2>Three mechanisms behind the network</h2>
      <div className="mech-grid">
        {cards.map((card) => (
          <article key={card.headline.id} data-testid="mechanism-card">
            <div className="eyebrow">{card.index} · {card.kicker}</div>
            <p className="mech-hero"><Amount line={card.headline} hero /></p>
            <h3>{card.headline.fromLabel} → {card.headline.toLabel}</h3>
            <p className="mech-dir">{directionWords(release.graph.edges.find((e) => e.id === card.headline.id)!, nodes)}.</p>
            {card.headline.label && <p className="mech-raw">{card.headline.label}</p>}
            <p className="mech-id">Record {card.headline.id}</p>
            {card.supporting.map((line) => {
              const edge = release.graph.edges.find((e) => e.id === line.id)!;
              return (
                <div key={line.id} className="mech-line">
                  <div className="mech-who">{line.fromLabel} → {line.toLabel}</div>
                  <Amount line={line} />
                  <p className="mech-dir">{directionWords(edge, nodes)}.</p>
                  {line.label && <p className="mech-raw">{line.label}</p>}
                  <p className="mech-id">Record {line.id}</p>
                </div>
              );
            })}
          </article>
        ))}
      </div>
      <p className="small">Amounts and status qualifiers are read from the cited relationship records. A missing amount is “not disclosed”, never zero. Do not add the figures together — one contract can appear on more than one record.</p>
    </section>
  );
}
