import { BUILDING_DEFS, unitMover } from '../../shared/catalog';
import { isBuildPlacementClear } from '../../shared/build-placement';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { sameGround, walkableGoal } from '../../shared/terrain';
import type { Building, GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { activeUnitClaim, forgetExpansionMember, isDefenseTaskClaim, ordinaryUnitClaim, recordUnitTaskClaim } from '../policy/claims';
import { distance } from '../policy/spatial';
import type { AiPolicyContext, AiScript } from '../policy/types';
import { isBacklineKind } from '../policy/v6/backline';
import { towerPointFor } from '../policy/build-layout';
import type { Economy } from '../policy/v6/economy';
import { armedFoes, retreatLandTravelTicks } from './safe-land-route';
import { availableV6Army } from '../policy/v6/general';
import { readV6Intel } from '../policy/v6/intel';
import { strengthOf } from '../policy/v6/strength';
import { isOpponentOwner } from '../policy/ownership';
import { groundThreatWithin } from '../policy/ground-threat';
import { postRecoveryAssignments } from './front-recovery';

// A healthy footman is the minimum screen against a scout. Known intruders
// require their actual strength plus a margin, independent of the number of guards.
const MINIMUM_SCREEN = 1;
const POST_RANGE = 240;
const PERIMETER = 650;
const proposals = new WeakMap<AiPolicyMemory, { tick: number; assignments: { hall: Building; units: Unit[]; point: { x: number; y: number } }[] }>();

function ownDefense(snapshot: GameSnapshot, owner: PlayerId, hall: Building, mine: { x: number; y: number }) {
  return snapshot.buildings.some(building => building.owner === owner && building.complete && building.attackDamage > 0
    && distance(building, hall) <= building.attackRange + hall.radius && distance(building, mine) <= building.attackRange);
}

function expansionSite(snapshot: GameSnapshot, owner: PlayerId, mineId: string) {
  const mine = snapshot.resources.find(mine => mine.id === mineId && mine.amount > 0);
  const hall = mine && snapshot.buildings.find(building => building.owner === owner && building.kind === 'townHall'
    && distance(building, mine) < GOLD_MINE_RULES.baseRange);
  return mine && hall ? { mine, hall } : undefined;
}

/** Buy the post its own weapon so a permanent garrison does not consume the next expansion's escort. */
export function expansionGarrisonCoverGoals(economy: Economy) {
  const { snapshot, owner, options } = economy, range = BUILDING_DEFS.defenseTower.attackRange;
  return Object.entries(options.memory.expansionGarrisons ?? {}).flatMap(([hallId, task]) => {
    const target = expansionSite(snapshot, owner, task.mineId);
    if (!target || target.hall.id !== hallId || snapshot.buildings.some(building => building.owner === owner
      && building.kind === 'defenseTower' && distance(building, target.mine) <= range
      && distance(building, target.hall) <= range + target.hall.radius)) return [];
    const point = towerPointFor(snapshot, owner, target.mine, target.hall);
    if (!isBuildPlacementClear(snapshot, 'defenseTower', point) || distance(point, target.mine) > range
      || distance(point, target.hall) > range + target.hall.radius) return [];
    const foes = armedFoes(snapshot, owner, options), workers = economy.workers.filter(worker =>
      retreatLandTravelTicks(snapshot, worker, point, foes) !== undefined);
    // Finish the new income's defensive handoff before optional recruits or tech;
    // otherwise aged supply/infrastructure goals can leave its escorts waiting a minute.
    return workers.length ? [{ id: `expansion-garrison:${hallId}`, priority: 105,
      cost: BUILDING_DEFS.defenseTower.cost, save: true,
      issue: (used: Set<string>) => economy.construct({ ...economy, workers }, 'defenseTower', point, used, 'expansion:garrisonCover') }] : [];
  });
}

/** A post lasts until its hall/mine is lost or a completed weapon covers the hall and workers. */
export function maintainExpansionGarrisons(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const memory = options.memory;
  for (const [hallId, task] of Object.entries(memory.expansionGarrisons ?? {})) {
    const target = expansionSite(snapshot, owner, task.mineId);
    if (!target || target.hall.id !== hallId || ownDefense(snapshot, owner, target.hall, target.mine)) {
      delete memory.expansionGarrisons![hallId];
    }
  }
  for (const [id, claim] of Object.entries(memory.unitClaims)) {
    if (claim.kind !== 'expansionGarrison') continue;
    const unit = snapshot.units.find(unit => unit.id === id && unit.owner === owner && !unit.deck && unit.order.type !== 'board');
    if (!unit || !memory.expansionGarrisons?.[claim.targetId]) delete memory.unitClaims[id];
    else recordUnitTaskClaim(snapshot, memory, id, claim);
  }
}

/** Completion includes the handoff: a new mining task may use only the remaining soldiers. */
export function expansionGarrisonReady(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, mineId: string) {
  const target = expansionSite(snapshot, owner, mineId);
  if (!target || ownDefense(snapshot, owner, target.hall, target.mine)) return true;
  (options.memory.expansionGarrisons ??= {})[target.hall.id] ??= { mineId, sinceTick: snapshot.tick };
  if (!target.hall.complete) return false;
  return strengthOf(snapshot.units.filter(unit => activeUnitClaim(snapshot, owner, unit, options)?.kind === 'expansionGarrison'
    && options.memory.unitClaims[unit.id]?.targetId === target.hall.id && distance(unit, target.hall) <= PERIMETER)) >= requiredScreen(snapshot, owner, options, target.hall);
}

function requiredScreen(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, hall: Building) {
  const raiders = snapshot.units.filter(unit => isOpponentOwner(snapshot, owner, unit.owner, options)
    && !unit.deck && unit.attackDamage > 0 && groundThreatWithin(snapshot, unit, hall, PERIMETER));
  return Math.max(MINIMUM_SCREEN, strengthOf(raiders) * 1.2);
}

function assignments(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const used = new Set<string>();
  const posts = Object.entries(options.memory.expansionGarrisons ?? {});
  if (!posts.length) return [];
  const front = availableV6Army(snapshot, options, readV6Intel(snapshot, owner, options));
  return posts.flatMap(([hallId, task]) => {
    const target = expansionSite(snapshot, owner, task.mineId);
    if (!target || !target.hall.complete || target.hall.id !== hallId) return [];
    const healingElsewhere = new Set(postRecoveryAssignments(snapshot, owner, options)
      .filter(care => distance(care.point, target.hall) > PERIMETER).map(care => care.patient.id));
    const held = snapshot.units.filter(unit => activeUnitClaim(snapshot, owner, unit, options)?.kind === 'expansionGarrison'
      && options.memory.unitClaims[unit.id]?.targetId === hallId);
    const pool = front.filter(unit => unit.owner === owner && !unit.deck && unit.order.type !== 'board'
      && unit.expiresTick === undefined && unitMover(unit.kind) === 'land' && !isBacklineKind(unit)
      && unit.kind !== 'worker' && unit.attackDamage > 0
      && sameGround(snapshot.map, unit, target.hall)
      && (!ordinaryUnitClaim(options.memory, unit.id) || ordinaryUnitClaim(options.memory, unit.id)?.kind === 'retreat'
          && unit.hp < unit.maxHp * .6 || ordinaryUnitClaim(options.memory, unit.id)?.kind === 'expansion'
          && options.memory.unitClaims[unit.id]?.targetId === task.mineId)
      && options.memory.mercenaryCourier?.unitId !== unit.id && options.memory.loot?.unitId !== unit.id
      && options.memory.shopping?.unitId !== unit.id && options.memory.v6?.shop?.unitId !== unit.id
      && !options.memory.mounted?.some(task => task.unitIds.includes(unit.id)) && !healingElsewhere.has(unit.id)
      && !used.has(unit.id) && !isDefenseTaskClaim(activeUnitClaim(snapshot, owner, unit, options)))
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || distance(a, target.hall) - distance(b, target.hall));
    const units = [...held], required = requiredScreen(snapshot, owner, options, target.hall);
    // Recovering soldiers still deter small raids; keep the healthy clearing force marching.
    for (const unit of pool) {
      if (strengthOf(units) >= required) break;
      units.push(unit);
    }
    units.forEach(unit => used.add(unit.id));
    const point = walkableGoal(snapshot.map, (target.hall.x + target.mine.x) / 2, (target.hall.y + target.mine.y) / 2);
    return [{ hall: target.hall, units, point }];
  });
}

