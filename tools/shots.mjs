// Screenshot tool for the token radar dashboard. Renders the dashboard from a model run and
// takes the three screenshots the entry hands in: the board, a protocol detail view, and a
// filtered view. Run from the repository root:
//
//   node tools/shots.mjs --input <snapshot.json>
//
// It writes data.js + dashboard/ into a scratch render directory, drives the Chrome for Testing
// binary already on this machine (headless, 1440x900), and writes the PNGs to screenshots/.
// The binary is the one the parent verified: the Muse browser binary refuses headless startup
// and the playwright auto-download fails here, so the executable path below is the working route.

import { chromium } from '/home/hatch/workspace/makefun/shot-tool/node_modules/playwright-core/index.mjs';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRadar, dataScript, parseSnapshot } from '../lib/model.ts';

const CHROME = '/home/hatch/workspace/makefun/shot-tool/chrome-linux64/chrome';
const VIEWPORT = { width: 1440, height: 900 };

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1];
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = join(here, '..');
const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`shots: no snapshot at ${inputFile}\n`);
  process.exit(2);
}
const renderDir = arg('render', '/tmp/radar-render');
const shotsDir = arg('shots', join(repo, 'screenshots'));

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { radar } = buildRadar(snapshot);
mkdirSync(renderDir, { recursive: true });
mkdirSync(join(renderDir, 'dashboard'), { recursive: true });
writeFileSync(join(renderDir, 'data.js'), dataScript(radar));
for (const name of readdirSync(join(repo, 'dashboard'))) {
  const path = join(repo, 'dashboard', name);
  if (statSync(path).isFile()) copyFileSync(path, join(renderDir, 'dashboard', name));
}
mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
const base = `file://${join(renderDir, 'dashboard', 'index.html')}`;

// One screenshot: wait for the board to render instead of a fixed sleep, so a slow first paint
// still lands, then let the page settle before the capture. A scroll selector moves the view
// to that element first, so a filtered shot shows the filter and the rows it leaves.
async function shot(url, file, scrollTo) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('#board .shell', { timeout: 10_000 });
  await page.waitForTimeout(300);
  if (scrollTo) {
    await page.locator(scrollTo).first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
  }
  await page.screenshot({ path: file });
  const bytes = statSync(file).size;
  process.stdout.write(`shots: ${file} ${bytes} bytes\n`);
  if (bytes > 524_288) throw new Error(`${file} is ${bytes} bytes, past the 512 KiB cap`);
  return bytes;
}

const rank1 = radar.rows[0].slug;
try {
  await shot(base, join(shotsDir, '1-board.png'));
  await shot(`${base}#p=${encodeURIComponent(rank1)}`, join(shotsDir, '2-detail.png'));
  await shot(`${base}#category=Lending`, join(shotsDir, '3-filtered.png'), '.controls');
} finally {
  // The browser closes even when a shot fails, so a bad capture never leaves a stray process.
  await browser.close();
}
process.stdout.write(`shots: done, rank-1 detail is ${rank1}\n`);
