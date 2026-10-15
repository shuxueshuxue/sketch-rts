import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { boardUnit } from '../../shared/decks';
import { combatCapability } from '../../shared/combat-capabilities';
import { snapshotGame } from '../../shared/sim';
import { setBuildingBodies } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { assaultExpedition } from '../policy/naval';
import { combatRating, effectiveCombatRating, marchStrength, strengthOf, unitStrength } from '../policy/v6/strength';
import { BOOTSTRAP_VERSIONS, bootstrapPolicyContext } from './policy';

/** Observed original3bdb full before-p0-planner12390 input, captured by an
 * endpoint-verified native12000→13200 replay. It is after the12285 unloading,
 * before any original first-wave loss; no world, nextId or memory was edited. */
it.each(BOOTSTRAP_VERSIONS)('%s counts the real five worker defenders without inventing another invasion soldier', version => {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/assault-worker-defense-before-think-12390.json.gz', import.meta.url))).toString());
  const snapshot = saved.snapshot, before = JSON.stringify(saved);
  const target = snapshot.buildings.find((building: { id: string }) => building.id === 'building-p1-townhall');
  const options = bootstrapPolicyContext(snapshot, 'p0', version, { memory: structuredClone(saved.memories.p0), teams: snapshot.teams });
  const result = assaultExpedition(snapshot, 'p0', options, target);
  const ravagers = snapshot.units.filter((unit: { owner: string; kind: string }) => unit.owner === 'p0' && unit.kind === 'emberRavager');
  expect(ravagers).toHaveLength(3);
  expect(ravagers.reduce((sum: number, unit: Parameters<typeof effectiveCombatRating>[1]) => sum + effectiveCombatRating(snapshot, unit), 0))
    .toBeCloseTo(2.8384065466627453, 12);
  expect(result.required).toBeCloseTo(3.0929646005546156, 12);
  expect(result.ready).toBe(false);
  expect(result.crew).toEqual([]);
  expect(JSON.stringify(saved)).toBe(before);
});

function field() {
  const game = sketchScene('counterfactual-expedition-worker-defense').map('bareDuel').replaceDefaults()
    .player('us', { team: 'a' }).player('foe', { team: 'b' }).player('ally', { team: 'a' })
    .townHall('us', 500, 500).townHall('foe', 3500, 500).build().createGame();
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, i) => {
    const x = i % 128; return x < 32 || x > 70 && x < 92 || x > 102 ? '.' : '~';
  }).join('') };
  setBuildingBodies(game.map, game.buildings);
  for (let i = 0; i < 8; i++) game.spawnUnit('us', 'footman', 500 + i * 24, 800);
  return game;
}

it('preserves ordinary nonworker force and all worker army or economy strengths', () => {
  const game = field(), foe = game.spawnUnit('foe', 'footman', 3500, 800), worker = game.spawnUnit('us', 'worker', 500, 1100);
  const snapshot = snapshotGame(game), target = game.buildings.find(building => building.owner === 'foe')!;
  const result = assaultExpedition(snapshot, 'us', { version: 'v9', memory: createAiPolicyMemory(), teams: game.teams }, target);
  expect(result.required).toBe(effectiveCombatRating(snapshot, foe) * 1.4);
  expect(result.ready).toBe(true);
  expect(result.crew.every(unit => unit.kind === 'footman')).toBe(true);
  expect([combatRating(worker), unitStrength(worker), effectiveCombatRating(snapshot, worker), strengthOf([worker]), marchStrength([worker])])
    .toEqual([0, 0, 0, 0, 0]);
});

it('counts only armed opponent workers physically on the target landmass', () => {
  const game = field(), target = game.buildings.find(building => building.owner === 'foe')!;
  for (let i = 0; i < 4; i++) game.spawnUnit('foe', 'worker', 3500 + i * 24, 1000);
  const options = { version: 'v9' as const, memory: createAiPolicyMemory(), teams: game.teams };
  const required = () => assaultExpedition(snapshotGame(game), 'us', options, target).required;
  const original = required();
  expect(original).toBeCloseTo(2.474371680443692, 12);
  for (let i = 0; i < 8; i++) {
    game.spawnUnit('foe', 'worker', 2500 + i * 12, 1400);
    game.spawnUnit('ally', 'worker', 3500 + i * 12, 1400);
    const unarmed = game.spawnUnit('foe', 'worker', 3500 + i * 12, 1500); unarmed.attackDamage = 0;
    expect(combatCapability(game, unarmed).armed).toBe(false);
  }
  expect(required()).toBe(original);
  const ship = game.spawnUnit('foe', 'transport', 3200, 1800);
  for (let i = 0; i < 4; i++) {
    const lancer = game.spawnUnit('foe', 'lancer', ship.x, ship.y);
    expect(boardUnit(ship, lancer, game.units)).toBe(true);
  }
  expect(required()).toBe(original);
});

it('uses the existing physical health ratio while leaving worker tactics out of the estimate', () => {
  const game = field(), target = game.buildings.find(building => building.owner === 'foe')!;
  const workers = Array.from({ length: 8 }, (_, i) => game.spawnUnit('foe', 'worker', 3500 + i * 18, 1000));
  const required = () => assaultExpedition(snapshotGame(game), 'us', { version: 'v9', memory: createAiPolicyMemory(), teams: game.teams }, target).required;
  const full = required();
  for (const worker of workers) { worker.hp = worker.maxHp / 2; worker.order = { type: 'mine', resourceId: 'nonexistent-test-resource', phase: 'toMine', timer: 0 }; }
  expect(required()).toBe(full / 2);
  expect(strengthOf(workers)).toBe(0);
});
