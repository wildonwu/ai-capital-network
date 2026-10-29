// Inlines the current release (latest pointer + all pinned files) into dist-single/index.html so it works from file://
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const data = path.join(root, 'public/data');
const latestText = fs.readFileSync(path.join(data, 'latest.json'), 'utf8');
const latest = JSON.parse(latestText);
const mText = fs.readFileSync(path.join(data, latest.manifest), 'utf8');
const m = JSON.parse(mText);
const dir = latest.manifest.replace(/manifest\.json$/, '');
const embed = { 'latest.json': latestText, [latest.manifest]: mText };
for (const f of Object.keys(m.files)) embed[dir + f] = fs.readFileSync(path.join(data, dir, f), 'utf8');
const json = JSON.stringify(embed).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const out = path.join(root, 'dist-single/index.html');
let html = fs.readFileSync(out, 'utf8');
html = html.replace('<head>', `<head>\n<script>window.__ACN_EMBED__=${json};</script>`);
fs.writeFileSync(out, html);
console.log(`dist-single/index.html ${(html.length / 1024).toFixed(0)} KB (release ${m.release_id} embedded)`);
