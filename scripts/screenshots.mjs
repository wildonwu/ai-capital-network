// Browser QA: takes screenshots and asserts key journeys. Usage: node scripts/screenshots.mjs [baseUrl]
import { chromium } from 'playwright';
import path from 'node:path';
const base = process.argv[2] ?? 'http://localhost:4173/';
const out = path.resolve(import.meta.dirname, '../screenshots');
const b = await chromium.launch();
const log = (...a) => console.log(...a);
const counts = (p) => p.evaluate(() => ({ n: window.__cy.nodes().length, e: window.__cy.edges().length }));
const errors = [];
async function page(w, h) { const p = await b.newPage({ viewport: { width: w, height: h } }); p.on('pageerror', (e) => errors.push(String(e))); return p; }

let p = await page(1440, 900);
await p.goto(base); await p.waitForSelector('[data-testid=cutoff]'); await p.waitForTimeout(800);
log('default', await counts(p), 'rows', await p.textContent('[data-testid=row-count]'), 'cutoff:', (await p.textContent('[data-testid=cutoff]')).slice(0, 90));
await p.screenshot({ path: `${out}/01-default-companies-1440.png` });
await p.screenshot({ path: `${out}/01b-default-companies-1440-fullpage.png`, fullPage: true });

await p.click('text=Full network (91)'); await p.waitForTimeout(800);
log('full', await counts(p), 'url', p.url().split('?')[1]);
await p.screenshot({ path: `${out}/02-full-network-1440.png` });

await p.click('text=Companies & capital channels (36)'); await p.waitForTimeout(400);
await p.fill('input[type=search]', 'OpenAI'); await p.click('.results button >> nth=0'); await p.waitForTimeout(600);
log('focus OpenAI rows', await p.textContent('[data-testid=row-count]'), 'url', p.url().split('?')[1]);
await p.screenshot({ path: `${out}/03-focus-openai-1440.png` });
await p.click('.node-detail .rel >> nth=0'); await p.waitForTimeout(400);
log('edge detail:', (await p.textContent('[data-testid=edge-detail]')).slice(0, 260));
await p.screenshot({ path: `${out}/04-edge-detail-1440.png` });
await p.keyboard.press('Escape'); await p.waitForTimeout(200);
log('after Esc url', p.url().split('?')[1], 'detail present', await p.$('[data-testid=edge-detail]') !== null);

await p.check('.oct-toggle input'); await p.click('text=Full network (91)'); await p.waitForTimeout(500);
log('oct-only full', await counts(p), 'rows', await p.textContent('[data-testid=row-count]'));
await p.screenshot({ path: `${out}/05-october-changes-full-1440.png` });

// URL restore + support-only
const p2 = await page(1440, 900);
await p2.goto(base + '?view=full-network&layers=support'); await p2.waitForSelector('[data-testid=cutoff]'); await p2.waitForTimeout(500);
log('url restore support-only', await counts(p2), 'rows', await p2.textContent('[data-testid=row-count]'));
// Chinese search
await p2.fill('input[type=search]', '项目'); await p2.waitForTimeout(200);
log('zh search results', (await p2.$$('.results li')).length);
const [dl] = await Promise.all([p2.waitForEvent('download'), p2.click('text=Export CSV')]);
log('csv download', dl.suggestedFilename());

const m = await page(390, 844);
await m.goto(base); await m.waitForSelector('[data-testid=cutoff]'); await m.waitForTimeout(500);
await m.screenshot({ path: `${out}/06-mobile-390-list.png`, fullPage: false });
await m.fill('input[type=search]', 'Anthropic'); await m.click('.results button >> nth=0'); await m.waitForTimeout(400);
await m.screenshot({ path: `${out}/07-mobile-390-entity.png`, fullPage: true });
await m.click('.mobile-tabs >> text=Graph'); await m.waitForTimeout(600);
await m.screenshot({ path: `${out}/08-mobile-390-graph.png` });
log('mobile horizontal overflow', await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth));
log('page errors', errors);
await b.close();