function needsOrder(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, unit: Unit, hall: Building, point: { x: number; y: number }) {
  const claim = activeUnitClaim(snapshot, owner, unit, options);
  if (claim?.kind !== 'expansionGarrison' || claim.targetId !== hall.id) return true;
  const order = unit.order;
  const chasing = order.type === 'attack' && snapshot.units.find(foe => foe.id === order.targetId);
  if (chasing && distance(chasing, hall) <= PERIMETER && distance(unit, hall) <= PERIMETER) return false;
  if (order.type === 'move' && order.avoidCombat && distance(order, point) < 40) return false;
  return distance(unit, point) > POST_RANGE || chasing && distance(chasing, hall) > PERIMETER
    || (order.type === 'move' || order.type === 'attackMove') && distance(order, hall) > PERIMETER;
}

export const expansionGarrison: AiScript = {
  id: 'expansionGarrison', phase: 'tactics', redirects: 'local',
  claimsUnits(snapshot, owner, options) {
    const selected = assignments(snapshot, owner, options);
    proposals.set(options.memory, { tick: snapshot.tick, assignments: selected });
    // Stationary defenders still use local combat micro. Only assignment/return orders own the frame.
    return new Set(selected.flatMap(({ hall, units, point }) => units
      .filter(unit => needsOrder(snapshot, owner, options, unit, hall, point)).map(unit => unit.id)));
  },
  run(snapshot, owner, options): GameCommand[] {
    const proposal = proposals.get(options.memory);
    return (proposal?.tick === snapshot.tick ? proposal.assignments : assignments(snapshot, owner, options))
      .flatMap(({ hall, units, point }): GameCommand[] => {
        const moving = units.filter(unit => needsOrder(snapshot, owner, options, unit, hall, point));
        const returning = moving.filter(unit => activeUnitClaim(snapshot, owner, unit, options)?.kind === 'expansionGarrison');
        const joining = moving.filter(unit => !returning.includes(unit));
        const resting = joining.filter(unit => unit.hp < unit.maxHp * .6);
        const fighting = joining.filter(unit => !resting.includes(unit));
        return [
          ...(fighting.length ? [{ type: 'attackMove' as const, unitIds: fighting.map(unit => unit.id), ...point }] : []),
          ...(resting.length ? [{ type: 'move' as const, unitIds: resting.map(unit => unit.id), ...point, avoidCombat: true }] : []),
          ...(returning.length ? [{ type: 'move' as const, unitIds: returning.map(unit => unit.id), ...point, avoidCombat: true }] : []),
        ];
      });
  },
  onCommands(snapshot, owner, options, commands) {
    const proposal = proposals.get(options.memory);
    if (!proposal || proposal.tick !== snapshot.tick) return;
    const accepted = new Set(commands.flatMap(command => 'unitIds' in command ? command.unitIds : []));
    for (const { hall, units, point } of proposal.assignments) for (const unit of units) if (accepted.has(unit.id)) {
      forgetExpansionMember(options.memory, unit.id);
      recordUnitTaskClaim(snapshot, options.memory, unit.id, { kind: 'expansionGarrison', targetId: hall.id, ...point });
    }
  },
};
