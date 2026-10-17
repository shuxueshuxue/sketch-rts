import { readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame, snapshotGame } from '../../shared/sim';
import { issueCommandFrame } from '../../sdk/commands/frame';
import type { Projectile } from '../../shared/types';
import { workingWeaponGeometry } from '../../shared/combat-fire-geometry';
import { planAiOwnerCommandEntries } from '../planner-context';
import * as boarding from './worker-boarding';

function saved() {
  const fixture = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/archer-ferry-loading-11565.json.gz', import.meta.url))).toString());
  const game = createGame('bareDuel');
  restoreSnapshotIntoGame(game, fixture.before.snapshot, fixture.before.nextId);
  const snapshot = snapshotGame(game), memory = structuredClone(fixture.before.memories.p0);
  const boat = snapshot.units.find(unit => unit.id === 'unit-p0-transport-1930')!;
  const foe = snapshot.units.find(unit => unit.id === 'unit-p2-warship-1129')!;
  const worker = snapshot.units.find(unit => unit.id === 'unit-p0-worker-1045')!;
  return { fixture, game, snapshot, memory, boat, foe, worker, options: { memory, teams: game.teams } };
}

it('SEMANTIC_FERRY_LOADING_11565_ESCAPE_MUST_REMAIN_MOVING: keeps the real ferry move for a newly recruited worker', () => {
  const { fixture, game, snapshot, memory, boat, worker } = saved();
  expect(boat.order).toMatchObject({ type: 'move', avoidCombat: true });
  expect(boat.hp).toBe(31);
  expect(worker.deck).toBeUndefined();
  expect(fixture.after.entries).toContainEqual(expect.objectContaining({ scriptId: 'naval', command: {
    type: 'board', unitIds: [worker.id], transportId: boat.id,
  } }));
  expect(fixture.after.entries).toContainEqual(expect.objectContaining({ scriptId: 'naval', command: {
    type: 'stop', unitIds: [boat.id],
  } }));
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version: 'v9_archer', source: 'external-agent', memory }, { teams: game.teams });
  if (process.env.BOOTSTRAP_FERRY_CONTROL_RECEIPT) writeFileSync(process.env.BOOTSTRAP_FERRY_CONTROL_RECEIPT, JSON.stringify({
    apiReached: true, tick: snapshot.tick, fullOwnerEntriesExact: isDeepStrictEqual(entries, fixture.after.entries),
    p0PostmemoryExact: isDeepStrictEqual(memory, fixture.after.memories.p0),
    nativeSnapshotUnchanged: isDeepStrictEqual(snapshot, snapshotGame(game)),
    workerOriginallyMining: worker.order.type === 'mine', workerOriginallyAboard: !!worker.deck,
    workerPreviouslyAssigned: fixture.before.memories.p0.naval.ferries[boat.id].crewIds.includes(worker.id),
    oldBoatOrder: boat.order, boatHp: boat.hp,
  }, null, 2) + '\n', { flag: 'wx' });
  expect(entries.some(entry => entry.command.type === 'board' && entry.command.unitIds.includes(worker.id))).toBe(false);
  expect(entries.some(entry => entry.command.type === 'stop' && entry.command.unitIds.includes(boat.id))).toBe(false);
  const unrelated = (entry: { command: unknown }) => {
    const command = entry.command as { unitIds?: string[]; unitId?: string };
    return !command.unitIds?.some(id => id === boat.id || id === worker.id) && command.unitId !== boat.id && command.unitId !== worker.id;
  };
  expect(entries.filter(unrelated)).toEqual(fixture.after.entries.filter(unrelated));
  const originalOrder = structuredClone(boat.order);
  issueCommandFrame(game, entries.map(entry => ({ ...entry, plannerOrigin: 'local-command-planner' as const })));
  expect(game.units.find(unit => unit.id === boat.id)!.order).toEqual(originalOrder);
});

