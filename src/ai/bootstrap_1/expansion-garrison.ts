import { isRangedUnit } from "../../shared/unit-weapon-class";
import { BUILDING_DEFS, unitMover } from '../../shared/catalog';
import { isBuildPlacementClear } from '../../shared/build-placement';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { sameGround, walkableGoal } from '../../shared/terrain';
import type { Building, GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { activeUnitClaim, forgetExpansionMember, isDefenseTaskClaim, ordinaryUnitClaim, recordUnitTaskClaim } from '../policy/claims';
import { distance, type Point } from '../policy/spatial';
import type { AiPolicyContext, AiScript } from '../policy/types';
import { isBacklineKind } from '../policy/v6/backline';
import { towerPointFor } from '../policy/build-layout';
import type { Economy } from '../policy/v6/economy';
import { armedFoes, retreatLandRoad, retreatLandTravelTicks, safeLandTravelTicks } from './safe-land-route';
import { availableV6Army } from '../policy/v6/general';
import { readV6Intel } from '../policy/v6/intel';
import { strengthOf, TOWER_STRENGTH } from '../policy/v6/strength';
import { postRecoveryAssignments } from './front-recovery';
import { incomingLandArmy } from '../policy/land-arrivals';
import { strategyLeaseAllows } from '../strategy/control';
import { expansionGarrisonActor } from '../strategy/incumbent-actors';
import { bindIncumbentCommands, inheritIncumbentCommand } from '../strategy/incumbent-command-source';
import { EXPANSION_GARRISON_COVERAGE_RADIUS as PERIMETER } from './expansion-garrison-rules';

const POST_RANGE = 240;
// A small raid's first two arriving fighters, not the opponent's entire army.
// Larger committed attacks retain the mine-rally commander's priority.
const RAID_FIGHTERS = 2;
const RECOVERING_SHARE = .6;
type Site = { mine: Point & { id: string }; hall: Building };
type Assignment = { hall: Building; units: Unit[]; point: Point };
const proposals = new WeakMap<AiPolicyMemory, { tick: number; assignments: Assignment[] }>();
const raids = new WeakMap<Unit[], Map<string, { power: number; arrival: number }>>();

function expansionSite(snapshot: GameSnapshot, owner: PlayerId, mineId: string): Site | undefined {
  const mine = snapshot.resources.find(mine => mine.id === mineId && mine.amount > 0);
  const hall = mine && snapshot.buildings.find(building => building.owner === owner && building.kind === 'townHall'
    && distance(building, mine) < GOLD_MINE_RULES.baseRange);
  return mine && hall ? { mine, hall } : undefined;
}

function postPoint(snapshot: GameSnapshot, { hall, mine }: Site) {
  return walkableGoal(snapshot.map, (hall.x + mine.x) / 2, (hall.y + mine.y) / 2);
}

function covers(building: Building, owner: PlayerId, { hall, mine }: Site) {
  return building.owner === owner && building.hp > 0 && building.attackDamage > 0
    && distance(building, hall) <= building.attackRange + hall.radius && distance(building, mine) <= building.attackRange;
}

function coverPower(snapshot: GameSnapshot, owner: PlayerId, site: Site) {
  return snapshot.buildings.filter(building => building.complete && covers(building, owner, site))
    .reduce((power, building) => power + TOWER_STRENGTH * building.hp / building.maxHp, 0);
}

function expectedRaid(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, site: Site) {
  let byPost = raids.get(snapshot.units);
  if (!byPost) { byPost = new Map(); raids.set(snapshot.units, byPost); }
  const key = `${owner}:${site.hall.id}`, cached = byPost.get(key);
  if (cached) return cached;
  const point = postPoint(snapshot, site);
  const arriving = incomingLandArmy(snapshot, owner, options, point).slice(0, RAID_FIGHTERS);
  const result = { power: strengthOf(arriving.map(({ unit }) => unit)), arrival: arriving[0]?.ticks ?? Infinity };
  byPost.set(key, result);
  return result;
}

function establishedDefense(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, site: Site) {
  return strengthOf(snapshot.units.filter(unit => {
    const claim = activeUnitClaim(snapshot, owner, unit, options);
    return unit.owner === owner && !unit.deck && isDefenseTaskClaim(claim)
      && !(claim.kind === 'expansionGarrison' && claim.targetId === site.hall.id)
      && distance(claim, postPoint(snapshot, site)) <= PERIMETER && distance(unit, site.hall) <= PERIMETER;
  }));
}

function guardPool(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, site: Site) {
  const healingElsewhere = new Set(postRecoveryAssignments(snapshot, owner, options)
    .filter(care => distance(care.point, site.hall) > PERIMETER).map(care => care.patient.id));
  const actor = expansionGarrisonActor(site.hall.id);
  return availableV6Army(snapshot, { ...options, strategyActor: actor }, { ...readV6Intel(snapshot, owner, options), home: site.hall }).filter(unit => {
    const claim = ordinaryUnitClaim(options.memory, unit.id);
    const ownGuard = claim?.kind === 'expansionGarrison' && claim.targetId === site.hall.id;
    return unit.owner === owner && unit.hp > 0 && !unit.deck && unit.order.type !== 'board'
      && unit.expiresTick === undefined && unitMover(unit.kind) === 'land' && !isBacklineKind(unit)
      && unit.kind !== 'worker' && unit.attackDamage > 0 && sameGround(snapshot.map, unit, site.hall)
      && (ownGuard || !claim || claim.kind === 'retreat' && unit.hp < unit.maxHp * RECOVERING_SHARE
        || claim.kind === 'expansion' && claim.targetId === site.mine.id)
      && options.memory.mercenaryCourier?.unitId !== unit.id && options.memory.loot?.unitId !== unit.id
      && options.memory.shopping?.unitId !== unit.id && options.memory.v6?.shop?.unitId !== unit.id
      && !options.memory.mounted?.some(task => task.unitIds.includes(unit.id)) && (ownGuard || !healingElsewhere.has(unit.id))
      && (ownGuard || !isDefenseTaskClaim(activeUnitClaim(snapshot, owner, unit, options)));
  }).sort((a, b) => {
    // Crippled frontliners cannot help the next camp; recovering shooters can
    // still clear it from range. Keep those melee survivors at the mining post first.
    const role = (unit: Unit) => unit.hp >= unit.maxHp * RECOVERING_SHARE ? 2 : !isRangedUnit(unit) ? 0 : 1;
    return role(a) - role(b) || a.hp / a.maxHp - b.hp / b.maxHp || distance(a, site.hall) - distance(b, site.hall);
  });
}

function selectGuards(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, site: Site, pool: Unit[]) {
  const strength = coverPower(snapshot, owner, site) + establishedDefense(snapshot, owner, options, site), required = expectedRaid(snapshot, owner, options, site).power;
  const units: Unit[] = [];
  for (const unit of pool) {
    // An unarmed safe mine still keeps one recovering soldier present. A completed
    // weapon may stand alone when it can cover the forecast raid by itself.
    if ((units.length > 0 || strength > 0) && strength + strengthOf(units) >= required) break;
    units.push(unit);
  }
  return units;
}

/** Buy cover only when recovering soldiers cannot cover a plausible approaching raid. */
export function expansionGarrisonCoverGoals(economy: Economy) {
  const { snapshot, owner, options } = economy, range = BUILDING_DEFS.defenseTower.attackRange;
  return Object.entries(options.memory.expansionGarrisons ?? {}).flatMap(([hallId, task]) => {
    const site = expansionSite(snapshot, owner, task.mineId);
    if (!site || site.hall.id !== hallId || snapshot.buildings.some(building => covers(building, owner, site))) return [];
    const raid = expectedRaid(snapshot, owner, options, site), point = towerPointFor(snapshot, owner, site.mine, site.hall);
    if (raid.power === 0) return [];
    const recovering = guardPool(snapshot, owner, options, site).filter(unit => (unit.hp < unit.maxHp * RECOVERING_SHARE
      || options.memory.unitClaims[unit.id]?.kind === 'expansionGarrison' && !options.memory.unitClaims[unit.id]?.garrisonTemporary)
      && (safeLandTravelTicks(snapshot, unit, postPoint(snapshot, site), [], end => distance(end, site.hall) <= PERIMETER) ?? Infinity) <= raid.arrival);
    if (strengthOf(recovering) + coverPower(snapshot, owner, site) + establishedDefense(snapshot, owner, options, site) >= raid.power) return [];
    if (!isBuildPlacementClear(snapshot, 'defenseTower', point) || distance(point, site.mine) > range
      || distance(point, site.hall) > range + site.hall.radius) return [];
    const foes = armedFoes(snapshot, owner, options), workers = economy.workers.filter(worker =>
      retreatLandTravelTicks(snapshot, worker, point, foes) !== undefined);
    // This hall is already paid and founded. Finish its defensive handoff before
    // optional recruits/tech can leave healthy escorts tied here for another minute.
    return workers.length ? [{ id: `expansion-garrison:${hallId}`, priority: 105,
      cost: BUILDING_DEFS.defenseTower.cost, save: true,
      issue: (used: Set<string>) => economy.construct({ ...economy, workers }, 'defenseTower', point, used, 'expansion:garrisonCover') }] : [];
  });
}

/** Renew only our own posts; a static weapon releases soldiers only if it covers the forecast raid. */
export function maintainExpansionGarrisons(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const memory = options.memory, retired = new Set<string>();
  for (const [hallId, task] of Object.entries(memory.expansionGarrisons ?? {})) {
    const site = expansionSite(snapshot, owner, task.mineId);
    const staticPower = site && (coverPower(snapshot, owner, site) + establishedDefense(snapshot, owner, options, site));
    if (!site || site.hall.id !== hallId || staticPower && staticPower >= expectedRaid(snapshot, owner, options, site).power) {
      retired.add(hallId); delete memory.expansionGarrisons![hallId];
      continue;
    }
    const selected = selectGuards(snapshot, owner, options, site, guardPool(snapshot, owner, options, site));
    const present = selected.filter(unit => distance(unit, site.hall) <= PERIMETER
      && activeUnitClaim(snapshot, owner, unit, options)?.kind === 'expansionGarrison');
    if ((present.length || staticPower) && strengthOf(present) + (staticPower ?? 0) >= expectedRaid(snapshot, owner, options, site).power) {
      // A finished tower replaces temporary healthy escorts. Keep ownership until
      // the soldiers that remain have actually arrived, not merely been proposed.
      for (const [id, claim] of Object.entries(memory.unitClaims)) if (claim.kind === 'expansionGarrison'
        && claim.targetId === hallId && !selected.some(unit => unit.id === id)) delete memory.unitClaims[id];
    }
  }
  for (const [id, claim] of Object.entries(memory.unitClaims)) {
    if (claim.kind !== 'expansionGarrison') continue;
    const unit = snapshot.units.find(unit => unit.id === id && unit.owner === owner && !unit.deck && unit.order.type !== 'board');
    if (!unit || retired.has(claim.targetId) || !strategyLeaseAllows(memory, id, expansionGarrisonActor(claim.targetId))) delete memory.unitClaims[id];
    else if (memory.expansionGarrisons?.[claim.targetId]) recordUnitTaskClaim(snapshot, memory, id, claim);
    // A serialized task without our post record belongs to its original issuer.
  }
}

/** Completion includes an actual defense handoff before recruiting the next expedition. */
export function expansionGarrisonReady(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, mineId: string) {
  const site = expansionSite(snapshot, owner, mineId);
  if (!site) return true;
  const strength = coverPower(snapshot, owner, site) + establishedDefense(snapshot, owner, options, site), required = expectedRaid(snapshot, owner, options, site).power;
  if (strength > 0 && strength >= required) return true;
  (options.memory.expansionGarrisons ??= {})[site.hall.id] ??= { mineId, sinceTick: snapshot.tick };
  if (!site.hall.complete) return false;
  const guards = snapshot.units.filter(unit => activeUnitClaim(snapshot, owner, unit, options)?.kind === 'expansionGarrison'
    && options.memory.unitClaims[unit.id]?.targetId === site.hall.id && distance(unit, site.hall) <= PERIMETER);
  return (guards.length > 0 || strength > 0) && strengthOf(guards) + strength >= required;
}

function assignments(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): Assignment[] {
  const used = new Set<string>();
  return Object.entries(options.memory.expansionGarrisons ?? {}).flatMap(([hallId, task]) => {
    const site = expansionSite(snapshot, owner, task.mineId);
    if (!site || site.hall.id !== hallId) return [];
    const pool = guardPool(snapshot, owner, options, site).filter(unit => !used.has(unit.id));
    const units = selectGuards(snapshot, owner, options, site, pool);
    // Do not drop an existing screen while its replacements are still walking.
    const held = snapshot.units.filter(unit => activeUnitClaim(snapshot, owner, unit, options)?.kind === 'expansionGarrison'
      && options.memory.unitClaims[unit.id]?.targetId === hallId && !units.includes(unit));
    units.push(...held);
    units.forEach(unit => used.add(unit.id));
    return [{ hall: site.hall, units, point: postPoint(snapshot, site) }];
  });
}

function needsOrder(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, unit: Unit, hall: Building, point: Point) {
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
    return new Set(selected.flatMap(({ hall, units, point }) => units
      .filter(unit => needsOrder(snapshot, owner, options, unit, hall, point)).map(unit => unit.id)));
  },
  run(snapshot, owner, options): GameCommand[] {
    const proposal = proposals.get(options.memory);
    return (proposal?.tick === snapshot.tick ? proposal.assignments : assignments(snapshot, owner, options))
      .flatMap(({ hall, units, point }): GameCommand[] => {
        const moving = units.filter(unit => needsOrder(snapshot, owner, options, unit, hall, point));
        const returning = moving.filter(unit => activeUnitClaim(snapshot, owner, unit, options)?.kind === 'expansionGarrison'
          || unit.hp < unit.maxHp * RECOVERING_SHARE);
        const joining = moving.filter(unit => !returning.includes(unit));
        return bindIncumbentCommands([
          ...(joining.length ? [{ type: 'attackMove' as const, unitIds: joining.map(unit => unit.id), ...point }] : []),
          ...(returning.length ? [{ type: 'move' as const, unitIds: returning.map(unit => unit.id), ...point, avoidCombat: true }] : []),
        ], expansionGarrisonActor(hall.id));
      });
  },
  onCommands(snapshot, owner, options, commands) {
    const proposal = proposals.get(options.memory);
    if (!proposal || proposal.tick !== snapshot.tick) return;
    const accepted = new Set(commands.flatMap(command => 'unitIds' in command ? command.unitIds : []));
    for (const { hall, units, point } of proposal.assignments) for (const unit of units) if (accepted.has(unit.id)) {
      forgetExpansionMember(options.memory, unit.id);
      const previous = options.memory.unitClaims[unit.id];
      const temporary = previous?.kind === 'expansionGarrison' ? previous.garrisonTemporary : unit.hp >= unit.maxHp * RECOVERING_SHARE;
      recordUnitTaskClaim(snapshot, options.memory, unit.id, { kind: 'expansionGarrison', targetId: hall.id, ...point,
        ...(temporary ? { garrisonTemporary: true } : {}) });
    }
  },
};

