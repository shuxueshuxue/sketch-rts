/** Complete-module differential proof; run only after performance timing ends.
 * node scripts/sanity-overlay-proof.mjs [control-root] [candidate-terrain.ts] [report.json]
 * Both dependency graphs resolve from control-root; B overrides only terrain.ts.
 * This file deliberately does not instrument or rewrite either function body.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(process.argv[2] ?? '/tmp/sanity-control');
const override = path.resolve(process.argv[3] ?? '/tmp/sanity-terrain-cow.ts');
const reportPath = path.resolve(process.argv[4] ?? '/tmp/sanity-overlay-proof-result.json');
const sourcePath = path.join(root, 'src/shared/terrain.ts');
const temporary = await mkdtemp(path.join(tmpdir(), 'sanity-overlay-proof-'));
const sha = text => createHash('sha256').update(text).digest('hex');
const report = { status: 'running', sourceSHA: {}, comparisons: 0, calls: {}, mutations: 0, snapshots: 0,
  seed: '0x591c0a7', fixtures: [], context: null };
let seed = 0x591c0a7;
const random = limit => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % limit);

async function load(label, contents) {
  const compiled = await build({ stdin: { contents: `export * from ${JSON.stringify(sourcePath)};`,
    resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false,
    metafile: true, logLevel: 'silent', plugins: [{ name: 'terrain-source-only', setup(builder) {
      builder.onLoad({ filter: /terrain\.ts$/ }, args => args.path === sourcePath
        ? { contents, loader: 'ts', resolveDir: path.dirname(sourcePath) } : undefined);
    } }] });
  report.sourceSHA[label] = { path: label === 'A' ? sourcePath : override, sha256: sha(contents),
    bundleSha256: sha(compiled.outputFiles[0].contents), dependencyRoot: root,
    inputs: Object.keys(compiled.metafile.inputs) };
  const output = path.join(temporary, `${label}.mjs`);
  await writeFile(output, compiled.outputFiles[0].contents);
  return import(pathToFileURL(output).href);
}

function compare(actual, expected, context) {
  report.context = context;
  report.comparisons++;
  try { assert.deepStrictEqual(actual, expected); }
  catch (error) {
    report.failure = { context, actual, expected, message: error.message };
    throw error;
  }
}
function call(api, name, map, args) {
  report.calls[name] = (report.calls[name] ?? 0) + 1;
  try {
    const returned = api[name](map, ...args);
    // Preserve observable input aliases as well as values. Only object identity matters here.
    const aliases = args.flatMap((argument, index) => argument !== null && typeof argument === 'object'
      && returned === argument ? [index] : []);
    return { returned, aliases };
  } catch (error) { return { threw: { name: error.name, message: error.message } }; }
}
function check(A, B, a, b, name, args, context) {
  const before = JSON.stringify(args);
  const expected = call(A, name, a, args);
  const actual = call(B, name, b, args);
  compare(actual, expected, { ...context, name, args });
  assert.ok(!expected.threw, `unexpected control exception: ${JSON.stringify({ context, name, args, expected })}`);
  assert.equal(JSON.stringify(args), before, 'query arguments mutated');
  return expected;
}
const center = (col, row) => ({ x: (col + .5) * 32, y: (row + .5) * 32 });
const body = (col, row, radius = 16) => ({ ...center(col, row), radius });

function fixture(name) {
  const cols = 63, rows = 47, cell = 32;
  const cells = Array.from({ length: cols * rows }, (_, at) => {
    const x = at % cols, y = Math.floor(at / cols);
    if (name === 'coasts' && (x > 48 || y > 39)) return (x + y) % 9 === 0 ? ',' : '~';
    if (name !== 'open' && x === 30 && y !== 9 && y !== 20 && y !== 35) return 'T';
    if (name !== 'open' && y === 30 && x > 8 && x < 45 && x !== 19 && x !== 39) return '#';
    return (x + y * 3) % 13 === 0 ? 'm' : (x + y) % 19 === 0 ? ',' : '.';
  }).join('');
  return { width: cols * cell, height: rows * cell, terrain: { cell, cols, rows, cells } };
}
function points() {
  return [center(1, 1), center(8, 9), center(9, 9), center(10, 10), center(11, 11),
    center(19, 20), center(20, 20), center(29, 9), center(30, 9), center(31, 9),
    center(39, 30), center(40, 30), center(45, 36), center(60, 44),
    { x: -1, y: 32 }, { x: 63 * 32, y: 47 * 32 }, { x: 320, y: 319.5 },
    ...Array.from({ length: 13 }, () => center(random(63), random(47)))];
}
function probe(A, B, a, b, ps, context, full = false) {
  if (full) for (let row = 0; row < 47; row++) for (let col = 0; col < 63; col++) {
    const p = center(col, row);
    check(A, B, a, b, 'isOpenGround', [p.x, p.y, 'land'], { ...context, col, row });
  }
  for (let index = 0; index < ps.length; index++) {
    const from = ps[index], goal = ps[(index * 7 + 11) % ps.length];
    for (const mover of ['land', 'sea']) {
      const at = { ...context, index, mover };
      check(A, B, a, b, 'isOpenGround', [from.x, from.y, mover], at);
      check(A, B, a, b, 'openGroundNear', [from, mover], at);
      check(A, B, a, b, 'walkableGoal', [goal.x, goal.y, mover], at);
      check(A, B, a, b, 'segmentWalkable', [from, goal, mover], at);
      check(A, B, a, b, 'openStep', [from, goal, mover], at);
      check(A, B, a, b, 'walkDestination', [from, goal, mover], at);
      check(A, B, a, b, 'steerPoint', [from, goal, mover], at);
    }
  }
}

try {
  const aSource = await readFile(sourcePath, 'utf8'), bSource = await readFile(override, 'utf8');
  assert.notEqual(sha(aSource), sha(bSource), 'candidate equals control: no COW experiment loaded');
  const A = await load('A', aSource), B = await load('B', bSource);
  const anchor = body(4, 4), cross = body(9, 9, 48), overlap = body(10, 9, 48);
  const wall = Array.from({ length: 11 }, (_, i) => body(19, 15 + i));
  const sequence = [
    [anchor], [anchor, cross], [anchor, cross, overlap], [anchor, overlap],
    [anchor, ...wall], [anchor, ...wall.filter((_, i) => i !== 5)],
    [anchor, ...wall, body(39, 30, 48)], [anchor, body(39, 30, 48)],
    [anchor, body(39, 30, 48), { ...anchor }], // body-list change, identical walkability
    [anchor, body(60, 44, 48)], [anchor], [], [anchor, overlap],
  ];
  for (const name of ['open', 'walls', 'coasts']) {
    const template = fixture(name), a = structuredClone(template), b = structuredClone(template);
    const original = JSON.stringify({ a, b }), ps = points(), retained = [];
    for (let generation = 0; generation < sequence.length; generation++) {
      const bodies = sequence[generation], context = { fixture: name, generation, bodies };
      if (generation > 0) {
        const oldA = { ...a }, oldB = { ...b };
        A.shareBuildingBodies(a, oldA); B.shareBuildingBodies(b, oldB);
        report.snapshots += 2;
        const frozen = ps.slice(0, 14).map((from, index) => {
          const args = [from, ps[(index + 9) % ps.length], 'land'];
          return { args, destination: call(A, 'walkDestination', oldA, args),
            steer: call(A, 'steerPoint', oldA, args) };
        });
        // The saved B view is intentionally not identically prewarmed: lazy next writes must remain harmless.
        retained.push({ a: oldA, b: oldB, generation: generation - 1, frozen });
      }
      A.setBuildingBodies(a, bodies); B.setBuildingBodies(b, bodies); report.mutations += 2;
      // Prime only a subset before interleaving snapshots; the later pass reaches still-lazy fields/cells.
      probe(A, B, a, b, ps.slice(0, 15), { ...context, stage: 'partial' });
      for (const old of [...retained].reverse()) {
        for (const [index, saved] of old.frozen.entries()) {
          const where = { ...context, oldGeneration: old.generation, index };
          for (const [api, map, side] of [[A, old.a, 'A'], [B, old.b, 'B']]) {
            compare(call(api, 'walkDestination', map, saved.args), saved.destination,
              { ...where, side, name: 'historical-walkDestination', args: saved.args });
            compare(call(api, 'steerPoint', map, saved.args), saved.steer,
              { ...where, side, name: 'historical-steerPoint', args: saved.args });
          }
        }
        probe(A, B, old.a, old.b, ps.slice(15), { ...context, stage: 'old-lazy', oldGeneration: old.generation });
      }
      probe(A, B, a, b, ps, { ...context, stage: 'after-old-queries' }, true);
      // An independently cold original module map is a second oracle for warm incremental behavior.
      const fresh = structuredClone(template);
      A.setBuildingBodies(fresh, bodies); report.mutations++;
      probe(A, B, fresh, b, ps, { ...context, stage: 'fresh-rebuild' });
      assert.equal(JSON.stringify({ a, b }), original, 'public map/terrain bytes changed');
    }
    // New terrain identity must not inherit any incompatible old overlay tiles.
    const changed = { ...template.terrain, cells: '~'.repeat(63 * 47) };
    a.terrain = structuredClone(changed); b.terrain = structuredClone(changed);
    A.setBuildingBodies(a, [anchor]); B.setBuildingBodies(b, [anchor]); report.mutations += 2;
    probe(A, B, a, b, ps, { fixture: name, stage: 'terrain-replaced' });
    report.fixtures.push({ name, generations: sequence.length, retainedSnapshots: retained.length,
      comparisonsSoFar: report.comparisons });
    console.log(JSON.stringify({ fixture: name, comparisons: report.comparisons, status: 'passed' }));
  }
  report.status = 'passed';
  report.context = null;
} catch (error) {
  report.status = 'failed';
  report.error = { name: error.name, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, reportPath }));
  await rm(temporary, { recursive: true, force: true });
}
