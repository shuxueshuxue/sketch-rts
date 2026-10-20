import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createGame, issueCommand, snapshotGame, stepGame, tryPlayerCommand } from '../../shared/sim';
import { createBuilding } from '../../shared/map';
import { BUILDING_DEFS } from '../../shared/catalog';
import type { GameCommand } from '../../shared/types';
import { createAiPolicyMemory } from '../memory';
import { recordAiMemoryForCommands, pruneAiPolicyMemory } from '../policy/claims';
import { prepareLifeSavingInterruptions, recordNavigationOverrides } from '../policy/life-saving-interruption';
import { issuedUnitRoad, retainedUnitAction } from '../policy/unit-action';
import { workerExposure } from '../situation/worker-exposure';
import { armedFoes } from './safe-land-route';
import { campNavigationContinuations, routeCampNavigation } from './camp-navigation';
import { campPrerequisite } from './camp-prerequisite';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { deathTaskIndex } from '../death-ledger-context';

function interruptedConstruction() {
  const game = createGame('bareDuel', { aiPlayers: [] }); game.units = []; game.buildings = []; delete game.map.terrain;
  const worker = game.spawnUnit('player', 'worker', 740, 1000);
  const camp = game.spawnUnit('neutral', 'ogreMage', 1000, 1000);
  const enemy = game.spawnUnit('enemy', 'archer', 1500, 1000);
  const parent: Extract<GameCommand, { type: 'build' }> = { type: 'build', unitId: worker.id, buildingKind: 'farm', x: 1500, y: 1000 };
  const escape: GameCommand = { type: 'move', unitIds: [worker.id], x: 400, y: 1000, avoidCombat: true };
  const memory = createAiPolicyMemory();
  issueCommand(game, parent);
  const output = routeCampNavigation(snapshotGame(game), 'player', { memory }, [{ scriptId: 'rescue', command: escape }], new Map());
  return { game, worker, camp, enemy, parent, escape, memory, output };
}

it('retains only an actually executing parent, evacuates immediately, and resumes without a timer after a safe road appears', () => {
  const { game, worker, enemy, parent, escape, memory, output } = interruptedConstruction();
  expect(output).toContainEqual({ scriptId: 'rescue', command: escape });
  expect(memory.unitClaims[worker.id]?.interruption?.phase).toBe('life-saving-interruption');
  expect(memory.navigationEvents).toContainEqual(expect.objectContaining({ kind: 'avoidance-retain', reason: 'actual-parent-interrupted' }));
  expect(memory.unitClaims[worker.id]?.campTravel?.subgoal?.kind).toBe('clear-camp');
  for (const entry of output) issueCommand(game, entry.command);
  expect(retainedUnitAction(worker, memory)).toEqual(worker.order);
  expect(retainedUnitAction(worker, memory).type).toBe('move');
  for (let tick = 0; tick < 200; tick++) stepGame(game);
  game.units = game.units.filter(unit => unit.id !== enemy.id);
  const snapshot = snapshotGame(game), restoredMemory = JSON.parse(JSON.stringify(memory));
  // A serialized midway fork sees precisely the same retained vacancy and emits
  // the same native continuation, including its next persisted memory state.
  const run = (candidate: typeof memory) => {
    prepareLifeSavingInterruptions(snapshot, 'player', candidate);
    return routeCampNavigation(snapshot, 'player', { memory: candidate }, [], campNavigationContinuations(candidate));
  };
  const resumed = run(memory);
  expect(run(restoredMemory)).toEqual(resumed);
  expect(restoredMemory).toEqual(memory);
  expect(resumed.length).toBeGreaterThan(0);
  expect(memory.unitClaims[worker.id]?.interruption?.parent).toEqual(parent);
  expect(memory.navigationEvents).toContainEqual(expect.objectContaining({ kind: 'avoidance-admit' }));
  for (const entry of resumed) issueCommand(game, entry.command);
  prepareLifeSavingInterruptions(snapshotGame(game), 'player', memory);
  expect(memory.navigationEvents).toContainEqual(expect.objectContaining({ kind: 'avoidance-resume', reason: 'native-continuation-observed' }));
  expect(retainedUnitAction(worker, memory)).toEqual(parent);
  expect(workerExposure(snapshotGame(game), worker, issuedUnitRoad(snapshotGame(game), worker),
    { foes: armedFoes(snapshotGame(game), 'player'), allowDeparture: true })).toEqual([]);
});

