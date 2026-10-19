import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { activeUnitClaim, isMineRallyClaim, pruneAiPolicyMemory, recordUnitTaskClaim, unitRetreatClaim } from '../policy/claims';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapPolicyContext } from './policy';
import { mainArmyIntel, mineDefense, miningRally } from './mine-defense';
import { miningRallyAssignment, planMiningRally } from './mining-rally';
import { miningJobSafety } from './mining-job-defense';
import { expansionOwnsDefender, recordMiningGeneralCommands } from './mining-leash';
import { prepareExpansionMission } from './expansion-mission';
import { readV6Intel } from '../policy/v6/intel';

function captured(name: string, owner: 'v9_archer' | 'v9_knight') {
  const saved: { snapshot: GameSnapshot; memories: Record<string, AiPolicyMemory> } = JSON.parse(readFileSync(
    new URL(`./fixtures/defense-${name}.json`, import.meta.url), 'utf8'));
  const snapshot = structuredClone(saved.snapshot), memory = structuredClone(saved.memories[owner]!);
  const options = bootstrapPolicyContext(snapshot, owner, owner, { memory, teams: snapshot.teams ?? {} });
  return { snapshot, memory, options, owner };
}

it('does not acquire a rally from proposed orders rejected by a higher-priority task', () => {
  const { snapshot, memory, options, owner } = captured('rally-14m48', 'v9_archer');
  const hall = snapshot.buildings.find(building => building.owner === owner && building.kind === 'townHall')!;
  const attackers = snapshot.units.filter(unit => unit.owner === 'p1' && unit.attackDamage > 0);
  // Use the captured units/terrain with an explicit initial intrusion; this test isolates command acceptance.
  const intel = { ...mainArmyIntel(snapshot, owner, options), intrusion: { building: hall, attackers, threat: 1 } };
  const assignment = miningRallyAssignment(snapshot, owner, options, intel)!;
  const ids = assignment.units.map(unit => unit.id);
  const entries = runAiCommandEntriesFromScripts(snapshot, owner, [
    { id: 'earlier-task', phase: 'tactics', redirects: 'strategic', claimsUnits: () => new Set(ids),
      run: () => ({ type: 'holdPosition', unitIds: ids }) },
    { ...miningRally, claimsUnits: () => new Set(ids), run: () => planMiningRally(snapshot, owner, options, intel) },
  ], options);
  expect(entries.some(entry => entry.scriptId === 'earlier-task')).toBe(true);
  expect(entries.some(entry => entry.scriptId === 'miningRally')).toBe(false);
  expect(memory.miningDefense).toBeUndefined();
  expect(ids.some(id => isMineRallyClaim(memory.unitClaims[id]))).toBe(false);
});

it.each([false, true])('records worker evacuation ownership only for accepted orders (blocked=$blocked)', blocked => {
  const { snapshot, memory, options, owner } = captured('worker-32m36', 'v9_knight');
  const ids = snapshot.units.filter(unit => unit.owner === owner && unit.kind === 'worker').map(unit => unit.id);
  const entries = runAiCommandEntriesFromScripts(snapshot, owner, [
    ...(blocked ? [{ id: 'earlier-worker-task', phase: 'tactics' as const, redirects: 'strategic' as const,
      claimsUnits: () => new Set(ids), run: () => ({ type: 'holdPosition' as const, unitIds: ids }) }] : []), miningJobSafety,
  ], options);
  const moved = new Set(entries.flatMap(entry => entry.scriptId === 'miningJobSafety' && 'unitIds' in entry.command ? entry.command.unitIds : []));
  expect(moved.size > 0).toBe(!blocked);
  const evacuating = snapshot.units.filter(unit => activeUnitClaim(snapshot, owner, unit, options)?.kind === 'workerSafety');
  expect(evacuating.length > 0).toBe(!blocked);
  expect(evacuating.every(unit => moved.has(unit.id))).toBe(true);
  expect('workerSafety' in memory).toBe(false);
});

function assigned() {
  const context = captured('rally-14m48', 'v9_archer');
  const hall = context.snapshot.buildings.find(building => building.owner === context.owner && building.kind === 'townHall')!;
  const unit = context.snapshot.units.find(unit => unit.owner === context.owner && unit.kind !== 'worker')!;
  recordUnitTaskClaim(context.snapshot, context.memory, unit.id, { kind: 'mineRally', targetId: hall.id,
    x: hall.x, y: hall.y, arrived: true });
  return { ...context, hall, unit };
}

it.each(['local', 'strategic', undefined] as const)('uses the accepted script role to transfer a defender (%s)', redirects => {
  const { snapshot, owner, options, unit } = assigned();
  runAiCommandEntriesFromScripts(snapshot, owner, [{ id: 'arbitrary-new-script', phase: 'tactics',
    ...(redirects ? { redirects } : {}), run: () => ({ type: 'move', unitIds: [unit.id], x: 1000, y: 1000 }) }], options);
  expect(isMineRallyClaim(activeUnitClaim(snapshot, owner, unit, options))).toBe(redirects === 'local');
});

