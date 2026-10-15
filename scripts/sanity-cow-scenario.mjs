/** Native simulation scenario; run only when no other benchmark is running.
 * node scripts/sanity-cow-scenario.mjs [baseline-root] [candidate-root] [candidate-terrain]
 * Defaults isolate the candidate terrain override against the baseline dependency tree.
 * Every post-setup building mutation is performed by a normal worker build command.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { build } from 'esbuild';
import ts from 'typescript';
const scoped = process.env.SANITY_SCOPES === '1';

const baselineRoot = path.resolve(process.argv[2] ?? '/tmp/sanity-control');
const candidateRoot = path.resolve(process.argv[3] ?? baselineRoot);
const candidateTerrain = path.resolve(process.argv[4] ?? '/tmp/sanity-terrain-cow.ts');
const config = { cells: 256, cell: 32, soldiers: 24, warmTicks: 8, maxTicks: 240, afterMutation: 12, abbaCycles: 2 };
const temporary = await mkdtemp(path.join(tmpdir(), 'sanity-cow-scene-'));
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const metadata = {};
function replaceOnce(source, needle, replacement) {
  assert.equal(source.split(needle).length, 2, `instrumentation anchor must occur exactly once: ${needle}`);
  return source.replace(needle, replacement);
}
async function load(label, index) {
  const root = label === 'A' ? baselineRoot : candidateRoot;
  const terrainPath = path.join(root, 'src/shared/terrain.ts');
  const terrainSource = await readFile(label === 'A' ? terrainPath : candidateTerrain, 'utf8');
  metadata[label] = { root, terrainSource: label === 'A' ? terrainPath : candidateTerrain,
    terrainSha256: hash(terrainSource), simSha256: hash(await readFile(path.join(root, 'src/shared/sim.ts'), 'utf8')) };
  let instrumented = 'const __cow = { requests: 0, cold: 0, links: 0, costs: {} as Record<string, number>, detach: [] as { request: number; shared: boolean; warm: boolean }[] };\n' + terrainSource;
  instrumented = replaceOnce(instrumented, 'function tilesOf(state: TerrainRuntime): Tiles {',
    'function tilesOf(state: TerrainRuntime): Tiles { __cow.requests++; if (!state.tiles) __cow.cold++;');
  instrumented = replaceOnce(instrumented, 'function linkSector(state: TerrainRuntime, tiles: Tiles, sector: number) {',
    'function linkSector(state: TerrainRuntime, tiles: Tiles, sector: number) { __cow.links++;');
  instrumented = replaceOnce(instrumented, '    const fresh = createRuntime(terrain, "land");',
    '    __cow.detach.push({ request: __cow.requests, shared: !!current?.shared, warm: !!current?.state.tiles });\n    const fresh = createRuntime(terrain, "land");');
  if (scoped) {
    const names = new Set(['createRuntime','setBuildingBodies','tilesOf','labelIslands','linkSector','fillClearance','goalFieldOf','growBoxInto']);
    const ast = ts.createSourceFile('terrain.ts', instrumented, ts.ScriptTarget.Latest, true), edits = [];
    for (const node of ast.statements) if (ts.isFunctionDeclaration(node) && node.body && names.has(node.name?.text)) {
      edits.push([node.body.getStart(ast)+1, '\nconst __start=performance.now();try{']);
      edits.push([node.body.end-1, `}finally{__cow.costs[${JSON.stringify(node.name.text)}]=(__cow.costs[${JSON.stringify(node.name.text)}]??0)+performance.now()-__start;}\n`]);
    }
    for (const [at, text] of edits.sort((a,b)=>b[0]-a[0])) instrumented=instrumented.slice(0,at)+text+instrumented.slice(at);
  }
  instrumented += '\nexport const sanityCowDiagnostics = __cow;\n';
  const entry = `export { createGame, issuePlayerCommand, stepGame, snapshotGame } from ${JSON.stringify(path.join(root, 'src/shared/sim.ts'))};
    export { createUnit, createBuilding } from ${JSON.stringify(path.join(root, 'src/shared/map.ts'))};
    export { steerPoint, walkDestination, isOpenGround, sanityCowDiagnostics } from ${JSON.stringify(terrainPath)};`;
  const result = await build({ stdin: { contents: entry, loader: 'ts', resolveDir: root }, bundle: true,
    platform: 'node', format: 'esm', write: false, logLevel: 'silent',
    plugins: [{ name: 'terrain-override-and-identical-counters', setup(builder) {
      builder.onLoad({ filter: /terrain\.ts$/ }, args => args.path === terrainPath
        ? { contents: instrumented, loader: 'ts', resolveDir: path.dirname(terrainPath) } : undefined);
    } }],
  });
  const output = path.join(temporary, `${index}-${label}.mjs`);
  await writeFile(output, result.outputFiles[0].contents);
  return import(pathToFileURL(output).href);
}
function setup(api) {
  const game = api.createGame('bareDuel', { aiPlayers: [] });
  game.scriptedVictory = true;
  game.resources = []; game.obstacles = []; game.items = []; game.mercenaryCamps = []; game.shops = [];
  game.effects = []; game.projectiles = [];
  const { cells: n, cell } = config, middle = n/2;
  // A natural rock ridge makes the distant army use actual flow-tile routing.
  const terrainCells = Array.from({ length: n*n }, (_, i) => {
    const x = i%n, y = Math.floor(i/n);
    return x >= middle-2 && x <= middle+2 && y >= n/4 && y <= n*3/4 ? '#' : '.';
  }).join('');
  game.map = { ...game.map, width: n*cell, height: n*cell,
    terrain: { cell, cols: n, rows: n, cells: terrainCells } };
  game.buildings = [api.createBuilding('scenario-hall', 'player', 'townHall', 256, 256, true)];
  const worker = api.createUnit('scenario-builder', 'player', 'worker', 400, 512);
  const soldiers = Array.from({ length: config.soldiers }, (_, i) =>
    api.createUnit(`scenario-soldier-${i}`, 'player', 'footman', n*cell/4+(i%4)*40, n*cell/2+Math.floor(i/4)*40));
  game.units = [worker, ...soldiers];
  game.players.player.gold = 10000;
  game.players.player.supplyCap = 200;
  api.issuePlayerCommand(game, 'player', { type: 'move', unitIds: soldiers.map(unit => unit.id), x: n*cell*3/4, y: n*cell/2 });
  return { game, worker };
}
function probes(api, map, buildGoal) {
  const { cells: n, cell } = config;
  const pairs = [
    [{ x: n*cell/4, y: n*cell/2 }, { x: n*cell*3/4, y: n*cell/2 }],
    [{ x: buildGoal.x-150, y: buildGoal.y }, { x: buildGoal.x+150, y: buildGoal.y }],
    [{ x: buildGoal.x, y: buildGoal.y-150 }, { x: buildGoal.x, y: buildGoal.y+150 }],
  ];
  return { open: api.isOpenGround(map, buildGoal.x, buildGoal.y), routes: pairs.map(([from, to]) =>
    ({ steer: api.steerPoint(map, from, to), destination: api.walkDestination(map, from, to) })) };
}
async function run(label, index) {
  const api = await load(label, index), { game, worker } = setup(api), diag = api.sanityCowDiagnostics;
  for (let i=0; i<config.warmTicks; i++) { api.stepGame(game); api.snapshotGame(game); }
  assert.ok(diag.requests > 0 && diag.cold > 0, 'normal army movement must warm the routing graph');
  assert.equal(game.buildings.length, 1);
  const saved = api.snapshotGame(game);
  api.issuePlayerCommand(game, 'player', { type: 'build', unitId: worker.id, buildingKind: 'farm', x: 512, y: 512 });
  assert.equal(worker.order.type, 'build', 'normal build command must be accepted');
  const buildGoal = { x: worker.order.x, y: worker.order.y };
  const oldAnswers = probes(api, saved.map, buildGoal), oldSnapshotHash = hash(saved);
  assert.equal(oldAnswers.open, true);
  const ticks = [];
  let mutationTick, firstRoutingTick;
  for (let i=0; i<config.maxTicks; i++) {
    const beforeBuildings = game.buildings.length;
    const before = { requests: diag.requests, cold: diag.cold, links: diag.links, detach: diag.detach.length };
    diag.costs = {};
    const start = performance.now(); api.stepGame(game); const stepMs = performance.now()-start;
    const detach = diag.detach.slice(before.detach);
    if (game.buildings.length !== beforeBuildings) {
      assert.equal(game.buildings.length, 2, 'only the commanded foundation may change the body set');
      assert.equal(mutationTick, undefined, 'only one building mutation is expected');
      mutationTick = game.tick;
      assert.ok(detach.some(event => event.shared && event.warm), 'mutation must detach a shared warm overlay');
    }
    if (mutationTick !== undefined && firstRoutingTick === undefined) {
      const event = detach.find(event => event.shared && event.warm);
      if (event ? diag.requests > event.request : game.tick > mutationTick && diag.requests > before.requests)
        firstRoutingTick = game.tick;
    }
    // Snapshot cadence is identical in both variants; separate its cost from full stepGame.
    const snapshotStart = performance.now(), snapshot = api.snapshotGame(game), snapshotMs = performance.now()-snapshotStart;
    ticks.push({ tick: game.tick, stepMs, snapshotMs, buildings: game.buildings.length,
      costs: { ...diag.costs }, tileRequests: diag.requests-before.requests, coldBuilds: diag.cold-before.cold,
      sectorLinks: diag.links-before.links, detach, stateHash: hash(snapshot) });
    if (firstRoutingTick !== undefined && game.tick >= firstRoutingTick+config.afterMutation) break;
  }
  assert.notEqual(mutationTick, undefined, 'normal worker simulation must create the foundation');
  assert.notEqual(firstRoutingTick, undefined, 'must observe actual tile queries after the mutation');
  assert.deepStrictEqual(probes(api, saved.map, buildGoal), oldAnswers, 'retained old snapshot geometry must remain unchanged');
  assert.equal(hash(saved), oldSnapshotHash, 'old authoritative snapshot must remain unchanged');
  const liveAnswers = probes(api, game.map, buildGoal);
  assert.equal(liveAnswers.open, false, 'new foundation must block the live map');
  const row = { label, index, mutationTick, firstRoutingTick, ticks, oldAnswers, liveAnswers,
    oldSnapshotHash, finalHash: ticks.at(-1).stateHash,
    totalStepMs: ticks.reduce((sum, tick) => sum+tick.stepMs, 0),
    totalSnapshotMs: ticks.reduce((sum, tick) => sum+tick.snapshotMs, 0) };
  console.log(JSON.stringify({ type: 'run', ...row }));
  return row;
}
try {
  console.log(JSON.stringify({ type: 'config', config, scoped, baselineRoot, candidateRoot, candidateTerrain,
    note: 'Diagnostic counters instrument both variants identically. Includes every full simulation step; snapshot work reported separately. Builds and correctness probes are outside timed steps.' }));
  let reference;
  const runs = [];
  for (let cycle=0; cycle<config.abbaCycles; cycle++) for (const label of ['A', 'B', 'B', 'A']) {
    const row = await run(label, runs.length);
    const authority = { mutationTick: row.mutationTick, firstRoutingTick: row.firstRoutingTick,
      tickHashes: row.ticks.map(tick => [tick.tick, tick.stateHash]), oldAnswers: row.oldAnswers,
      liveAnswers: row.liveAnswers, oldSnapshotHash: row.oldSnapshotHash, finalHash: row.finalHash };
    if (!reference) reference = authority;
    else assert.deepStrictEqual(authority, reference, `entire per-tick authority/route comparison for ${label}${runs.length}`);
    runs.push(row);
  }
  console.log(JSON.stringify({ type: 'result', status: 'PASS', metadata, config,
    runs: runs.map(row => ({ label: row.label, index: row.index, mutationTick: row.mutationTick,
      firstRoutingTick: row.firstRoutingTick, totalStepMs: row.totalStepMs, totalSnapshotMs: row.totalSnapshotMs,
      eventTicks: row.ticks.filter(tick => tick.tick >= row.mutationTick-1 && tick.tick <= row.firstRoutingTick+2),
      finalHash: row.finalHash })) }));
} finally { await rm(temporary, { recursive: true, force: true }); }