it('has no lease timeout and ends on a strategic order, an identical outside order, or an occupied parent site', () => {
  const { game, worker, memory, escape } = interruptedConstruction();
  for (const entry of [{ command: escape }]) issueCommand(game, entry.command);
  game.tick = 100_000;
  pruneAiPolicyMemory(snapshotGame(game), 'player', memory);
  expect(memory.unitClaims[worker.id]?.interruption).toBeDefined();
  const before = structuredClone(memory);
  recordAiMemoryForCommands(snapshotGame(game), 'new-strategy', [{ type: 'mine', unitIds: [worker.id], resourceId: 'another-mine' }], memory);
  expect(memory.unitClaims[worker.id]?.interruption).toBeUndefined();
  recordNavigationOverrides(snapshotGame(game), before, [escape]);
  expect(before.unitClaims[worker.id]?.interruption).toBeUndefined();
  expect(before.navigationEvents).toContainEqual(expect.objectContaining({ kind: 'avoidance-end', reason: 'external-order' }));
  const occupied = interruptedConstruction();
  occupied.game.buildings.push(createBuilding('occupied-site', 'player', 'farm', occupied.parent.x, occupied.parent.y, true));
  prepareLifeSavingInterruptions(snapshotGame(occupied.game), 'player', occupied.memory);
  expect(occupied.memory.unitClaims[occupied.worker.id]?.interruption).toBeUndefined();
});

it('keeps the rescue binding when a continuation is admitted but the native construction is temporarily unfunded', () => {
  const { game, worker, parent, memory, output } = interruptedConstruction();
  for (const entry of output) issueCommand(game, entry.command);
  game.units = game.units.filter(unit => unit.owner === 'player');
  game.players.player!.gold = 0;
  const snapshot = snapshotGame(game);
  const admitted = routeCampNavigation(snapshot, 'player', { memory }, [], campNavigationContinuations(memory));
  expect(admitted).toContainEqual({ scriptId: 'campNavigation', command: parent });
  expect(tryPlayerCommand(game, 'player', parent)).toMatchObject({ ok: false, transient: true });
  prepareLifeSavingInterruptions(snapshotGame(game), 'player', memory);
  expect(memory.unitClaims[worker.id]?.interruption?.pendingBinding).toBeDefined();
  expect(memory.navigationEvents?.some(event => event.kind === 'avoidance-resume')).toBe(false);
  expect(retainedUnitAction(worker, memory)).toEqual(worker.order);
  game.players.player!.gold = 1000;
  expect(tryPlayerCommand(game, 'player', parent)).toEqual({ ok: true });
  prepareLifeSavingInterruptions(snapshotGame(game), 'player', memory);
  expect(memory.unitClaims[worker.id]?.interruption?.pendingBinding).toBeUndefined();
  expect(memory.navigationEvents).toContainEqual(expect.objectContaining({ kind: 'avoidance-resume', reason: 'native-continuation-observed' }));
});

it('uses the real 12562 interruption to resume only the native parent over a road accepted by the same worker exposure query', () => {
  const frame = JSON.parse(gunzipSync(readFileSync(new URL('../fixtures/camp-worker-summoner-main-12562.json.gz', import.meta.url))).toString());
  const snapshot = frame.snapshot, worker = snapshot.units.find((unit: { id: string }) => unit.id === 'unit-v9_summoner-worker-1256');
  const memory = structuredClone(frame.memory);
  const output = routeCampNavigation(snapshot, frame.owner, { memory, teams: snapshot.teams }, frame.entries, new Map());
  expect(memory.navigationEvents).toContainEqual(expect.objectContaining({ unitId: worker.id, kind: 'avoidance-admit' }));
  const binding = memory.unitClaims[worker.id].interruption;
  expect(binding.parent).toEqual({ type: 'build', unitId: worker.id, buildingKind: worker.order.buildingKind, x: worker.order.x, y: worker.order.y });
  expect(output.some(entry => entry.scriptId === 'campNavigation' && entry.command.type === 'move')).toBe(true);
});

