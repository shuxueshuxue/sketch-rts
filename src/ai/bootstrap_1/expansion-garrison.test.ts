import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import type { GameSnapshot } from '../../shared/types';
import { createAiPolicyMemory, type AiPolicyMemory } from '../memory';
import { activeUnitClaim, recordAiMemoryForCommands, recordUnitTaskClaim } from '../policy/claims';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { strengthOf } from '../policy/v6/strength';
import { expansionGarrison, expansionGarrisonReady, maintainExpansionGarrisons } from './expansion-garrison';
import { readV6Intel } from '../policy/v6/intel';
import { prepareExpansionMission, expansionMissionUnitIds } from './expansion-mission';

function post() {
  const game = sketchScene('expansion-garrison').map('openClaims').replaceDefaults()
    .player('us', { team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', 500, 500).goldMine('main', 600, 600, 6000)
    .townHall('us', 1600, 1100, { id: 'natural-hall' }).goldMine('natural', 1500, 1100, 6000)
    .goldMine('third', 2400, 1700, 6000).townHall('foe', 3500, 3500)
    .unit('us', 'footman', 1500, 1000, { id: 'hurt-a', hp: 28 })
    .unit('us', 'footman', 1550, 1000, { id: 'hurt-b', hp: 41 })
    .unit('us', 'archer', 1500, 1050, { id: 'healthy-a' })
    .unit('us', 'archer', 1550, 1050, { id: 'healthy-b' }).build().createGame();
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
  recordUnitTaskClaim(snapshot, memory, 'healthy-a', { kind: 'mineRally', targetId: 'natural-hall', x: 1500, y: 1100 });
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

it('leaves the real wounded footmen at the natural rather than its healthy archers', () => {
  const saved = JSON.parse(readFileSync(new URL('./fixtures/expansion-natural-4m15.json', import.meta.url), 'utf8')) as {
    snapshot: GameSnapshot; memories: Record<string, AiPolicyMemory>;
  };
  const snapshot = structuredClone(saved.snapshot), memory = structuredClone(saved.memories.v9_archer!);
  const options = { memory, ...(snapshot.teams ? { teams: snapshot.teams } : {}) };
  // The snapshot is one tick before completion; script that single event without changing its soldiers.
  snapshot.buildings.find(building => building.id === 'building-v9_archer-townHall-1553')!.complete = true;
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
  prepareExpansionMission(snapshot, 'us', options, readV6Intel(snapshot, 'us', options));
  for (const id of guards) {
    expect(memory.unitClaims[id]?.kind).toBe('expansionGarrison');
    expect(expansionMissionUnitIds(memory)).not.toContain(id);
  }
  expect(expansionMissionUnitIds(memory)).toContain('healthy-a');
});
