import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { setBuildingBodies } from '../../shared/terrain';
import { snapshotGame } from '../../shared/sim';
import type { GameSnapshot } from '../../shared/types';
import { createAiPolicyMemory, type AiPolicyMemory } from '../memory';
import { activeUnitClaim, recordAiMemoryForCommands, recordUnitTaskClaim } from '../policy/claims';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { strengthOf } from '../policy/v6/strength';
import { expansionGarrison, expansionGarrisonReady, garrisonRecoveryCommands, maintainExpansionGarrisons } from './expansion-garrison';
import { readV6Intel } from '../policy/v6/intel';
import { prepareExpansionMission, expansionMissionUnitIds } from './expansion-mission';
import { frontRecovery } from './front-recovery';
import { mainArmyIntel } from './mine-defense';
import { bootstrapExpansionMine } from './expansion-target';
import { rankBootstrapGoals } from './economy';
import { bootstrapPolicyContext } from './policy';

function post() {
  const game = sketchScene('expansion-garrison').map('openClaims').replaceDefaults()
    .player('us', { team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', 500, 500).goldMine('main', 600, 600, 6000)
    .townHall('us', 1600, 1100, { id: 'natural-hall' }).goldMine('natural', 1500, 1100, 6000)
    .goldMine('third', 2400, 1700, 6000).townHall('foe', 3500, 3500)
    .unit('us', 'footman', 1500, 1000, { id: 'hurt-a', hp: 28 })
    .unit('us', 'footman', 1550, 1000, { id: 'hurt-b', hp: 41 })
    .unit('us', 'archer', 1500, 1050, { id: 'healthy-a' })
    .unit('us', 'archer', 1550, 1050, { id: 'healthy-b' })
    .unit('foe', 'footman', 2000, 1100, { id: 'near-raider' })
    .worker('us', 1300, 1200, { id: 'builder' }).build().createGame();
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  setBuildingBodies(game.map, game.buildings);
  const snapshot = snapshotGame(game), memory = createAiPolicyMemory(), options = { memory };
  memory.landExpansion = { mineId: 'natural', sinceTick: 0, stage: 'complete', interruptions: [] };
  expansionGarrisonReady(snapshot, 'us', options, 'natural');
  return { snapshot, memory, options };
}

it('takes recovering soldiers first and adds only the strength missing from the screen', () => {
  const { snapshot, memory, options } = post();
  const entries = runAiCommandEntriesFromScripts(snapshot, 'us', [expansionGarrison], options);
  const guards = snapshot.units.filter(unit => memory.unitClaims[unit.id]?.kind === 'expansionGarrison');
  expect(guards.map(unit => unit.id)).toEqual(['hurt-a', 'hurt-b', 'healthy-b']);
  expect(strengthOf(guards)).toBeGreaterThanOrEqual(1);
  expect(memory.unitClaims['healthy-a']).toBeUndefined();
  expect(entries.some(entry => entry.command.type === 'move' && entry.command.avoidCombat
    && entry.command.unitIds.includes('hurt-a'))).toBe(true);
  expect(expansionGarrisonReady(snapshot, 'us', options, 'natural')).toBe(true);
});

it('uses one strong recovering veteran instead of a fixed number of soldiers', () => {
  const { snapshot, memory, options } = post();
  snapshot.units = snapshot.units.filter(unit => unit.id !== 'hurt-a');
  const veteran = snapshot.units.find(unit => unit.id === 'hurt-b')!;
  veteran.hp = veteran.maxHp * .8; veteran.level = 3;
  runAiCommandEntriesFromScripts(snapshot, 'us', [expansionGarrison], options);
  expect(Object.entries(memory.unitClaims).filter(([, claim]) => claim.kind === 'expansionGarrison').map(([id]) => id))
    .toEqual([veteran.id]);
});

it('does not claim a rejected guard order, then preserves an accepted guard through local micro', () => {
  const { snapshot, memory, options } = post();
  expansionGarrison.claimsUnits!(snapshot, 'us', options);
  const raw = expansionGarrison.run(snapshot, 'us', options);
  const commands = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  expansionGarrison.onCommands!(snapshot, 'us', options, []);
  expect(Object.keys(memory.unitClaims)).toEqual([]);
  expect(commands.length).toBeGreaterThan(0);
  expansionGarrison.onCommands!(snapshot, 'us', options, commands);
  const unit = snapshot.units.find(unit => unit.id === 'hurt-a')!;
  recordAiMemoryForCommands(snapshot, 'battlefield', [{ type: 'attackMove', unitIds: [unit.id], x: 1500, y: 1100 }],
    memory, { owner: 'us', redirects: 'local' });
  expect(activeUnitClaim(snapshot, 'us', unit, options)?.kind).toBe('expansionGarrison');
  expect(expansionMissionUnitIds(memory)).not.toContain(unit.id);
});

it('keeps the post until an actual completed weapon covers both hall and mine', () => {
  const { snapshot, memory, options } = post();
  runAiCommandEntriesFromScripts(snapshot, 'us', [expansionGarrison], options);
  const hall = snapshot.buildings.find(building => building.id === 'natural-hall')!;
  const tower = { ...hall, id: 'cover', kind: 'defenseTower' as const, x: 1450, complete: false, attackDamage: 16, attackRange: 480 };
  snapshot.buildings.push(tower);
  maintainExpansionGarrisons(snapshot, 'us', options);
  expect(memory.expansionGarrisons?.[hall.id]).toBeDefined();
  expect(memory.unitClaims['hurt-a']?.kind).toBe('expansionGarrison');
  tower.complete = true;
  maintainExpansionGarrisons(snapshot, 'us', options);
  expect(memory.expansionGarrisons?.[hall.id]).toBeUndefined();
  expect(memory.unitClaims['hurt-a']).toBeUndefined();
});

it('cleans dead guards and a lost hall without changing another defense task', () => {
  const { snapshot, memory, options } = post();
  recordUnitTaskClaim(snapshot, memory, 'healthy-a', { kind: 'mineRally', targetId: snapshot.buildings[0]!.id, x: 500, y: 500 });
  runAiCommandEntriesFromScripts(snapshot, 'us', [expansionGarrison], options);
  expect(memory.unitClaims['healthy-a']?.kind).toBe('mineRally');
  expect(memory.unitClaims['healthy-b']?.kind).toBe('expansionGarrison');
  snapshot.units = snapshot.units.filter(unit => unit.id !== 'hurt-a');
  maintainExpansionGarrisons(snapshot, 'us', options);
  expect(memory.unitClaims['hurt-a']).toBeUndefined();
  snapshot.buildings = snapshot.buildings.filter(building => building.id !== 'natural-hall');
  maintainExpansionGarrisons(snapshot, 'us', options);
  expect(memory.unitClaims['healthy-b']).toBeUndefined();
  expect(memory.unitClaims['healthy-a']?.kind).toBe('mineRally');
});

it('combines the real wounded footmen with tower cover instead of keeping healthy archers', () => {
  const saved = JSON.parse(readFileSync(new URL('./fixtures/expansion-natural-4m15.json', import.meta.url), 'utf8')) as {
    snapshot: GameSnapshot; memories: Record<string, AiPolicyMemory>;
  };
  const snapshot = structuredClone(saved.snapshot), memory = structuredClone(saved.memories.v9_archer!);
  const options = { memory, ...(snapshot.teams ? { teams: snapshot.teams } : {}) };
  // The snapshot is one tick before completion; script that single event without changing its soldiers.
  snapshot.buildings.find(building => building.id === 'building-v9_archer-townHall-1553')!.complete = true;
  const hall = snapshot.buildings.find(building => building.id === 'building-v9_archer-townHall-1553')!;
  snapshot.buildings.push({ ...hall, id: 'cover', kind: 'defenseTower', x: 3424, y: 1760, hp: 200, maxHp: 200,
    complete: true, attackDamage: 16, attackRange: 480 });
  expansionGarrisonReady(snapshot, 'v9_archer', options, 'gold-gen-1');
  runAiCommandEntriesFromScripts(snapshot, 'v9_archer', [expansionGarrison], options);
  const guards = Object.entries(memory.unitClaims).filter(([, claim]) => claim.kind === 'expansionGarrison').map(([id]) => id);
  expect(guards).toContain('unit-v9_archer-footman-1047');
  expect(guards).toContain('unit-v9_archer-footman-1126');
  expect(guards).not.toContain('unit-v9_archer-archer-1163');
  expect(guards).not.toContain('unit-v9_archer-archer-1303');
});

it('fills the strength lost when a guard dies and waits for replacement arrival', () => {
  const { snapshot, memory, options } = post();
  runAiCommandEntriesFromScripts(snapshot, 'us', [expansionGarrison], options);
  const next = structuredClone(snapshot); next.tick += 15;
  next.units = next.units.filter(unit => unit.id !== 'healthy-b');
  const replacement = next.units.find(unit => unit.id === 'healthy-a')!;
  replacement.x = 500; replacement.y = 500;
  maintainExpansionGarrisons(next, 'us', options);
  runAiCommandEntriesFromScripts(next, 'us', [expansionGarrison], options);
  expect(memory.unitClaims[replacement.id]?.kind).toBe('expansionGarrison');
  expect(expansionGarrisonReady(next, 'us', options, 'natural')).toBe(false);
  replacement.x = 1500; replacement.y = 1100;
  expect(expansionGarrisonReady(next, 'us', options, 'natural')).toBe(true);
});

it('recruits the next expansion only from soldiers left outside the garrison', () => {
  const { snapshot, memory, options } = post();
  runAiCommandEntriesFromScripts(snapshot, 'us', [expansionGarrison], options);
  const guards = Object.entries(memory.unitClaims).filter(([, claim]) => claim.kind === 'expansionGarrison').map(([id]) => id);
  memory.landExpansion = { mineId: 'third', stage: 'assemble', sinceTick: snapshot.tick, interruptions: [] };
  const next = structuredClone(snapshot); next.tick += 15;
  next.units = next.units.filter(unit => unit.owner !== 'foe');
  prepareExpansionMission(next, 'us', options, readV6Intel(next, 'us', options));
  for (const id of guards) {
    expect(memory.unitClaims[id]?.kind).toBe('expansionGarrison');
    expect(expansionMissionUnitIds(memory)).not.toContain(id);
  }
  expect(expansionMissionUnitIds(memory)).toContain('healthy-a');
});

it('adds healthy reinforcements only when the recovering screen cannot cover known raiders', () => {
  const { snapshot, memory, options } = post();
  const raider = { ...snapshot.units.find(unit => unit.id === 'hurt-b')!, id: 'raider', owner: 'foe', x: 1750, y: 1100 };
  raider.hp = raider.maxHp;
  const raiders = [raider, { ...raider, id: 'raider-b', x: 1790 }];
  const next = structuredClone(snapshot); next.tick += 15;
  next.units.push(...raiders);
  runAiCommandEntriesFromScripts(next, 'us', [expansionGarrison], options);
  const guards = next.units.filter(unit => memory.unitClaims[unit.id]?.kind === 'expansionGarrison');
  expect(guards).toHaveLength(4);
  expect(strengthOf(guards)).toBeGreaterThanOrEqual(strengthOf(raiders));
});

it('preserves a serialized garrison claim owned by another issuer', () => {
  const { snapshot, memory, options } = post();
  delete memory.expansionGarrisons;
  recordUnitTaskClaim(snapshot, memory, 'healthy-a', { kind: 'expansionGarrison', targetId: 'home', x: 500, y: 500 });
  const before = structuredClone(memory.unitClaims['healthy-a']);
  maintainExpansionGarrisons(snapshot, 'us', options);
  expect(memory.unitClaims['healthy-a']).toEqual(before);
});

function coverRequested(snapshot: GameSnapshot, memory: AiPolicyMemory) {
  const context = bootstrapPolicyContext(snapshot, 'us', 'v9_archer', { memory });
  return rankBootstrapGoals(snapshot, 'us', context).some(goal => goal.id.startsWith('expansion-garrison:'));
}

it('buys cover for the closest reachable raid even before enemies stand near the mine', () => {
  const { snapshot, memory } = post();
  const next = structuredClone(snapshot);
  next.units.find(unit => unit.id === 'near-raider')!.x = 2500;
  expect(coverRequested(next, memory)).toBe(true);
});

it('does not buy a tower when recovering soldiers already cover the forecast raid', () => {
  const { snapshot, memory } = post();
  const next = structuredClone(snapshot), veteran = next.units.find(unit => unit.id === 'hurt-b')!;
  veteran.level = 3; veteran.hp = veteran.maxHp * .55;
  expect(coverRequested(next, memory)).toBe(false);
});

it('keeps a recovering soldier but does not tax a mine when the enemy army is far away', () => {
  const { snapshot, memory, options } = post();
  const next = structuredClone(snapshot), raider = next.units.find(unit => unit.id === 'near-raider')!;
  raider.x = 3900; raider.y = 3900;
  expect(coverRequested(next, memory)).toBe(false);
  runAiCommandEntriesFromScripts(next, 'us', [expansionGarrison], options);
  expect(Object.entries(memory.unitClaims).filter(([, claim]) => claim.kind === 'expansionGarrison').map(([id]) => id))
    .toEqual(['hurt-a']);
});

it('releases temporary healthy escorts once tower and wounded guards cover the raid together', () => {
  const { snapshot, memory, options } = post();
  const next = structuredClone(snapshot);
  const raider = next.units.find(unit => unit.id === 'near-raider')!;
  next.units.push({ ...raider, id: 'second-raider', x: 2020 });
  for (const unit of next.units.filter(unit => unit.id.startsWith('hurt-'))) unit.level = 2;
  runAiCommandEntriesFromScripts(next, 'us', [expansionGarrison], options);
  expect(memory.unitClaims['healthy-a']?.kind).toBe('expansionGarrison');
  expect(memory.unitClaims['healthy-b']?.kind).toBe('expansionGarrison');
  const covered = structuredClone(next), hall = covered.buildings.find(building => building.id === 'natural-hall')!;
  covered.buildings.push({ ...hall, id: 'cover', kind: 'defenseTower', x: 1450, complete: true,
    hp: 200, maxHp: 200, attackDamage: 16, attackRange: 480 });
  maintainExpansionGarrisons(covered, 'us', options);
  expect(memory.unitClaims['hurt-a']?.kind).toBe('expansionGarrison');
  expect(memory.unitClaims['hurt-b']?.kind).toBe('expansionGarrison');
  expect(memory.unitClaims['healthy-a']).toBeUndefined();
  expect(memory.unitClaims['healthy-b']).toBeUndefined();
});

it.each(['move', 'attackMove'] as const)('keeps safe wounded %s recovery at the mining post instead of repeatedly walking home', type => {
  const { snapshot, memory, options } = post();
  runAiCommandEntriesFromScripts(snapshot, 'us', [expansionGarrison], options);
  const commands = garrisonRecoveryCommands(snapshot, 'us', options,
    [{ type, unitIds: ['hurt-a'], x: 500, y: 500 }]);
  expect(commands).toEqual([{ type: 'holdPosition', unitIds: ['hurt-a'] }]);
  const next = structuredClone(snapshot), hall = next.buildings[0]!;
  next.buildings.push({ ...hall, id: 'distant-well', kind: 'moonWell', attackDamage: 0, attackRange: 400 });
  expect(frontRecovery.claimsUnits!(next, 'us', options).has('hurt-a')).toBe(false);
  expect(memory.unitClaims['hurt-a']?.kind).toBe('expansionGarrison');
});

it('still permits a wounded guard to escape when its post itself is under immediate attack', () => {
  const { snapshot, options } = post();
  runAiCommandEntriesFromScripts(snapshot, 'us', [expansionGarrison], options);
  const next = structuredClone(snapshot), raider = next.units.find(unit => unit.id === 'near-raider')!;
  raider.x = 1510; raider.y = 1000;
  const command = { type: 'move' as const, unitIds: ['hurt-a'], x: 500, y: 500 };
  expect(garrisonRecoveryCommands(next, 'us', options, [command])).toEqual([command]);
});

it('chooses the smaller reinforcement bill after leaving the real natural garrison', () => {
  const saved = JSON.parse(readFileSync(new URL('./fixtures/expansion-natural-4m15.json', import.meta.url), 'utf8')) as {
    snapshot: GameSnapshot; memories: Record<string, AiPolicyMemory>;
  };
  const snapshot = structuredClone(saved.snapshot), memory = structuredClone(saved.memories.v9_archer!);
  const hall = snapshot.buildings.find(building => building.id === 'building-v9_archer-townHall-1553')!;
  hall.complete = true;
  snapshot.buildings.push({ ...hall, id: 'cover', kind: 'defenseTower', x: 3424, y: 1760, hp: 200, maxHp: 200,
    complete: true, attackDamage: 16, attackRange: 480 });
  memory.expansionGarrisons = { [hall.id]: { mineId: 'gold-gen-1', sinceTick: snapshot.tick } };
  for (const id of ['unit-v9_archer-footman-1047', 'unit-v9_archer-footman-1126', 'unit-v9_archer-archer-1059']) {
    recordUnitTaskClaim(snapshot, memory, id, { kind: 'expansionGarrison', targetId: hall.id, x: 3615.5, y: 1928 });
  }
  const options = bootstrapPolicyContext(snapshot, 'v9_archer', 'v9_archer', { memory });
  const mine = bootstrapExpansionMine(snapshot, 'v9_archer', mainArmyIntel(snapshot, 'v9_archer', options), options);
  expect(mine?.id).toBe('gold-gen-4');
});