it('borrows clearing force without copying the worker construction action or its capital reservation to each soldier', () => {
  const game = createGame('bareDuel', { aiPlayers: [] }); game.units = []; game.buildings = []; delete game.map.terrain;
  const worker = game.spawnUnit('player', 'worker', 500, 1000);
  game.spawnUnit('neutral', 'ogreMage', 1000, 1000);
  for (let index = 0; index < 4; index++) game.spawnUnit('player', 'footman', 500, 1050 + index * 40);
  const memory = createAiPolicyMemory(), snapshot = snapshotGame(game);
  routeCampNavigation(snapshot, 'player', { memory }, [{ scriptId: 'builder',
    command: { type: 'build', unitId: worker.id, buildingKind: 'farm', x: 1000, y: 1000 } }], new Map());
  const output = runAiCommandEntriesFromScripts(snapshot, 'player', [campPrerequisite], { memory });
  expect(output.length).toBeGreaterThan(0);
  const borrowed = Object.entries(memory.unitClaims).filter(([id]) => id !== worker.id);
  expect(borrowed.length).toBeGreaterThan(0);
  for (const [id, claim] of borrowed) {
    expect(claim.campTravel?.childOnly).toBe(true);
    expect(claim.campTravel?.command).toEqual({ type: 'holdPosition', unitIds: [id] });
  }
  game.players.player!.gold = 1000;
  let remaining = -1;
  runAiCommandEntriesFromScripts(snapshotGame(game), 'player', [{ id: 'budget-observer', phase: 'economy', run(view) {
    remaining = view.players.player!.gold; return undefined;
  } }], { memory });
  expect(remaining).toBe(1000 - BUILDING_DEFS.farm.cost);
  const dependency = memory.unitClaims[worker.id]!.campTravel!;
  dependency.subgoal = { ...dependency.subgoal!, status: 'active' };
  expect(deathTaskIndex(snapshotGame(game), 'player', memory).byUnit.get(worker.id)?.some(task => task.clearing)).toBe(false);
  game.units = game.units.filter(unit => unit.owner !== 'neutral');
  routeCampNavigation(snapshotGame(game), 'player', { memory }, [], campNavigationContinuations(memory));
  expect(borrowed.every(([id]) => memory.unitClaims[id]?.campTravel === undefined)).toBe(true);
});

it('leaves an understrength prerequisite unassigned instead of claiming individual recruits or the backline', () => {
  const game = createGame('bareDuel', { aiPlayers: [] }); game.units = []; game.buildings = []; delete game.map.terrain;
  const worker = game.spawnUnit('player', 'worker', 500, 1000);
  game.spawnUnit('neutral', 'ogreMage', 1000, 1000);
  const memory = createAiPolicyMemory();
  routeCampNavigation(snapshotGame(game), 'player', { memory }, [{ scriptId: 'builder',
    command: { type: 'build', unitId: worker.id, buildingKind: 'farm', x: 1000, y: 1000 } }], new Map());
  game.tick = 2000;
  const recruit = game.spawnUnit('player', 'footman', 200, 1000);
  const caster = game.spawnUnit('player', 'summoner', 200, 1050);
  const output = runAiCommandEntriesFromScripts(snapshotGame(game), 'player', [campPrerequisite], { memory });
  expect(output).toEqual([]);
  expect(memory.unitClaims[worker.id]?.campTravel?.subgoal?.status).toBe('blocked');
  expect(memory.unitClaims[recruit.id]).toBeUndefined();
  expect(memory.unitClaims[caster.id]).toBeUndefined();
  expect(deathTaskIndex(snapshotGame(game), 'player', memory).byUnit.get(recruit.id) ?? []).not.toContainEqual(expect.objectContaining({ clearing: true }));
});