it('does not transfer ownership when another strategic script issues no command', () => {
  const { snapshot, owner, options, unit } = assigned();
  runAiCommandEntriesFromScripts(snapshot, owner, [{ id: 'unissued-strategy', phase: 'tactics', redirects: 'strategic', run: () => [] }], options);
  expect(activeUnitClaim(snapshot, owner, unit, options)).toMatchObject({ kind: 'mineRally', arrived: true });
});

it('transfers ownership for an accepted strategic errand with a single unitId', () => {
  const { snapshot, owner, options, unit } = assigned();
  runAiCommandEntriesFromScripts(snapshot, owner, [{ id: 'new-pickup-task', phase: 'tactics', redirects: 'strategic',
    run: () => ({ type: 'pickupItem', unitId: unit.id, itemId: 'nearby-loot' }) }], options);
  expect(activeUnitClaim(snapshot, owner, unit, options)).toBeUndefined();
});

it('does not forget an actual guard when the general changes its plan without an accepted order', () => {
  const { snapshot, owner, options, memory, unit } = assigned();
  memory.unitClaims[unit.id]!.kind = 'mineGuard';
  memory.v6 = { ...memory.v6, general: { mode: 'hold' } };
  recordMiningGeneralCommands(snapshot, owner, options, []);
  expect(activeUnitClaim(snapshot, owner, unit, options)?.kind).toBe('mineGuard');
  recordMiningGeneralCommands(snapshot, owner, options, [{ type: 'move', unitIds: [unit.id], x: 1000, y: 1000 }]);
  expect(activeUnitClaim(snapshot, owner, unit, options)).toBeUndefined();
});

it('keeps an expansion garrison out of the rally, local detachment, main army and next expansion', () => {
  const { snapshot, owner, options, memory, unit, hall } = assigned();
  memory.unitClaims[unit.id]!.kind = 'expansionGarrison';
  expect(expansionOwnsDefender(snapshot, owner, options, unit)).toBe(true);
  expect(mainArmyIntel(snapshot, owner, options).army.some(candidate => candidate.id === unit.id)).toBe(false);
  expect(mineDefense.claimsUnits!(snapshot, owner, options).has(unit.id)).toBe(false);
  const intel = readV6Intel(snapshot, owner, options);
  const assignment = miningRallyAssignment(snapshot, owner, options, { ...intel,
    intrusion: { building: hall, attackers: intel.enemies.flatMap(enemy => enemy.army), threat: 1 } })!;
  expect(assignment.units.some(candidate => candidate.id === unit.id)).toBe(false);
  memory.landExpansion = { mineId: snapshot.resources.find(mine => mine.amount > 0)!.id,
    sinceTick: snapshot.tick, stage: 'escort', interruptions: [] };
  memory.unitClaims[unit.id]!.expansionMineId = memory.landExpansion.mineId;
  prepareExpansionMission(snapshot, owner, options, mainArmyIntel(snapshot, owner, options));
  expect(memory.unitClaims[unit.id]?.expansionMineId).toBeUndefined();
  expect(activeUnitClaim(snapshot, owner, unit, options)?.kind).toBe('expansionGarrison');
});

it.each(['mineRally', 'expansionGarrison'] as const)('keeps %s ownership and existing retreat micro during an accepted local pullback', kind => {
  const { snapshot, memory, owner, options, unit } = assigned();
  memory.unitClaims[unit.id]!.kind = kind;
  const point = { x: unit.x - 300, y: unit.y - 300 };
  runAiCommandEntriesFromScripts(snapshot, owner, [{ id: 'skirmishPreservation', phase: 'tactics', redirects: 'local',
    run: () => ({ type: 'move', unitIds: [unit.id], ...point, avoidCombat: true }) }], options);
  unit.order = { type: 'move', ...point, avoidCombat: true };
  expect(activeUnitClaim(snapshot, owner, unit, options)).toMatchObject({ kind, arrived: true });
  expect(unitRetreatClaim(snapshot, unit, options)).toMatchObject({ kind: 'retreat', ...point });
  expect(Object.keys(memory.unitClaims).filter(id => id === unit.id)).toHaveLength(1);
});

it.each(['expired', 'hall-lost'] as const)('releases a stale mining claim through the shared lifecycle (%s)', reason => {
  const { snapshot, memory, owner, options, unit, hall } = assigned();
  if (reason === 'expired') snapshot.tick = memory.unitClaims[unit.id]!.expiresTick + 1;
  const next = reason === 'hall-lost' ? { ...snapshot, buildings: snapshot.buildings.filter(building => building.id !== hall.id) } : snapshot;
  expect(activeUnitClaim(next, owner, unit, options)).toBeUndefined();
  pruneAiPolicyMemory(next, owner, memory);
  expect(memory.unitClaims[unit.id]).toBeUndefined();
});
