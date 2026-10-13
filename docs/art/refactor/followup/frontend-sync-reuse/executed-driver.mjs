/** Actual TypeScript main-function subsets and production helper implementations.
 * Correctness/construction counts only; no browser, renderer, or FPS benchmark. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import gzip from 'node:zlib';
import ts from 'typescript';
import { createGame, snapshotGame } from '../src/shared/sim.ts';
import { shipProfile } from '../src/shared/ship-geometry.ts';
import { isInCabin } from '../src/shared/ship-cabin.ts';
import { focusedSelectionEntities } from '../src/client/hud-model.ts';
import { stanceFighters } from '../src/client/command-button-state.ts';
import { canLearnVeteranSkill } from '../src/client/veteran-controls.ts';
import { controlGroupCenter } from '../src/client/control-groups.ts';
import { soundCues } from '../src/client/sound-cues.ts';

const arg = key => { const at = process.argv.indexOf(key); return at < 0 ? undefined : process.argv[at + 1]; };
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseline = arg('--baseline') ?? '42bd61c74934dc76f30d42b62e1e31eb5c5974ff';
const out = resolve(arg('--out') ?? 'docs/art/refactor/followup/frontend-sync-reuse');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const changed = ['src/client/main.ts', 'src/client/frontend-world-view.ts', 'src/client/debug-view.ts', 'src/client/frontend-world-view.test.ts'];
const shared = ['src/client/hud-model.ts', 'src/client/command-button-state.ts', 'src/client/veteran-controls.ts', 'src/client/control-groups.ts',
  'src/client/sound-cues.ts', 'src/client/net/local-adapter.ts', 'src/client/game-adapter.ts', 'src/shared/sim.ts',
  'src/shared/ship-geometry.ts', 'src/shared/ship-cabin.ts'];
const original = {}, current = {}, artifacts = [];
await mkdir(out, { recursive: true });
for (const file of [...changed, ...shared]) {
  current[file] = await readFile(resolve(root, file), 'utf8');
  original[file] = execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, encoding: 'utf8' });
  if (shared.includes(file)) assert.equal(current[file], original[file], `Shared helper changed: ${file}`);
  for (const [arm, source] of [['before', original[file]], ['after', current[file]]]) {
    const dest = resolve(out, 'source', arm, `${file}.gz`), packed = gzip.gzipSync(Buffer.from(source), { level: 9, mtime: 0 });
    await mkdir(dirname(dest), { recursive: true }); await writeFile(dest, packed);
    assert.equal(gzip.gunzipSync(packed).toString(), source);
    artifacts.push({ arm, file, archive: dest.slice(out.length + 1), bytes: Buffer.byteLength(source), sha256: hash(source),
      gzipBytes: packed.length, gzipSha256: hash(packed) });
  }
}
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function load(text, file) {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compile(text))(createRequire(resolve(root, file)), module, module.exports);
  return module.exports;
}
const implementations = {};
const functionNames = ['syncActiveGameAdapterSnapshot', 'syncBeforeCommandProjection', 'syncDebugView', 'pruneSelection',
  'activateStartedMatch', 'disconnectActiveMatch', 'focusedPlayerUnits', 'focusedVeteranStudent', 'clearCommandModeClasses'];
for (const [arm, sources] of [['before', original], ['after', current]]) {
  const ast = ts.createSourceFile('main.ts', sources[changed[0]], ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const functions = functionNames.map(name => {
    const nodes = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.equal(nodes.length, 1, `Expected exactly one actual main ${name}`);
    return { name, source: nodes[0].getText(ast) };
  });
  const text = functions.map(entry => entry.source).join('\n\n');
  await writeFile(resolve(out, `executed-main-subset-${arm}.ts`), text);
  implementations[arm] = { ...load(sources[changed[1]], changed[1]), ...load(sources[changed[2]], changed[2]), functions, text };
}

function runtime(arm, initial) {
  const impl = implementations[arm], ledger = [], counts = { liveIdsBuilt: 0, adapterReads: 0, adapterUpdates: 0 }, window = {};
  const deps = { window, ledger, counts, shipProfile, isInCabin, focusedSelectionEntities, stanceFighters, canLearnVeteranSkill, controlGroupCenter,
    soundCues, createSketchRtsDebugView: impl.createSketchRtsDebugView,
    liveSelectionIds: (...args) => { counts.liveIdsBuilt++; return impl.liveSelectionIds(...args); } };
  // The actual sync helper calls this binding. This counts its invocation, not
  // array/property accesses or estimated allocations in unrelated operations.
  const helperText = original[changed[1]];
  const armAst = ts.createSourceFile('frontend.ts', arm === 'before' ? helperText : current[changed[1]], ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const node = armAst.statements.find(entry => ts.isFunctionDeclaration(entry) && entry.name?.text === 'syncFrontendWorldView');
  assert.ok(node);
  const { pruneControlGroups } = load(current['src/client/control-groups.ts'], 'src/client/control-groups.ts');
  const { resolveFocusedSelectionId } = load(current['src/client/hud-model.ts'], 'src/client/hud-model.ts');
  deps.syncFrontendWorldView = new Function('liveSelectionIds', 'pruneControlGroups', 'resolveFocusedSelectionId',
    `${compile(node.getText(armAst).replace(/^export\s+/, ''))}\nreturn syncFrontendWorldView;`)(deps.liveSelectionIds, pruneControlGroups, resolveFocusedSelectionId);
  const setup = `
    const {window,ledger,counts,shipProfile,isInCabin,focusedSelectionEntities,stanceFighters,canLearnVeteranSkill,controlGroupCenter,
      soundCues,createSketchRtsDebugView,liveSelectionIds,syncFrontendWorldView}=deps;
    let {snapshot,selectedIds,focusedSelectionId,selectedCampId,controlGroups,commandMode,openPalette,menuOpen=false}=initial;
    const localPlayerId='player', currentRoomId='room-proof', pendingVeteranChoices=new Map(initial.pendingVeteranChoices??[]);
    const baseGameAdapter={close(){ledger.push('base-close')}};
    let activeGameAdapter={updateToRenderTime(){counts.adapterUpdates++;return initial.changed??false},currentSnapshot(){counts.adapterReads++;return initial.nextSnapshot},close(){ledger.push('adapter-close')}};
    let activeChat,activeChatUnsubscribe,purchaseRecipientFlash,minimapRelations,minimapWind,windProbe,windTooltipKey,focusedStatusProjection;
    const shell={classList:{remove(...args){ledger.push(['class-remove',...args])}}};
    const worldPresentation={reset(){ledger.push('world-reset')}},minimapPresentation={reset(){ledger.push('minimap-reset')}};
    const combatPresentation={reset(){ledger.push('combat-reset')}},projectileOrigins={reset(){ledger.push('projectiles-reset')}};
    const purchaseRecipients=new Map(),windMapDisplay={reset(){ledger.push('wind-reset')}},minimapWindButton={setAttribute(...args){ledger.push(['wind-button',...args])}};
    function updateHud(){ledger.push('hud')}; function syncMatchActions(){ledger.push('match-actions')};
    function syncPointerLockGate(){ledger.push('pointer-gate')}; function resetChatOverlay(){ledger.push('chat-reset')};
    function closeChatInput(){ledger.push('chat-close')}; function renderChatMessage(){};
    function centerCameraOnWorld(point){ledger.push(['camera',point])}; function playCues(cues){ledger.push(['cues',cues])};
    function t(key){return key}; function showInvalidCommand(message){ledger.push(['invalid-command',message])};
  `;
  const end = `return { sync:syncActiveGameAdapterSnapshot, project:syncBeforeCommandProjection, prune:pruneSelection,
    activate(next){const adapter={close(){ledger.push('new-adapter-close')}}; const chat={onMessage(){ledger.push('chat-subscribe');return()=>ledger.push('chat-unsubscribe')}};activateStartedMatch(adapter,next,chat)},
    read(){return{snapshot,selectedIds:[...selectedIds],focusedSelectionId,selectedCampId,controlGroups,commandMode,openPalette,debug:window.__sketchRtsView,ledger:[...ledger],counts:{...counts}}}};`;
  return new Function('deps', 'initial', `${compile(setup + '\n' + impl.text)}\n${end}`)(deps, initial);
}

const game = createGame('bareDuel', { aiPlayers: [] }); game.units = []; game.items = [];
const ownWorker = game.spawnUnit('player', 'worker', 500, 500), enemyWorker = game.spawnUnit('enemy', 'worker', 530, 500);
const ownSoldier = game.spawnUnit('player', 'footman', 600, 500), enemySoldier = game.spawnUnit('enemy', 'footman', 630, 500);
const ownShip = game.spawnUnit('player', 'transport', 900, 700), enemyShip = game.spawnUnit('enemy', 'transport', 1100, 700);
const hiddenOwn = game.spawnUnit('player', 'priest', 900, 700), hiddenEnemy = game.spawnUnit('enemy', 'priest', 1100, 700);
hiddenOwn.deck = { shipId: ownShip.id, x: 0, y: 0 }; hiddenOwn.cabin = { shipId: ownShip.id };
hiddenEnemy.deck = { shipId: enemyShip.id, x: 0, y: 0 }; hiddenEnemy.cabin = { shipId: enemyShip.id };
const veteran = game.spawnUnit('player', 'footman', 700, 600); veteran.level = 3; veteran.veteranSkillChoices = ['cleave', 'charge', 'riposte'];
game.items = [{ id: 'item-proof', kind: 'healingPotion', carrierId: ownWorker.id, owner: 'player', x: ownWorker.x, y: ownWorker.y }];
game.tick = 12;
const stable = snapshotGame(game), stale = structuredClone(stable); stale.units.push({ ...stale.units[0], id: 'stale-id' });
const clone = value => structuredClone(value);
const defaultInitial = () => ({ snapshot: clone(stale), nextSnapshot: clone(stable), selectedIds: new Set([ownWorker.id, 'stale-id']),
  focusedSelectionId: 'stale-id', selectedCampId: undefined, controlGroups: { 1: [ownWorker.id, 'stale-id'], 2: ['stale-id'] }, commandMode: undefined, openPalette: undefined });
const cases = [];
const add = (name, action, prepare = () => {}) => cases.push({ name, action, prepare });
add('sync/no-mode/same-tick-checkpoint', 'sync');
add('sync/build-valid', 'sync', state => { state.commandMode = { type: 'build', placement: { workerId: ownWorker.id } }; });
add('sync/build-missing', 'sync', state => { state.commandMode = { type: 'build', placement: { workerId: 'stale-id' } }; });
add('sync/item-valid', 'sync', state => { state.commandMode = { type: 'item', targeting: { unitId: ownWorker.id, itemId: 'item-proof' } }; });
add('sync/item-missing', 'sync', state => { state.commandMode = { type: 'item', targeting: { unitId: ownWorker.id, itemId: 'missing' } }; });
add('sync/item-wrong-carrier', 'sync', state => { state.commandMode = { type: 'item', targeting: { unitId: ownSoldier.id, itemId: 'item-proof' } }; });
add('sync/item-missing-unit', 'sync', state => { state.commandMode = { type: 'item', targeting: { unitId: 'stale-id', itemId: 'item-proof' } }; });
add('sync/board-live-own-enemy-missing', 'sync', state => { state.commandMode = { type: 'boardShip', sourceIds: [ownShip.id, enemyShip.id, 'missing', ownWorker.id] }; });
add('sync/board-dead', 'sync', state => { state.nextSnapshot.units.find(unit => unit.id === ownShip.id).hp = 0; state.commandMode = { type: 'boardShip', sourceIds: [ownShip.id] }; });
add('sync/cabin-own-and-enemy', 'sync', state => { state.selectedIds = new Set([hiddenOwn.id, hiddenEnemy.id]); state.focusedSelectionId = hiddenEnemy.id; state.controlGroups = { 1: [hiddenOwn.id, hiddenEnemy.id] }; });
for (const palette of ['build', 'stance', 'veteran']) {
  for (const [status, unit] of [['valid', palette === 'build' ? ownWorker : palette === 'stance' ? ownSoldier : veteran], ['invalid', enemySoldier]]) {
    add(`sync/palette-${palette}-${status}`, 'sync', state => { state.selectedIds = new Set([unit.id]); state.focusedSelectionId = unit.id; state.openPalette = palette; });
  }
}
add('sync/palette-veteran-pending', 'sync', state => { state.selectedIds = new Set([veteran.id]); state.focusedSelectionId = veteran.id; state.openPalette = 'veteran'; state.pendingVeteranChoices = [[veteran.id, 12]]; });
add('sync/no-snapshot', 'sync', state => { state.nextSnapshot = undefined; });
add('sync/menu-open', 'sync', state => { state.menuOpen = true; });
add('command/same-tick-checkpoint', 'project', state => { state.commandMode = { type: 'build', placement: { workerId: 'stale-id' } }; });
add('command/no-active-snapshot', 'project', state => { state.nextSnapshot = undefined; });
add('prune/no-mode', 'prune');
add('prune/board-without-projection', 'prune', state => { state.commandMode = { type: 'boardShip', sourceIds: [ownShip.id, enemyShip.id] }; });
add('prune/build-without-projection', 'prune', state => { state.commandMode = { type: 'build', placement: { workerId: 'missing' } }; });
add('prune/item-without-projection', 'prune', state => { state.commandMode = { type: 'item', targeting: { unitId: ownWorker.id, itemId: 'missing' } }; });
add('activate/without-projection-no-mode', 'activate');
add('activate/without-projection-build', 'activate', state => { state.commandMode = { type: 'build', placement: { workerId: 'missing' } }; });
const rows = [];
for (const entry of cases) {
  const outputs = {};
  for (const arm of ['before', 'after']) {
    const state = defaultInitial(); entry.prepare(state);
    const instance = runtime(arm, state), result = entry.action === 'activate' ? instance.activate(clone(stable)) : instance[entry.action]();
    outputs[arm] = { result, ...instance.read() };
  }
  const withoutCounts = output => { const { counts, ...rest } = output; return rest; };
  assert.deepStrictEqual(withoutCounts(outputs.after), withoutCounts(outputs.before), entry.name);
  const expectedAfter = ['sync', 'project'].includes(entry.action)
    ? (entry.name.endsWith('no-snapshot') || entry.name.endsWith('no-active-snapshot') || entry.name.endsWith('menu-open') ? 0 : 1)
    : (entry.name.includes('build') || entry.name.includes('item') ? 1 : 0);
  assert.equal(outputs.after.counts.liveIdsBuilt, expectedAfter, entry.name);
  rows.push({ name: entry.name, action: entry.action, exactStateAndSideEffectsEqual: true,
    beforeCounts: outputs.before.counts, afterCounts: outputs.after.counts, outputSha256: hash(JSON.stringify(withoutCounts(outputs.after))),
    resultingPresentation: { selectedIds: outputs.after.selectedIds, focusedSelectionId: outputs.after.focusedSelectionId,
      selectedCampId: outputs.after.selectedCampId, controlGroups: outputs.after.controlGroups, commandMode: outputs.after.commandMode,
      openPalette: outputs.after.openPalette, debug: outputs.after.debug, ledger: outputs.after.ledger } });
}

// Debug output is compared in full, including absent optional properties.
const debugRows = [];
const countedArray = (array, counters) => new Proxy(array, {
  get(target, property, receiver) {
    if (property === Symbol.iterator) return function* () {
      counters.iteratorPasses++;
      for (const value of target) { counters.elementVisits++; yield value; }
    };
    if (property === 'map' || property === 'filter') return (callback, thisArg) => {
      counters.methodPasses++; counters.methodResultArrays++;
      const result = Array.prototype[property].call(target, (value, index) => {
        counters.elementVisits++; return callback.call(thisArg, value, index, receiver);
      });
      return countedArray(result, counters);
    };
    return Reflect.get(target, property, receiver);
  },
});
for (const [name, input] of [
  ['mixed', { snapshot: stable, localPlayerId: 'player', roomId: 'proof', focusedSelectionId: ownWorker.id, selectedIds: new Set(['stale-id', ownWorker.id]) }],
  ['own-only', { snapshot: { ...stable, units: stable.units.filter(unit => unit.owner === 'player') }, localPlayerId: 'player', selectedIds: new Set() }],
  ['empty', { snapshot: { ...stable, units: [], buildings: [] }, localPlayerId: 'player', selectedIds: new Set(['stale']) }],
  ['undefined', { snapshot: undefined, localPlayerId: 'player', selectedIds: new Set(['stale']) }],
  ['interleaved-orders', { snapshot: { ...stable,
    units: [...stable.units].reverse().map((unit, index) => ({ ...unit, owner: index % 3 === 0 ? 'neutral' : unit.owner, order: { type: index % 2 ? 'idle' : 'hold' } })),
    buildings: [...stable.buildings].reverse() }, localPlayerId: 'player', selectedIds: new Set() }],
]) {
  const before = implementations.before.createSketchRtsDebugView(input), after = implementations.after.createSketchRtsDebugView(input);
  assert.deepStrictEqual(after, before, `debug/${name}`); assert.equal(JSON.stringify(after), JSON.stringify(before));
  const counts = {};
  for (const arm of ['before', 'after']) {
    const unit = { methodPasses: 0, iteratorPasses: 0, elementVisits: 0, methodResultArrays: 0 };
    const building = { methodPasses: 0, iteratorPasses: 0, elementVisits: 0, methodResultArrays: 0 };
    const countedInput = input.snapshot ? { ...input, snapshot: { ...input.snapshot,
      units: countedArray(input.snapshot.units, unit), buildings: countedArray(input.snapshot.buildings, building) } } : input;
    const countedOutput = implementations[arm].createSketchRtsDebugView(countedInput);
    counts[arm] = structuredClone({ units: unit, buildings: building });
    assert.equal(JSON.stringify(countedOutput), JSON.stringify(after));
  }
  debugRows.push({ name, exactObjectAndSerializedOutputEqual: true, keys: Object.keys(after), output: after,
    collectionCounts: counts,
    countScope: 'Proxy counts map/filter and iterator visits on input arrays and returned map/filter arrays, recorded immediately after the actual debug function. JSON output validation is outside the recorded counters. Counts are not allocator bytes, capacity growth, CPU timing, or all runtime allocations.' });
}
const sourceAfter = Object.fromEntries(await Promise.all([...changed, ...shared].map(async file => [file, hash(await readFile(resolve(root, file)))])));
for (const file of [...changed, ...shared]) assert.equal(sourceAfter[file], hash(current[file]), `Source changed while proving ${file}`);
const proof = { passed: true, baseline, currentHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  scope: 'Extracted exact production main function bodies, actual production selection/debug/rule helpers and real snapshotGame fixtures; UI/audio sinks are recorded stand-ins. Node subset correctness and construction counts, not full DOM/page, visual/GPU, heap-byte, render-time or FPS proof.',
  rows, debugRows, sourceSHA256: sourceAfter, sourcesStableAtEnd: true, driverSHA256: hash(await readFile(fileURLToPath(import.meta.url))),
  summary: { mainCases: rows.length, mainCasesPassed: rows.length, debugCases: debugRows.length, debugCasesPassed: debugRows.length,
    liveIdsBefore: rows.reduce((sum, row) => sum + row.beforeCounts.liveIdsBuilt, 0), liveIdsAfter: rows.reduce((sum, row) => sum + row.afterCounts.liveIdsBuilt, 0) } };
await writeFile(resolve(out, 'source-manifest.json'), JSON.stringify({ baseline, artifacts,
  extractedFunctions: Object.fromEntries(Object.entries(implementations).map(([arm, impl]) => [arm, impl.functions.map(entry => ({ name: entry.name, sha256: hash(entry.source) }))])) }, null, 2) + '\n');
await writeFile(resolve(out, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
await writeFile(resolve(out, 'executed-driver.mjs'), await readFile(fileURLToPath(import.meta.url)));
console.log(JSON.stringify(proof.summary));
