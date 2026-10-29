import type { Graph, Manifest, Release, Source, ViewManifest } from './types';

export const SUPPORTED_APP_SCHEMA = 'acn-release-1';

/** Text fetcher abstraction so tests / the single-file build can supply files without HTTP. */
export type Fetcher = (path: string) => Promise<string>;

declare global { interface Window { __ACN_EMBED__?: Record<string, string> } }

export function defaultFetcher(base = './data/'): Fetcher {
  return async (p) => {
    const embed = typeof window !== 'undefined' ? window.__ACN_EMBED__ : undefined;
    if (embed && p in embed) return embed[p];
    const r = await fetch(base + p, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${p}`);
    return r.text();
  };
}

async function sha256Hex(text: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const buf = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function validateRelease(graph: Graph, sources: Record<string, Source>, views: Record<string, ViewManifest>): string[] {
  const errs: string[] = [];
  const ids = new Set(graph.nodes.map((n) => n.id));
  const eids = new Set(graph.edges.map((e) => e.id));
  if (ids.size !== graph.nodes.length) errs.push('duplicate node ids');
  if (eids.size !== graph.edges.length) errs.push('duplicate edge ids');
  for (const e of graph.edges) {
    if (!ids.has(e.from)) errs.push(`edge ${e.id}: unknown from ${e.from}`);
    if (!ids.has(e.to)) errs.push(`edge ${e.id}: unknown to ${e.to}`);
    if (!(e.source in sources)) errs.push(`edge ${e.id}: unknown source ${e.source}`);
    if (!e.status) errs.push(`edge ${e.id}: missing status`);
    if (e.amount !== null && typeof e.amount !== 'number') errs.push(`edge ${e.id}: bad amount`);
    if (e.amount !== null && !e.unit) errs.push(`edge ${e.id}: amount without unit`);
  }
  for (const c of graph.core) if (!ids.has(c)) errs.push(`core ${c} missing`);
  for (const v of Object.values(views)) {
    if (v.release_id !== graph.release_id) errs.push(`view ${v.view_id} from another release`);
    for (const n of v.node_ids) { if (!ids.has(n)) errs.push(`view ${v.view_id}: node ${n} missing`); if (!v.nodes[n]) errs.push(`view ${v.view_id}: node ${n} has no position`); }
    for (const e of v.edge_ids) if (!eids.has(e)) errs.push(`view ${v.view_id}: edge ${e} missing`);
    const vn = new Set(v.node_ids);
    for (const e of graph.edges) if (v.edge_ids.includes(e.id) && (!vn.has(e.from) || !vn.has(e.to))) errs.push(`view ${v.view_id}: edge ${e.id} endpoint outside view`);
  }
  return errs;
}

/** pointer -> manifest -> pinned immutable files -> hash + reference validation */
export async function loadRelease(fetcher: Fetcher = defaultFetcher()): Promise<Release> {
  const latest = JSON.parse(await fetcher('latest.json')) as { release_id: string; manifest: string; manifest_sha256: string };
  const mText = await fetcher(latest.manifest);
  let hashVerified = true;
  const mh = await sha256Hex(mText);
  if (mh === null) hashVerified = false; else if (mh !== latest.manifest_sha256) throw new Error('Manifest hash mismatch');
  const manifest = JSON.parse(mText) as Manifest;
  if (manifest.app_schema !== SUPPORTED_APP_SCHEMA) throw new Error(`Incompatible release schema ${manifest.app_schema}`);
  if (manifest.release_id !== latest.release_id) throw new Error('Pointer/manifest release mismatch');
  const dir = latest.manifest.replace(/manifest\.json$/, '');
  const texts: Record<string, string> = {};
  await Promise.all(Object.keys(manifest.files).map(async (name) => {
    const t = await fetcher(dir + name);
    const h = await sha256Hex(t);
    if (h === null) hashVerified = false; else if (h !== manifest.files[name].sha256) throw new Error(`Hash mismatch for ${name}`);
    texts[name] = t;
  }));
  const graph = JSON.parse(texts['graph.json']) as Graph;
  const sources = (JSON.parse(texts['sources.json']) as { sources: Record<string, Source> }).sources;
  const views: Record<string, ViewManifest> = {};
  for (const v of manifest.views) views[v] = JSON.parse(texts[`views/${v}.json`]);
  if (graph.release_id !== manifest.release_id) throw new Error('graph.json belongs to a different release');
  const errs = validateRelease(graph, sources, views);
  if (errs.length) throw new Error('Release validation failed:\n' + errs.slice(0, 10).join('\n'));
  return { manifest, graph, sources, views, hashVerified };
}