/** Recovery remains local to a safe mining post; immediate danger may still force an escape. */
export function garrisonRecoveryCommands(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, commands: GameCommand[]): GameCommand[] {
  if (!Object.values(options.memory.unitClaims).some(claim => claim.kind === 'expansionGarrison')) return commands;
  const foes = armedFoes(snapshot, owner, options);
  return commands.flatMap((command): GameCommand[] => {
    if (command.type !== 'move' && command.type !== 'attackMove') return [command];
    const local = command.unitIds.flatMap(id => {
      const unit = snapshot.units.find(unit => unit.id === id), claim = unit && activeUnitClaim(snapshot, owner, unit, options);
      if (!unit || claim?.kind !== 'expansionGarrison' || distance(command, claim) <= PERIMETER) return [];
      const road = retreatLandRoad(snapshot, unit, claim, foes), point = road?.points.at(-1);
      return point && distance(point, claim) <= POST_RANGE ? [{ unit, claim, point }] : [];
    });
    if (!local.length) return [command];
    const remaining = command.unitIds.filter(id => !local.some(({ unit }) => unit.id === id));
    return [ ...(remaining.length ? [inheritIncumbentCommand(command, { ...command, unitIds: remaining })] : []),
      ...local.flatMap(({ unit, claim, point }): GameCommand[] => bindIncumbentCommands([distance(unit, claim) <= POST_RANGE
        ? { type: 'holdPosition', unitIds: [unit.id] }
        : { type: 'move', unitIds: [unit.id], x: point.x, y: point.y, avoidCombat: true }], expansionGarrisonActor(claim.targetId))) ];
  });
}
