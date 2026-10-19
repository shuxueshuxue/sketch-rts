import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { activeUnitClaim, clearUnitClaim, forgetExpansionMember, ordinaryUnitClaim,
  pruneAiPolicyMemory, recordAiMemoryForCommands, recordUnitTaskClaim, setUnitClaim, unitRetreatClaim } from '../policy/claims';
import { expansionMissionUnitIds, migrateExpansionClaims } from './expansion-mission';
import { expansionOwnsDefender, recordMiningGeneralCommands } from './mining-leash';

function assigned() {
  const game = sketchScene('expansion-ownership').map('openClaims').replaceDefaults()
    .player('us', { team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', 500, 500).goldMine('natural', 1600, 1100)
    .townHall('foe', 3500, 3500).unit('us', 'footman', 1400, 1100, { id: 'escort' }).build().createGame();
  const snapshot = snapshotGame(game), memory = createAiPolicyMemory();
  memory.landExpansion = { mineId: 'natural', sinceTick: 0, stage: 'build', interruptions: [] };
  const unit = snapshot.units.find(unit => unit.id === 'escort')!;
  setUnitClaim(memory, unit.id, { kind: 'expansion', targetId: 'natural', x: 1600, y: 1100,
    sinceTick: 0, expiresTick: 30, expansionMineId: 'natural' });
  const options = { memory };
  return { snapshot, memory, unit, options };
}

it('keeps construction membership when an accepted local move releases the ordinary movement claim', () => {
  const { snapshot, memory, unit, options } = assigned();
  recordAiMemoryForCommands(snapshot, 'v6General', [{ type: 'move', unitIds: [unit.id], x: 1600, y: 1100 }],
    memory, { owner: 'us', redirects: 'local' });
  expect(ordinaryUnitClaim(memory, unit.id)).toBeUndefined();
  expect(activeUnitClaim(snapshot, 'us', unit, options)).toBeUndefined();
  expect(expansionMissionUnitIds(memory)).toEqual([unit.id]);
  expect(expansionOwnsDefender(snapshot, 'us', options, unit)).toBe(true);
  expect('unitIds' in memory.landExpansion!).toBe(false);
});

it.each(['expiry', 'foundation'] as const)('preserves the screen after ordinary claim release by %s', reason => {
  const { snapshot, memory, unit, options } = assigned();
  if (reason === 'expiry') snapshot.tick = 31;
  else snapshot.buildings.push({ ...snapshot.buildings[0]!, id: 'new-hall', x: 1600, y: 1100, complete: false });
  pruneAiPolicyMemory(snapshot, 'us', memory);
  expect(ordinaryUnitClaim(memory, unit.id)).toBeUndefined();
  expect(expansionOwnsDefender(snapshot, 'us', options, unit)).toBe(true);
  expect(expansionMissionUnitIds(memory)).toEqual([unit.id]);
});

it('retains the same membership across a defense pause without continuing to own its soldiers', () => {
  const { snapshot, memory, unit, options } = assigned();
  clearUnitClaim(memory, unit.id);
  memory.landExpansion!.paused = true;
  snapshot.tick = 10000;
  pruneAiPolicyMemory(snapshot, 'us', memory);
  expect(expansionMissionUnitIds(memory)).toEqual([unit.id]);
  expect(expansionOwnsDefender(snapshot, 'us', options, unit)).toBe(false);
  delete memory.landExpansion!.paused;
  expect(expansionOwnsDefender(snapshot, 'us', options, unit)).toBe(true);
});

it('preserves both retreat micro and the original mission membership on one claim', () => {
  const { snapshot, memory, unit, options } = assigned();
  recordAiMemoryForCommands(snapshot, 'skirmishPreservation', [{ type: 'move', unitIds: [unit.id], x: 500, y: 500 }],
    memory, { owner: 'us', redirects: 'local' });
  expect(unitRetreatClaim(snapshot, unit, options)).toMatchObject({ kind: 'retreat', x: 500, y: 500 });
  expect(expansionMissionUnitIds(memory)).toEqual([unit.id]);
  recordUnitTaskClaim(snapshot, memory, unit.id, { kind: 'mineRally', targetId: snapshot.buildings[0]!.id, x: 500, y: 500 });
  expect(activeUnitClaim(snapshot, 'us', unit, options)?.kind).toBe('mineRally');
  forgetExpansionMember(memory, unit.id);
  expect(activeUnitClaim(snapshot, 'us', unit, options)?.kind).toBe('mineRally');
  expect(expansionMissionUnitIds(memory)).toEqual([]);
});

it.each(['dead', 'owner', 'mission'] as const)('cleans membership through the shared registry when %s is lost', reason => {
  const { snapshot, memory, unit } = assigned();
  clearUnitClaim(memory, unit.id);
  if (reason === 'dead') snapshot.units = snapshot.units.filter(candidate => candidate.id !== unit.id);
  if (reason === 'owner') unit.owner = 'foe';
  if (reason === 'mission') delete memory.landExpansion;
  pruneAiPolicyMemory(snapshot, 'us', memory);
  expect(memory.unitClaims[unit.id]).toBeUndefined();
});

it('imports a legacy snapshot roster once without extending an existing order lease', () => {
  const { snapshot, memory, unit } = assigned();
  delete memory.unitClaims[unit.id]!.expansionMineId;
  Object.assign(memory.landExpansion!, { unitIds: [unit.id] });
  const before = structuredClone(memory.unitClaims[unit.id]);
  migrateExpansionClaims(snapshot, memory);
  expect(memory.unitClaims[unit.id]).toEqual({ ...before, expansionMineId: 'natural' });
  expect('unitIds' in memory.landExpansion!).toBe(false);
  expect(expansionMissionUnitIds(memory)).toEqual([unit.id]);
  const first = structuredClone(memory);
  migrateExpansionClaims(snapshot, memory);
  expect(memory).toEqual(first);
});

it('retains the paused construction screen when a temporary general guard is released', () => {
  const { snapshot, memory, unit, options } = assigned();
  memory.landExpansion!.paused = true;
  recordUnitTaskClaim(snapshot, memory, unit.id, { kind: 'mineGuard', targetId: snapshot.buildings[0]!.id, x: 500, y: 500 });
  memory.v6 = { general: { mode: 'hold' } };
  recordMiningGeneralCommands(snapshot, 'us', options, [{ type: 'move', unitIds: [unit.id], x: 500, y: 500 }]);
  expect(ordinaryUnitClaim(memory, unit.id)).toBeUndefined();
  expect(expansionMissionUnitIds(memory)).toEqual([unit.id]);
});
