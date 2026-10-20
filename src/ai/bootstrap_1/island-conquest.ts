import { BUILDING_DEFS, unitMover } from '../../shared/catalog';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { sameGround, walkableGoal } from '../../shared/terrain';
import { shipPassengers } from '../../shared/ship-geometry';
import { shipNeedsRepair } from '../../shared/ship-equipment';
import { isTransportKind } from '../../shared/transport-role';
import type { GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import type { NavalConquestMemory } from '../memory';
import { activeUnitClaim, isDefenseTaskClaim } from '../policy/claims';
import { mineClaimedByAlly } from '../policy/mine-claims';
import { isOpponentOwner } from '../policy/ownership';
import { distance } from '../policy/spatial';
import { coastOnWater, ferryCrewTaskAvailable, landingSafe, outgunned } from '../policy/naval';
import { navalServices } from '../policy/naval-services';
import { ferryTargetAvailable } from '../policy/ferry-retries';
import type { AiPolicyContext } from '../policy/types';
import { isBacklineKind } from '../policy/v6/backline';
import { readV6IntelAt } from '../policy/v6/intel';
import { v6Memory } from '../policy/v6/memory';
import { neutralCamps, EXPANSION_GUARD_RANGE, creepForce, forceFor, unavailableClearingReason } from '../policy/v7/creep';
import { recordExecutorReason } from '../executor-reasons';
import { V7_WOUNDED_SHARE } from '../policy/v6/general';
import { expansionGarrisonReady } from './expansion-garrison';
import { planMiningScreen } from './expansion-mission';
import { reinforcementCrew } from './reinforcement-ferries';

function permanentLand(unit: Unit) {
  return unit.hp > 0 && !unit.deck && unitMover(unit.kind) === 'land' && unit.expiresTick === undefined
    && unit.order.type !== 'board';
}

/** A physical landing commits this island through clearing, construction and defense. */
export function prepareIslandConquests(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const memory = options.memory;
  const home = snapshot.buildings.find(building => building.owner === owner && building.kind === 'townHall');
  const own = snapshot.units.filter(unit => unit.owner === owner && permanentLand(unit));
  const landed = home ? own.filter(unit => !sameGround(snapshot.map, unit, home)) : [];
  if (!landed.length && !memory.naval?.conquests) return;
  const naval = memory.naval ??= {};
  const tasks = naval.conquests ??= {};
  const first = naval.firstCombatDelivery;
  const deliveries = [
    ...Object.entries(first?.attempts ?? {}).flatMap(([shipId, attempt]) => {
      const mine = snapshot.resources.find(mine => mine.id === attempt.targetId);
      const unloaded = mine && own.some(unit => attempt.passengerIds.includes(unit.id) && sameGround(snapshot.map, unit, mine));
      return mine && (unloaded || first?.deliveredShipId === shipId) ? [mine] : [];
    }),
    ...Object.values(naval.ferries ?? {}).filter(mission => mission.deliveries?.length)
      .flatMap(mission => snapshot.resources.filter(mine => mine.id === mission.targetId)),
  ];
  const mines = snapshot.resources.filter(mine => home && mine.amount > 0 && !sameGround(snapshot.map, mine, home)
    && deliveries.some(delivery => sameGround(snapshot.map, delivery, mine))
    && landed.some(unit => sameGround(snapshot.map, mine, unit))
    && !mineClaimedByAlly(snapshot, owner, mine, options)
    && !snapshot.buildings.some(building => building.owner === owner && building.kind === 'townHall'
      && sameGround(snapshot.map, building, mine))
    && !snapshot.buildings.some(building => building.kind === 'townHall' && distance(building, mine) <= GOLD_MINE_RULES.baseRange));
  // One landing owns one mine at a time; an already committed mine keeps its party.
  for (const mine of mines.sort((a, b) => Number(deliveries.some(mine => mine.id === b.id)) - Number(deliveries.some(mine => mine.id === a.id))
    || Math.min(...landed.map(unit => distance(unit, a))) - Math.min(...landed.map(unit => distance(unit, b))))) {
    if (Object.values(tasks).some(task => task.abandonedTick === undefined && task.stage !== 'complete'
      && snapshot.resources.some(other => other.id === task.mineId && sameGround(snapshot.map, other, mine)))) continue;
    const mission = Object.values(naval.ferries ?? {}).find(task => task.targetId === mine.id && task.phase !== 'return');
    const party = landed.filter(unit => sameGround(snapshot.map, unit, mine));
    const shore = mission?.to ?? walkableGoal(snapshot.map, party[0]!.x, party[0]!.y, 'sea');
    tasks[mine.id] = { mineId: mine.id, sinceTick: snapshot.tick, stage: 'assemble', interruptions: [],
      landing: { x: shore.x, y: shore.y }, reason: 'landing-established' };
  }
  for (const task of Object.values(tasks)) {
    const mine = snapshot.resources.find(mine => mine.id === task.mineId && mine.amount > 0);
    const hall = mine && snapshot.buildings.find(building => building.kind === 'townHall' && distance(building, mine) <= GOLD_MINE_RULES.baseRange);
    if (!mine || hall && isOpponentOwner(snapshot, owner, hall.owner, options) || mineClaimedByAlly(snapshot, owner, mine, options)) {
      task.abandonedTick ??= snapshot.tick;
      task.reason = !mine ? snapshot.resources.some(resource => resource.id === task.mineId) ? 'mine-exhausted' : 'mine-missing'
        : hall && isOpponentOwner(snapshot, owner, hall.owner, options) ? 'enemy-mine-occupied' : 'ally-mine-claim';
      recordExecutorReason(options, { executor: 'island.prepare', outcome: 'abandoned', reason: task.reason,
        taskId: `island:${task.mineId}:${task.sinceTick}`, targetIds: [task.mineId] });
      continue;
    }
    if (hall?.owner === owner) {
      const ready = expansionGarrisonReady(snapshot, owner, options, mine.id);
      task.stage = hall.complete && ready ? 'complete' : 'build';
      task.reason = !hall.complete ? 'building-hall' : ready ? 'garrison-established' : 'await-garrison';
      continue;
    }
    const party = own.filter(unit => sameGround(snapshot.map, unit, mine));
    const inbound = Object.values(naval.ferries ?? {}).some(mission => mission.targetId === mine.id && mission.phase !== 'return');
    if (!party.length && !inbound) {
      task.abandonedTick ??= snapshot.tick; task.reason = 'no-landed-party-or-inbound-ferry';
      recordExecutorReason(options, { executor: 'island.prepare', outcome: 'abandoned', reason: task.reason,
        taskId: `island:${task.mineId}:${task.sinceTick}`, targetIds: [task.mineId] });
      continue;
    }
    delete task.abandonedTick;
    const guard = neutralCamps(snapshot).find(camp => distance(camp.center, mine) <= EXPANSION_GUARD_RANGE);
    if (!guard) {
      task.stage = 'escort';
      task.reason = party.some(unit => unit.kind === 'worker') ? snapshot.players[owner]!.gold >= BUILDING_DEFS.townHall.cost
        ? 'await-hall-order' : 'saving-hall-capital' : 'await-engineer-transport';
    }
  }
}

/** Once the camp is clear, the next empty return brings engineers before more infantry. */
export function planConquestEngineers(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const naval = options.memory.naval;
  if (!naval?.conquests) return;
  const own = snapshot.units.filter(unit => unit.owner === owner && unit.hp > 0);
  const home = snapshot.buildings.find(building => building.owner === owner && building.kind === 'townHall' && building.complete);
  const unavailable = (reason: string) => {
    for (const task of Object.values(naval.conquests!)) {
      if (task.abandonedTick !== undefined || task.stage !== 'escort') continue;
      const mine = snapshot.resources.find(mine => mine.id === task.mineId);
      if (!mine || own.some(unit => unit.kind === 'worker' && !unit.deck && sameGround(snapshot.map, unit, mine))
        || Object.values(naval.ferries ?? {}).some(mission => mission.targetId === mine.id && mission.purpose === 'settle' && mission.phase !== 'return')) continue;
      recordExecutorReason(options, { executor: 'island.engineers', outcome: 'blocked', reason,
        taskId: `island:${task.mineId}:${task.sinceTick}`, targetIds: [task.mineId] });
    }
  };
  if (!home) { unavailable('no-complete-home-for-engineers'); return; }
  const workers = own.filter(unit => unit.kind === 'worker' && !unit.deck && sameGround(snapshot.map, unit, home)
    && (unit.order.type === 'mine' || unit.order.type === 'idle') && ferryCrewTaskAvailable(unit, options));
  const reserveMiners = snapshot.resources.some(mine => mine.amount > 0 && sameGround(snapshot.map, mine, home)
    && snapshot.buildings.some(hall => hall.owner === owner && hall.kind === 'townHall'
      && distance(hall, mine) < GOLD_MINE_RULES.baseRange)) ? 3 : 0;
  if (workers.length <= reserveMiners) { unavailable('no-surplus-engineer'); return; }
  const ferries = naval.ferries ??= {}, reserved = navalServices(snapshot, owner, options).reserved;
  for (const task of Object.values(naval.conquests)) {
    if (task.abandonedTick !== undefined || task.stage !== 'escort') continue;
    const mine = snapshot.resources.find(mine => mine.id === task.mineId)!;
    if (own.some(unit => unit.kind === 'worker' && !unit.deck && sameGround(snapshot.map, unit, mine))
      || Object.values(ferries).some(mission => mission.targetId === mine.id && mission.purpose === 'settle' && mission.phase !== 'return')) continue;
    const boat = own.find(ship => isTransportKind(ship.kind) && !reserved.has(ship.id) && naval.outfit?.shipId !== ship.id
      && !shipNeedsRepair(snapshot, ship) && !shipPassengers(snapshot.units, ship).length
      && !own.some(unit => unit.order.type === 'board' && unit.order.transportId === ship.id)
      && (!ferries[ship.id] || ferries[ship.id]!.purpose === 'reinforce' && ferries[ship.id]!.phase === 'loading' && !ferries[ship.id]!.crewIds.length)
      && (naval.ferryRetryUntil?.[ship.id] ?? 0) <= snapshot.tick && ferryTargetAvailable(naval, ship.id, mine.id)
      && sameGround(snapshot.map, ship, task.landing, 'sea'));
    const from = boat && coastOnWater(snapshot, home, boat);
    if (!boat || !from || outgunned(snapshot, owner, options, task.landing, own)) {
      recordExecutorReason(options, { executor: 'island.engineers', outcome: 'blocked',
        reason: !boat ? 'no-eligible-engineer-transport' : !from ? 'engineer-load-coast-unavailable' : 'engineer-landing-water-outgunned',
        taskId: `island:${task.mineId}:${task.sinceTick}`, targetIds: [task.mineId] });
      continue;
    }
    ferries[boat.id] = { purpose: 'settle', targetId: mine.id, from, to: { ...task.landing },
      phase: 'loading', crewIds: [], sinceTick: snapshot.tick };
    task.reason = 'engineers-dispatched';
  }
}

/** A named clearing deficit recruits each available batch, independently of
 * the six-person threshold for an otherwise optional front-line ferry. */
export function conquestReinforcementCrew(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext,
  candidates: readonly Unit[], boat: Unit) {
  const mission = options.memory.naval?.ferries?.[boat.id];
  const task = mission?.reinforcementTaskId && options.memory.naval?.conquests?.[mission.reinforcementTaskId];
  if (!task || !mission) return [];
  const mine = snapshot.resources.find(mine => mine.id === task.mineId);
  const camp = mine && neutralCamps(snapshot).find(camp => distance(camp.center, mine) <= EXPANSION_GUARD_RANGE);
  if (!camp) return reinforcementCrew(snapshot, owner, options, candidates, mission.to);
  const present = conquestCrew(snapshot, owner, options, task).filter(unit => !isBacklineKind(unit)
    && unit.attackDamage > 0 && unit.hp >= unit.maxHp * V7_WOUNDED_SHARE);
  const inbound = snapshot.units.filter(unit => unit.owner === owner && unit.deck && unit.kind !== 'worker'
    && options.memory.naval?.ferries?.[unit.deck.shipId]?.reinforcementTaskId === task.mineId);
  const crew = reinforcementCrew(snapshot, owner, options, candidates, mission.to)
    .filter(unit => !isBacklineKind(unit) && unit.attackDamage > 0);
  const selected: Unit[] = [];
  for (const unit of crew) {
    if (creepForce([...present, ...inbound, ...selected], camp) >= forceFor(camp)) break;
    selected.push(unit);
  }
  return selected;
}

/** A safe beachhead can accumulate its camp party over several crossings. */
export function planConquestReinforcements(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const naval = options.memory.naval;
  if (!naval?.conquests) return;
  const own = snapshot.units.filter(unit => unit.owner === owner && unit.hp > 0);
  const ferries = naval.ferries ??= {}, reserved = navalServices(snapshot, owner, options).reserved;
  const camps = neutralCamps(snapshot);
  for (const mission of Object.values(ferries)) {
    const task = mission.reinforcementTaskId ? naval.conquests[mission.reinforcementTaskId] : undefined;
    const mine = task && snapshot.resources.find(mine => mine.id === task.mineId && mine.amount > 0);
    // The special trigger pays only a live clearing deficit. Once cleared,
    // an empty return follows the ordinary surplus-army dispatch threshold.
    if (mission.reinforcementTaskId && (!mine || task?.stage === 'complete' || task?.abandonedTick !== undefined
      || !camps.some(camp => distance(camp.center, mine) <= EXPANSION_GUARD_RANGE))) delete mission.reinforcementTaskId;
  }
  for (const task of Object.values(naval.conquests)) {
    if (task.stage === 'complete' || task.stage === 'build') continue;
    const mine = snapshot.resources.find(mine => mine.id === task.mineId && mine.amount > 0);
    if (!mine || !camps.some(camp => distance(camp.center, mine) <= EXPANSION_GUARD_RANGE)
      || mineClaimedByAlly(snapshot, owner, mine, options)
      || Object.values(ferries).some(mission => mission.reinforcementTaskId === mine.id)) continue;
    const boats = own.filter(ship => isTransportKind(ship.kind) && !reserved.has(ship.id)
      && naval.outfit?.shipId !== ship.id && !shipNeedsRepair(snapshot, ship)
      && !shipPassengers(snapshot.units, ship).length
      && !own.some(unit => unit.order.type === 'board' && unit.order.transportId === ship.id)
      && (!ferries[ship.id] || ferries[ship.id]!.phase === 'return')
      && (naval.ferryRetryUntil?.[ship.id] ?? 0) <= snapshot.tick
      && sameGround(snapshot.map, ship, task.landing, 'sea'));
    if (!boats.length) recordExecutorReason(options, { executor: 'island.reinforcements', outcome: 'candidate-rejected', reason: 'no-eligible-reinforcement-transport',
      taskId: `island:${task.mineId}:${task.sinceTick}`, targetIds: [task.mineId] });
    for (const boat of boats) {
      const crew = reinforcementCrew(snapshot, owner, options, own, task.landing)
        .filter(unit => !isBacklineKind(unit) && unit.attackDamage > 0);
      const from = crew[0] && coastOnWater(snapshot, crew[0], boat);
      if (!from) {
        recordExecutorReason(options, { executor: 'island.reinforcements', outcome: 'blocked', reason: crew.length ? 'reinforcement-load-coast-unavailable' : 'no-eligible-reinforcement-crew',
          taskId: `island:${task.mineId}:${task.sinceTick}`, targetIds: [task.mineId, boat.id] });
        continue;
      }
      if (!landingSafe(snapshot, owner, options, boat, task.landing)) {
        recordExecutorReason(options, { executor: 'island.reinforcements', outcome: 'blocked', reason: 'reinforcement-landing-defense',
          taskId: `island:${task.mineId}:${task.sinceTick}`, targetIds: [task.mineId, boat.id] });
        continue;
      }
      if (outgunned(snapshot, owner, options, task.landing, own)) {
        recordExecutorReason(options, { executor: 'island.reinforcements', outcome: 'blocked', reason: 'reinforcement-landing-water-outgunned',
          taskId: `island:${task.mineId}:${task.sinceTick}`, targetIds: [task.mineId, boat.id] });
        continue;
      }
      // A restored save may retain failures from checking the inland mine.
      // Reconsider that gate only once the actual beachhead is safe again.
      const failure = naval.ferryFailures?.[boat.id]?.[mine.id];
      if (failure?.reason === 'landing-defense') delete naval.ferryFailures![boat.id]![mine.id];
      if (!ferryTargetAvailable(naval, boat.id, mine.id)) {
        recordExecutorReason(options, { executor: 'island.reinforcements', outcome: 'blocked', reason: 'target-retries-exhausted',
          taskId: `island:${task.mineId}:${task.sinceTick}`, targetIds: [task.mineId, boat.id] });
        continue;
      }
      const previous = ferries[boat.id];
      ferries[boat.id] = { purpose: 'reinforce', reinforcementTaskId: mine.id, targetId: mine.id,
        from, to: { ...task.landing }, phase: 'loading', crewIds: [], sinceTick: snapshot.tick,
        deliveries: [], returnTrips: 0 };
      if (!conquestReinforcementCrew(snapshot, owner, options, own, boat).length) {
        recordExecutorReason(options, { executor: 'island.reinforcements', outcome: 'blocked', reason: 'no-additional-clearing-payload',
          taskId: `island:${task.mineId}:${task.sinceTick}`, targetIds: [task.mineId, boat.id] });
        if (previous) ferries[boat.id] = previous; else delete ferries[boat.id];
        continue;
      }
      delete task.abandonedTick;
      task.reason = 'reinforcing-beachhead';
      break;
    }
  }
}

/** Only unclaimed land fighters join this screen; mounted work and mine defense keep ownership. */
function conquestCrew(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, task: NavalConquestMemory) {
  const mine = snapshot.resources.find(mine => mine.id === task.mineId)!;
  const mounted = new Set(options.memory.mounted?.flatMap(job => job.unitIds));
  return snapshot.units.filter(unit => unit.owner === owner && permanentLand(unit) && unit.kind !== 'worker'
    && sameGround(snapshot.map, unit, mine) && !mounted.has(unit.id)
    && !isDefenseTaskClaim(activeUnitClaim(snapshot, owner, unit, options)));
}

export function islandConquestCommands(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  prepareIslandConquests(snapshot, owner, options);
  const commands: GameCommand[] = [], unitIds = new Set<string>();
  for (const task of Object.values(options.memory.naval?.conquests ?? {})) {
    if (task.abandonedTick !== undefined || task.stage === 'complete' || task.stage === 'build') continue;
    const crew = conquestCrew(snapshot, owner, options, task);
    if (!crew.length) {
      const ids = task.combat?.creep?.group ?? [];
      const reason = ids.length ? unavailableClearingReason(snapshot, owner, ids, options) : 'no-conquest-screen-units';
      task.reason = `blocked:${reason}`;
      recordExecutorReason(options, { executor: 'island.screen', outcome: 'blocked', reason,
        taskId: `island:${task.mineId}:${task.sinceTick}`, targetIds: [task.mineId], unitIds: ids });
      continue;
    }
    const anchor = walkableGoal(snapshot.map, task.landing.x, task.landing.y);
    const intel = readV6IntelAt(snapshot, owner, options, anchor), shared = v6Memory(options);
    const state = { ...shared, ...task.combat };
    delete state.general;
    if (!task.combat?.creep) delete state.creep;
    if (!task.combat?.creepRetry) delete state.creepRetry;
    const mission = { ...options, executorTaskId: `island:${task.mineId}:${task.sinceTick}`, memory: { ...options.memory, v6: state } };
    commands.push(...planMiningScreen(snapshot, owner, mission, intel, task,
      crew.filter(unit => !isBacklineKind(unit) && unit.attackDamage > 0)));
    task.combat = { ...(state.creep ? { creep: state.creep } : {}), ...(state.creepRetry ? { creepRetry: state.creepRetry } : {}) };
    for (const unit of crew) unitIds.add(unit.id);
  }
  return { commands, unitIds };
}
