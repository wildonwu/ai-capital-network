import { chromium } from 'playwright';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs=[]; p.on('pageerror', e=>errs.push(String(e))); p.on('console', m=>{ if(m.type()==='error') errs.push(m.text()) });
await p.goto(pathToFileURL(path.join(root, 'dist-single/index.html')).href);
await p.waitForSelector('[data-testid=cutoff]', { timeout: 10000 }); await p.waitForTimeout(800);
console.log(await p.evaluate(() => ({ n: window.__cy.nodes().length, e: window.__cy.edges().length })), (await p.textContent('[data-testid=cutoff]')).slice(-30), errs);
await p.screenshot({ path: path.join(root, 'screenshots/09-single-file-build-1440.png') }); await b.close();
