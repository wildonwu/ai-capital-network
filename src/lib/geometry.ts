/** Uniform manifest → model scale. Affine, so quadratic routes stay faithful. */
export const MODEL_SCALE = 0.2;

/** Same width for every layer. Width never encodes amount. */
export const EDGE_WIDTH = 1.8;

export interface Pt { x: number; y: number }

/**
 * Cytoscape unbundled-bezier places its control point at
 *   (1-w)*start + w*end + (-dy, dx)/|end-start| * distance
 * with start/end taken from the manual endpoints when edge-distances is "endpoints".
 * Invert that so the control point is the manifest's quadratic control.
 */
export function unbundledControl(start: Pt, control: Pt, end: Pt): { weight: number; distance: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-8) return { weight: 0.5, distance: 0 };
  const l = Math.sqrt(l2);
  const weight = ((control.x - start.x) * dx + (control.y - start.y) * dy) / l2;
  const baseX = start.x + weight * dx;
  const baseY = start.y + weight * dy;
  const distance = ((control.x - baseX) * -dy + (control.y - baseY) * dx) / l;
  return { weight, distance };
}

export function scalePt(p: readonly [number, number]): Pt {
  return { x: p[0] * MODEL_SCALE, y: p[1] * MODEL_SCALE };
}

export interface RoutedEdge {
  cpw: number;
  cpd: number;
  sep: string;
  tep: string;
}

export interface ManifestRoute {
  start: readonly [number, number];
  control: readonly [number, number];
  end: readonly [number, number];
}

/** Map a manifest quadratic (start / control / end, on the node boxes) into cytoscape data. */
export function routeEdge(boxFrom: readonly number[], boxTo: readonly number[], route: ManifestRoute): RoutedEdge {
  const start = scalePt(route.start);
  const control = scalePt(route.control);
  const end = scalePt(route.end);
  const { weight, distance } = unbundledControl(start, control, end);
  const px = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, ''));
  const sep = `${px((route.start[0] - boxFrom[0]) * MODEL_SCALE)}px ${px((route.start[1] - boxFrom[1]) * MODEL_SCALE)}px`;
  const tep = `${px((route.end[0] - boxTo[0]) * MODEL_SCALE)}px ${px((route.end[1] - boxTo[1]) * MODEL_SCALE)}px`;
  return { cpw: weight, cpd: distance, sep, tep };
}

export function nodeModel(box: readonly number[]): { x: number; y: number; w: number; h: number } {
  return { x: box[0] * MODEL_SCALE, y: box[1] * MODEL_SCALE, w: box[2] * MODEL_SCALE, h: box[3] * MODEL_SCALE };
}

export interface BandLabel { id: string; title: string; x: number; y: number }

const CENTER_BANDS: { id: string; title: string; minY: number; maxY: number }[] = [
  { id: 'capital', title: 'Capital providers & financing channels', minY: -Infinity, maxY: 2300 },
  { id: 'chips', title: 'Chips', minY: 2300, maxY: 3100 },
  { id: 'models', title: 'Model developers', minY: 3100, maxY: 3900 },
  { id: 'cloud', title: 'Cloud & capacity', minY: 3900, maxY: 5400 },
  { id: 'operators', title: 'Operators & financing vehicles', minY: 5400, maxY: Infinity },
];

/** Editorial band headers in manifest geometry, derived from kind and the laid-out rows. */
export function bandLabels(nodes: { id: string; kind: string; box: readonly number[] }[]): BandLabel[] {
  const placed = nodes.map((n) => {
    const [cx, cy, w, h] = n.box;
    return { ...n, cx, cy, left: cx - w / 2, top: cy - h / 2 };
  });
  const projects = placed.filter((n) => n.kind === 'project');
  const rest = placed.filter((n) => n.kind !== 'project');
  const out: BandLabel[] = [];
  for (const b of CENTER_BANDS) {
    const g = rest.filter((n) => n.cy >= b.minY && n.cy < b.maxY);
    if (!g.length) continue;
    const left = Math.min(...g.map((n) => n.left));
    const top = Math.min(...g.map((n) => n.top));
    // Sit the header in the gap above the row, clear of the node boxes.
    out.push({ id: b.id, title: b.title, x: left * MODEL_SCALE, y: (top - 175) * MODEL_SCALE });
  }
  const columns: [string, typeof projects][] = [
    ['projects-left', projects.filter((n) => n.cx < 5000)],
    ['projects-right', projects.filter((n) => n.cx >= 5000)],
  ];
  for (const [id, g] of columns) {
    if (!g.length) continue;
    const left = Math.min(...g.map((n) => n.left));
    const top = Math.min(...g.map((n) => n.top));
    out.push({ id, title: 'Project sites', x: left * MODEL_SCALE, y: (top - 175) * MODEL_SCALE });
  }
  return out;
}

/** One or two lines that fit a short project box. Amount tokens are copied from the manifest label. */
export function readableLines(label: string): string[] {
  const parts = label.split('\n').map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return parts.length ? parts : [label];
  const detail = parts.slice(1).join(' ');
  const amount = detail.match(/\$[\d.,]+[a-z]*/i);
  if (amount && /facility|principal/i.test(detail)) return [parts[0], `${amount[0]} facility`];
  if (amount) return [parts[0], amount[0]];
  return [parts[0], detail.replace(/^\(|\)$/g, '')];
}

/** Font size in CSS pixels. Floor keeps full-view project callouts readable at 1440×900. */
export function labelFont(lines: string[], boxW: number, boxH: number): number {
  const longest = Math.max(...lines.map((l) => l.length), 1);
  const byW = (Math.max(boxW, 1) - 4) / (longest * 0.54);
  const byH = (Math.max(boxH, 1) - 2) / (lines.length * 1.18);
  const cap = lines.length > 1 ? 13 : 17;
  return Math.max(10, Math.min(cap, byW, byH));
}
