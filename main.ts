// Token Radar, radar-2 entry (Node 22, standard library only).
//
// main.ts reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>), scores
// every pre-token protocol with the calibrated model in lib/model.ts, writes the ranked board to
// /output/board.json, writes the dashboard's data beside the page as data.js, copies this
// repository's dashboard/ and screenshots/ to /output, and writes /output/dossier.json with the
// vendored make.fun library, so the judge reads exactly what the scorer checks.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
// The program runs twice and both runs must write the same bytes: it reads only the sealed
// snapshot and its own files, takes no clock reading and opens no network.
//
// Before the dossier is written, the program refuses outputs the gate would refuse anyway — a
// screenshot past its byte cap, a dashboard past the dossier's text cap — with a plain error,
// instead of handing in a cut dossier.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the dossier, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

/** Refuse with a plain error on stderr and a non-zero exit. */
function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

/** The whole run, as one function, so the entrypoint stays a short call at the bottom. */
function run(): void {
  const inputLocation = arg('input', '/input');
  const inputPath = inputLocation.endsWith('.json') ? inputLocation : join(inputLocation, 'snapshot.json');
  if (!existsSync(inputPath)) {
    fail(`no snapshot at ${inputPath}: pass --input <snapshot.json|directory> or mount the sealed /input`);
  }
  const outDir = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

  const snapshot = parseSnapshot(readFileSync(inputPath, 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) {
    fail(`the model wrote a board the gate refuses: ${issue}`);
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(outDir, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

/** The dashboard's copied files, refused unless the dossier can carry their source whole. */
function checkDashboard(dashboardFiles: string[], outDir: string): number {
  if (dashboardFiles.length === 0) {
    fail('dashboard/ holds no files: the dossier would carry no page');
  }
  // The dossier's text shows the dashboard's source whole only while it fits in the text cap;
  // refuse past it rather than hand in a cut source.
  const dashboardBytes = dashboardFiles.reduce((sum, name) => sum + statSync(join(outDir, 'dashboard', name)).size, 0);
  if (dashboardBytes > TEXT_MAX_BYTES) {
    fail(`dashboard/ is ${dashboardBytes} bytes, past the ${TEXT_MAX_BYTES}-byte text cap: the judge would read a cut source`);
  }
  return dashboardBytes;
}

/** One screenshot's bytes: a whole PNG or JPEG, by its magic bytes. */
function isWholeImage(head: Buffer): boolean {
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const isJpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  return isPng || isJpeg;
}

/** The screenshots, refused unless there are three whole images inside their byte cap. */
function checkScreenshots(shots: string[], outDir: string): void {
  if (shots.length < 3) {
    fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
  }
  for (const name of shots) {
    if (!IMAGE_NAME.test(name)) {
      fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
    }
    const bytes = statSync(join(outDir, 'screenshots', name)).size;
    if (bytes > SCREENSHOT_CAPS.max_bytes) {
      fail(`screenshots/${name} is ${bytes} bytes, past the ${SCREENSHOT_CAPS.max_bytes}-byte cap`);
    }
    // A truncated file is refused here, not by the dossier builder with a less plain error.
    const head = readFileSync(join(outDir, 'screenshots', name)).subarray(0, 8);
    if (!isWholeImage(head)) {
      fail(`screenshots/${name} is not a whole PNG or JPEG`);
    }
  }
}

  const dashboardNames = copyFiles(join(here, 'dashboard'), join(outDir, 'dashboard'));
  const dashboardSize = checkDashboard(dashboardNames, outDir);

  const shotNames = copyFiles(join(here, 'screenshots'), join(outDir, 'screenshots'));
  checkScreenshots(shotNames, outDir);

  // The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
  writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

  const topMix = radar.concentration[0];
  process.stdout.write(
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
      `token radar: model ${radar.model_version}, calibrated on ${radar.calibration.live_protocols} live protocols: global median market-cap/TVL ${radar.calibration.global_median.toFixed(3)}, top multiple ${radar.calibration.categories[0]?.category} ${radar.calibration.categories[0]?.multiple.toFixed(3)}\n` +
      (topMix === undefined
        ? ''
        : `token radar: top-ten concentration: ${topMix.category} holds ${topMix.top10_rows} of the top ten\n`) +
      `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')} (${dashboardNames.length} files, ${dashboardSize} bytes), ${join(outDir, 'screenshots')} (${shotNames.length} images) and ${join(outDir, 'dossier.json')}\n`,
  );
}

run();
