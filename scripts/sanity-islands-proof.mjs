/** Original complete-module BFS vs candidate region DSU; write-only preparation.
 * Run after performance timing: node scripts/sanity-islands-proof.mjs [control-root] [candidate.ts] [report.json]
 * Only diagnostic exports are appended; no original function body is rewritten.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(process.argv[2] ?? '/tmp/sanity-control');
const candidatePath = path.resolve(process.argv[3] ?? '/tmp/sanity-terrain-cow-regions.ts');
const reportPath = path.resolve(process.argv[4] ?? '/tmp/sanity-islands-proof-result.json');
const sourcePath = path.join(root, 'src/shared/terrain.ts');
const temporary = await mkdtemp(path.join(tmpdir(), 'sanity-islands-proof-'));
const sha = contents => createHash('sha256').update(contents).digest('hex');
const report = { status: 'running', sourceSHA: {}, comparisons: 0, cellsCompared: 0,
  routingCalls: 0, patterns: 0, generations: 0, snapshots: 0, phases: [], context: null };

async function load(label, source) {
  const result = await build({ stdin: { contents: `export * from ${JSON.stringify(sourcePath)};`,
    resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false,
    metafile: true, logLevel: 'silent', plugins: [{ name: 'source-and-diagnostic-exports', setup(builder) {
      builder.onLoad({ filter: /terrain\.ts$/ }, args => args.path === sourcePath ? {
        contents: source + '\nexport { routing as diagnosticRouting, tilesOf as diagnosticTilesOf };\n',
        loader: 'ts', resolveDir: path.dirname(sourcePath),
      } : undefined);
    } }] });
  report.sourceSHA[label] = { path: label === 'A' ? sourcePath : candidatePath, sha256: sha(source),
    bundleSha256: sha(result.outputFiles[0].contents), dependencyRoot: root,
    inputs: Object.keys(result.metafile.inputs) };
  const file = path.join(temporary, `${label}.mjs`);
  await writeFile(file, result.outputFiles[0].contents);
  return import(pathToFileURL(file).href);
}
function labels(api, map, mover) {
  report.routingCalls++;
  return api.diagnosticTilesOf(api.diagnosticRouting(map, map.terrain, mover)).island;
}
function equal(actual, expected, context) {
  report.context = context;
  report.comparisons++;
  report.cellsCompared += expected.length;
  try { assert.deepStrictEqual(actual, expected); }
  catch (error) {
    const differences = [];
    for (let i = 0; i < Math.max(actual.length, expected.length) && differences.length < 32; i++) {
      if (actual[i] !== expected[i]) differences.push({ paddedIndex: i, actual: actual[i], expected: expected[i] });
    }
    report.failure = { context, actualLength: actual.length, expectedLength: expected.length, differences,
      actual: Array.from(actual), expected: Array.from(expected) };
    throw error;
  }
}
function mapOf(cols, rows, charAt) {
  return { width: cols * 32, height: rows * 32, terrain: { cell: 32, cols, rows,
    cells: Array.from({ length: cols * rows }, (_, at) => charAt(at % cols, Math.floor(at / cols))).join('') } };
}
function compareMap(A, B, source, context) {
  const a = structuredClone(source), b = structuredClone(source);
  for (const mover of ['land', 'sea']) {
    const expected = labels(A, a, mover), actual = labels(B, b, mover);
    equal(actual, expected, { ...context, mover, terrain: source.terrain });
    // Repeated tile reads must retain the same complete labels, not only component equivalence.
    equal(labels(B, b, mover), expected, { ...context, mover, warm: true, terrain: source.terrain });
  }
  return { a, b };
}
const center = (x, y) => ({ x: (x + .5) * 32, y: (y + .5) * 32 });
const body = (x, y, radius = 16) => ({ ...center(x, y), radius });

try {
  const original = await readFile(sourcePath, 'utf8'), candidate = await readFile(candidatePath, 'utf8');
  assert.notEqual(sha(original), sha(candidate), 'candidate is identical to original');
  assert.match(original, /function labelIslands[\s\S]*?const queue = new Int32Array\(walk\.length\)/,
    'control must contain original cell BFS');
  const A = await load('A', original), B = await load('B', candidate);

  for (const [cols, rows] of [[1, 1], [1, 31], [31, 1], [9, 9], [10, 10], [11, 11], [21, 17], [33, 24]]) {
    for (const mode of ['open', 'blocked', 'checker', 'stripes', 'gaps', 'weighted']) {
      const source = mapOf(cols, rows, (x, y) => mode === 'open' ? ',' : mode === 'blocked' ? '#'
        : mode === 'checker' ? ((x + y) % 2 ? '#' : ',')
        : mode === 'stripes' ? (x % 2 ? '#' : ',')
        : mode === 'gaps' ? (x % 10 === 9 && y % 10 !== 9 ? '#' : ',')
        : ['.', ',', 'm', '~', '#', '='][(x * 3 + y) % 6]);
      const pair = compareMap(A, B, source, { phase: 'shapes', cols, rows, mode });
      if (cols === 10 && rows === 10 && mode === 'checker') {
        const distinct = new Set(labels(A, pair.a, 'land')); distinct.delete(-1);
        assert.equal(distinct.size, 50, 'fixture must attain 50 sector components');
      }
    }
  }
  report.phases.push('shapes');
  console.log(JSON.stringify({ phase: 'shapes', comparisons: report.comparisons }));

  // All 512 patterns, not a sample. ',' is open to both movers. Both blocked
  // and open backgrounds test isolated components and alternative connections.
  const placements = [
    { name: 'inside', x: 3, y: 3, cols: 13, rows: 13 },
    { name: 'vertical-seam', x: 9, y: 3, cols: 13, rows: 13 },
    { name: 'horizontal-seam', x: 3, y: 9, cols: 13, rows: 13 },
    { name: 'four-sectors', x: 9, y: 9, cols: 13, rows: 13 },
    { name: 'partial-edge-sectors', x: 19, y: 9, cols: 22, rows: 12 },
  ];
  for (const placement of placements) {
    for (const background of ['#', ',']) for (let pattern = 0; pattern < 512; pattern++) {
      const source = mapOf(placement.cols, placement.rows, (x, y) => {
        const dx = x - placement.x, dy = y - placement.y;
        return dx >= 0 && dx < 3 && dy >= 0 && dy < 3 ? (pattern & (1 << (dy * 3 + dx)) ? ',' : '#') : background;
      });
      compareMap(A, B, source, { phase: 'patterns', placement: placement.name, pattern, background });
      report.patterns++;
    }
    console.log(JSON.stringify({ phase: placement.name, patterns: report.patterns, comparisons: report.comparisons }));
  }
  report.phases.push('patterns');

  const anchor = body(2, 2), wall = Array.from({ length: 24 }, (_, y) => body(19, y));
  const updates = [[anchor], [anchor, body(9, 9, 48)], [anchor, body(9, 9, 48), body(10, 9, 48)],
    [anchor, body(10, 9, 48)], [anchor, ...wall], [anchor, ...wall.filter((_, i) => i !== 10)],
    [anchor, ...wall, body(29, 19, 48)], [anchor, body(29, 19, 48)],
    [anchor, body(29, 19, 48), { ...anchor }], [anchor], [], [anchor, body(9, 9, 48)]];
  for (const mode of ['open', 'split']) {
    const source = mapOf(33, 24, (x, y) => mode === 'split' && x === 10 && y !== 9 && y !== 20 ? '#' : ',');
    const a = structuredClone(source), b = structuredClone(source), retained = [];
    for (let generation = 0; generation < updates.length; generation++) {
      report.context = { phase: 'updates', mode, generation, bodies: updates[generation], terrain: source.terrain };
      if (generation > 0) {
        const oldA = { ...a }, oldB = { ...b };
        A.shareBuildingBodies(a, oldA); B.shareBuildingBodies(b, oldB);
        retained.push({ a: oldA, b: oldB, generation: generation - 1,
          expected: labels(A, oldA, 'land').slice() });
        report.snapshots += 2;
      }
      A.setBuildingBodies(a, updates[generation]); B.setBuildingBodies(b, updates[generation]);
      const context = { phase: 'updates', mode, generation, bodies: updates[generation], terrain: source.terrain };
      const expected = labels(A, a, 'land');
      equal(labels(B, b, 'land'), expected, context);
      // Interleave lazy field queries with checks of every previous retained island array.
      for (const old of [...retained].reverse()) {
        for (const [api, map] of [[A, old.a], [B, old.b], [A, a], [B, b]]) {
          api.walkDestination(map, center(1, 1), center(31, 22));
          api.steerPoint(map, center(3, 21), center(30, 2));
        }
        equal(labels(A, old.a, 'land'), old.expected, { ...context, side: 'A', oldGeneration: old.generation });
        equal(labels(B, old.b, 'land'), old.expected, { ...context, side: 'B', oldGeneration: old.generation });
      }
      equal(labels(B, b, 'land'), labels(A, a, 'land'), { ...context, afterOldReads: true });
      equal(labels(B, b, 'sea'), labels(A, a, 'sea'), { ...context, mover: 'sea' });
      const fresh = structuredClone(source); A.setBuildingBodies(fresh, updates[generation]);
      equal(labels(B, b, 'land'), labels(A, fresh, 'land'), { ...context, freshRebuild: true });
      report.generations++;
    }
  }
  report.phases.push('updates');
  report.status = 'passed'; report.context = null;
} catch (error) {
  report.status = 'failed';
  report.error = { name: error.name, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, reportPath }));
  await rm(temporary, { recursive: true, force: true });
}