it('uses actual enemy gun geometry for the real threatening hull', () => {
  const { snapshot, options, boat, foe } = saved();
  expect(workingWeaponGeometry(snapshot, foe, boat).some(weapon => weapon.kind === 'shipCannon' && weapon.covers)).toBe(true);
  expect(boarding.canPauseFerryForWorker(snapshot, 'p0', options, boat)).toBe(false);
});

it.each(['ordinary move', 'idle'] as const)('keeps %s outside the existing escape boundary', kind => {
  const { snapshot, options, boat } = saved();
  boat.order = kind === 'idle' ? { type: 'idle' } : { type: 'move', x: 4368, y: 6032 };
  expect(boarding.canPauseFerryForWorker(snapshot, 'p0', options, boat)).toBe(true);
});

it.each(['far', 'broken gun', 'facing away', 'different target', 'ally'] as const)('does not treat a %s as effective fire against the escape', kind => {
  const { snapshot, options, boat, foe } = saved();
  snapshot.projectiles = [];
  if (kind === 'far') { foe.x += 2000; foe.y += 2000; }
  if (kind === 'broken gun') {
    for (const item of snapshot.items) if (JSON.stringify(item).includes(foe.id)) item.durability = 0;
    foe.attackDamage = 0;
  }
  if (kind === 'facing away') foe.sailing!.heading += Math.PI;
  if (kind === 'different target') {
    foe.order = { type: 'attack', targetId: 'unrelated' };
    delete foe.sailing!.pursuit;
  }
  if (kind === 'ally') foe.owner = 'p0';
  if (kind !== 'different target' && kind !== 'ally')
    expect(workingWeaponGeometry(snapshot, foe, boat).some(weapon => weapon.covers)).toBe(false);
  expect(boarding.canPauseFerryForWorker(snapshot, 'p0', options, boat)).toBe(true);
});

it('keeps original recruitment without an explicit hull attack, pursuit or in-flight shot', () => {
  const { fixture, game, snapshot, memory, boat, foe, worker } = saved();
  snapshot.projectiles = [];
  foe.order = { type: 'idle' }; delete foe.sailing!.pursuit;
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version: 'v9_archer', source: 'external-agent', memory }, { teams: game.teams });
  expect(entries).toContainEqual(expect.objectContaining({ command: { type: 'board', unitIds: [worker.id], transportId: boat.id } }));
  expect(entries).toContainEqual(expect.objectContaining({ command: { type: 'stop', unitIds: [boat.id] } }));
  expect(fixture.provenance.contextWasAtomicCheckpoint).toBe(false);
});

it.each([{ owner: 'p2', damage: 1, allowed: false }, { owner: 'p0', damage: 1, allowed: true },
  { owner: 'p2', damage: 0, allowed: true }] as const)('handles a real in-flight hull target independently of a live shooter: $owner/$damage', ({ owner, damage, allowed }) => {
  const { snapshot, options, boat, foe } = saved();
  snapshot.units = snapshot.units.filter(unit => unit.id !== foe.id);
  snapshot.projectiles = [{ id: 'counterfactual-shot', owner, attackerId: foe.id, targetId: boat.id,
    fromX: foe.x, fromY: foe.y, toX: boat.x, toY: boat.y, damage, remaining: 1, duration: 10 } satisfies Projectile];
  expect(boarding.canPauseFerryForWorker(snapshot, 'p0', options, boat)).toBe(allowed);
});

it('does not mutate orders, queues, memories or existing deck work while assessing a new worker', () => {
  const { snapshot, options, boat, worker } = saved();
  worker.orderQueue = [{ type: 'mine', resourceId: 'gold-seat0-main', phase: 'toMine', timer: 0 }];
  const before = JSON.stringify({ snapshot, options });
  boarding.canPauseFerryForWorker(snapshot, 'p0', options, boat);
  expect(JSON.stringify({ snapshot, options })).toBe(before);
});
