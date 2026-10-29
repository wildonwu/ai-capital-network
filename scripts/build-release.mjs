// Builds an immutable static release from data/seed into public/data/releases/<id>/ and
// atomically updates public/data/latest.json only after all files + manifest are written and validated.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const seed = (f) => JSON.parse(fs.readFileSync(path.join(root, 'data/seed', f), 'utf8'));
const snap = seed('snapshot.public.json');
const full = seed('full-network.view.json');
const comp = seed('companies-network.view.json');

const releaseId = snap.snapshot_id;
const outDir = path.join(root, 'public/data/releases', releaseId);
const stage = outDir + '.staging';
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, 'views'), { recursive: true });

// ---- validation (fail closed: latest pointer untouched on error)
const errs = [];
const ids = new Set(snap.nodes.map((n) => n.id));
if (ids.size !== snap.nodes.length) errs.push('duplicate node ids');
const eids = new Set(snap.edges.map((e) => e.id));
if (eids.size !== snap.edges.length) errs.push('duplicate edge ids');
for (const e of snap.edges) {
  if (!ids.has(e.from) || !ids.has(e.to)) errs.push(`edge ${e.id} endpoint missing`);
  if (!(e.source in snap.sources)) errs.push(`edge ${e.id} source ${e.source} missing`);
  if (!e.status) errs.push(`edge ${e.id} no status`);
  if (e.amount !== null && !e.unit) errs.push(`edge ${e.id} amount without unit`);
}
for (const v of [full, comp]) {
  for (const n of v.node_ids) if (!ids.has(n)) errs.push(`${v.view_id} node ${n} missing`);
  for (const e of v.edge_ids) if (!eids.has(e)) errs.push(`${v.view_id} edge ${e} missing`);
}
if (errs.length) { console.error(errs.join('\n')); process.exit(1); }

const graph = {
  schema_version: snap.schema_version,
  release_id: releaseId,
  as_of: snap.as_of,
  release_type: snap.release_type,
  core: snap.core,
  nodes: snap.nodes.map((n) => ({
    id: n.id,
    label_raw: n.label,
    label_en: full.nodes[n.id]?.label ?? n.label,
    kind: n.kind,
  })),
  edges: snap.edges,
  coverage: snap.coverage,
  historical_amount_policy: snap.historical_amount_policy,
  data_quality_notice: snap.data_quality_notice,
};
const sources = { release_id: releaseId, sources: snap.sources };
const baseline = {
  release_id: releaseId,
  project_records: snap.project_records,
  baseline_expected: snap.baseline_expected,
  project_baseline: snap.project_baseline,
  project_groups: snap.project_groups,
  corporate_baseline: snap.corporate_baseline,
  october_deals: snap.october_deals,
};
const files = {
  'graph.json': graph,
  'sources.json': sources,
  'baseline.json': baseline,
  'views/companies-network.json': { release_id: releaseId, ...comp },
  'views/full-network.json': { release_id: releaseId, ...full },
};
const manifestFiles = {};
for (const [name, obj] of Object.entries(files)) {
  const text = JSON.stringify(obj);
  fs.writeFileSync(path.join(stage, name), text);
  manifestFiles[name] = { sha256: crypto.createHash('sha256').update(text).digest('hex'), bytes: Buffer.byteLength(text) };
}
const manifest = {
  release_id: releaseId,
  schema_version: snap.schema_version,
  app_schema: 'acn-release-1',
  release_type: snap.release_type,
  as_of: snap.as_of,
  as_of_label: 'Intra-month October preview · cutoff 2026-10-28 17:04:34 UTC (2026-10-29 01:04:34 Asia/Taipei) · not a month-end release',
  published_at: new Date().toISOString(),
  previous_release_id: null,
  default_view: 'companies-network',
  views: ['companies-network', 'full-network'],
  files: manifestFiles,
  counts: { nodes: graph.nodes.length, relationships: graph.edges.length, sources: Object.keys(snap.sources).length },
  coverage_note: 'Defined research sample; not a complete market census. ' + snap.data_quality_notice,
};
const mText = JSON.stringify(manifest, null, 2);
fs.writeFileSync(path.join(stage, 'manifest.json'), mText);
fs.rmSync(outDir, { recursive: true, force: true });
fs.renameSync(stage, outDir);
const latest = { release_id: releaseId, manifest: `releases/${releaseId}/manifest.json`, manifest_sha256: crypto.createHash('sha256').update(mText).digest('hex') };
const tmp = path.join(root, 'public/data/latest.json.tmp');
fs.writeFileSync(tmp, JSON.stringify(latest, null, 2));
fs.renameSync(tmp, path.join(root, 'public/data/latest.json'));
console.log(`release ${releaseId}: ${manifest.counts.nodes} nodes / ${manifest.counts.relationships} edges / ${manifest.counts.sources} sources`);
