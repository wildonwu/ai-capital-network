import type { GraphEdge, Release } from './types';
import { humanStatus, nodeName, nodeMap } from './model';

export interface QualifiedAmount {
  /** Full phrase, e.g. "50 USD bn" or "Not disclosed". Never "0" for a null amount. */
  text: string;
  numberText: string;
  unit: string;
  qualifier: string;
  disclosed: boolean;
  numeric: number | null;
}

/** Amount plus the raw status qualifier. Null stays "Not disclosed", never zero. */
export function qualifiedAmount(e: Pick<GraphEdge, 'amount' | 'unit' | 'status'>): QualifiedAmount {
  const qualifier = humanStatus(e.status);
  if (e.amount === null || e.amount === undefined) {
    return { text: 'Not disclosed', numberText: 'Not disclosed', unit: '', qualifier, disclosed: false, numeric: null };
  }
  const numberText = e.amount.toLocaleString('en-US', { maximumFractionDigits: 3 });
  const unit = e.unit || '';
  const text = unit ? `${numberText} ${unit}` : numberText;
  return { text, numberText, unit, qualifier, disclosed: true, numeric: e.amount };
}

export interface MechanismLine {
  id: string;
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  amount: QualifiedAmount;
  label: string;
  note: string;
  layer: string;
}

export interface MechanismCardModel {
  index: string;
  kicker: string;
  headline: MechanismLine;
  supporting: MechanismLine[];
}

/** Editorial mechanism frames. Figures are read from these relationship records. */
const STORIES: { kicker: string; headlineId: string; edgeIds: string[] }[] = [
  { kicker: 'Investor → customer', headlineId: 'R003', edgeIds: ['R003', 'R004'] },
  { kicker: 'Credit support → equity', headlineId: 'R054', edgeIds: ['R054', 'R055'] },
  { kicker: 'Capital → equipment → lease', headlineId: 'R191', edgeIds: ['R191', 'R192', 'R193'] },
];

function line(r: Release, id: string): MechanismLine {
  const e = r.graph.edges.find((x) => x.id === id);
  if (!e) throw new Error(`mechanism record ${id} is not in this release`);
  const nodes = nodeMap(r);
  return {
    id: e.id,
    from: e.from,
    to: e.to,
    fromLabel: nodeName(nodes.get(e.from), e.from),
    toLabel: nodeName(nodes.get(e.to), e.to),
    amount: qualifiedAmount(e),
    label: e.label,
    note: e.note,
    layer: e.layer,
  };
}

export function mechanismCards(r: Release): MechanismCardModel[] {
  return STORIES.map((s, i) => {
    const lines = s.edgeIds.map((id) => line(r, id));
    const headline = lines.find((l) => l.id === s.headlineId) ?? lines[0];
    return {
      index: String(i + 1).padStart(2, '0'),
      kicker: s.kicker,
      headline,
      supporting: lines.filter((l) => l.id !== headline.id),
    };
  });
}
