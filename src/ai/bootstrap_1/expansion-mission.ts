import { BUILDING_DEFS } from '../../shared/catalog';
import { GOLD_MINE_RULES } from '../../shared/mining';
import type { GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { walkableGoal } from '../../shared/terrain';
import { groundSteeringRoute, routeClearsDisks, routePrefix } from '../../shared/route-selection';
import { resolveAiCommandIntent } from '../policy/commands';
import { activeMiningBaseCount } from '../policy/expansion-model';
import { groundThreatWithin } from '../policy/ground-threat';
import { distance, withinRangeOf } from '../policy/spatial';
import type { AiPolicyContext } from '../policy/types';
import { availableV6Army } from '../policy/v6/general';
import type { V6Intel } from '../policy/v6/intel';
import { isBacklineKind } from '../policy/v6/backline';
import { recordPlay, v6Memory } from '../policy/v6/memory';
import { v6Doctrine } from '../policy/v6/select';
import { strengthOf } from '../policy/v6/strength';
import { activeCamp, campContested, continueV7Creep, creepForce, forceFor, neutralCamps, CREEP_ASSEMBLED_RANGE, CREEP_ROUTE_CLEARANCE, EXPANSION_GUARD_RANGE } from '../policy/v7/creep';
import { bootstrapExpansionMine } from './expansion-target';
import { bootstrapCampApproach, chooseBootstrapCamp, startBootstrapCamp } from './camp-geometry';
import { miningJobDefenseTarget } from './mining-job-defense';
import { mineClaimedByAlly } from '../policy/mine-claims';
import { miningRallyAssignment } from './mining-rally';
import { activeUnitClaim, clearUnitClaim, forgetExpansionMember, isMineRallyClaim, recordUnitTaskClaim, setUnitClaim } from '../policy/claims';
import type { AiPolicyMemory } from '../memory';
import { expansionGarrisonReady } from './expansion-garrison';

export function expansionMissionUnitIds(memory: AiPolicyMemory) {
  const mineId = memory.landExpansion?.mineId;
  return mineId === undefined ? [] : Object.entries(memory.unitClaims)
    .filter(([, claim]) => claim.expansionMineId === mineId).map(([id]) => id);
}

/** Import old replay/debug memory once; there is no second live membership list. */
export function migrateExpansionClaims(snapshot: GameSnapshot, memory: AiPolicyMemory) {
  const task = memory.landExpansion as (AiPolicyMemory['landExpansion'] & { unitIds?: string[] });
  if (!task?.unitIds) return;
  const mine = snapshot.resources.find(mine => mine.id === task.mineId);
  for (const id of task.unitIds) {
    const claim = memory.unitClaims[id];
    if (claim) claim.expansionMineId = task.mineId;
    else recordUnitTaskClaim(snapshot, memory, id, { kind: 'expansionMission', targetId: task.mineId,
      x: mine?.x ?? 0, y: mine?.y ?? 0, expansionMineId: task.mineId });
  }
  delete task.unitIds;
}

/** A room army owns one mining objective through clearing, escort and construction. */
export function prepareExpansionMission(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, intel: V6Intel) {
  const memory = options.memory, v6 = v6Memory(options);
  migrateExpansionClaims(snapshot, memory);
  let task = memory.landExpansion;
  // Arrived defenders return to the general's combat view, but still belong to the mine defense.
  // Neither retaining yesterday's escorts nor recruiting today may take them from that task.
  const defending = new Set(snapshot.units.filter(unit => {
    const claim = activeUnitClaim(snapshot, owner, unit, options);
    return isMineRallyClaim(claim) || claim?.kind === 'mineLeash' || claim?.kind === 'expansionGarrison' || claim?.kind === 'harassSquad';
  }).map(unit => unit.id));
  for (const id of defending) forgetExpansionMember(memory, id);
  if (activeMiningBaseCount(snapshot, owner) === 0
    && snapshot.players[owner]!.gold < BUILDING_DEFS.townHall.cost
    && !snapshot.buildings.some(building => building.owner === owner && building.kind === 'townHall' && !building.complete)
    && !snapshot.units.some(unit => unit.owner === owner && unit.order.type === 'build' && unit.order.buildingKind === 'townHall')) {
    if (task) {
      if (task.stage !== 'fund') recordPlay(v6, 'expansion:needsFunds');
      task.stage = 'fund';
      // No expedition can depart without capital. Release ownership too, so the mine-defense
      // leash does not mistake these now-free soldiers for an active construction screen.
      for (const id of expansionMissionUnitIds(memory)) {
        if (memory.unitClaims[id]?.kind === 'expansion') clearUnitClaim(memory, id);
        forgetExpansionMember(memory, id);
      }
    }
    return undefined;
  }
  const mineId = task?.mineId;
  const mine = mineId === undefined ? undefined : snapshot.resources.find(mine => mine.id === mineId && mine.amount > 0);
  const hall = mine && snapshot.buildings.find(building => building.kind === 'townHall'
    && distance(building, mine) < GOLD_MINE_RULES.baseRange);
  if (task && hall?.owner === owner) {
    task.stage = hall.complete ? 'complete' : 'build';
    // Prepare the post during construction, while the expedition already covers this mine.
    const ready = expansionGarrisonReady(snapshot, owner, options, task.mineId);
    if (hall.complete && !ready) return task;
  }
  if (!task || task.stage === 'complete' || !mine || hall && hall.owner !== owner || mineClaimedByAlly(snapshot, owner, mine, options)) {
    const { strategy } = v6Doctrine(snapshot, owner, options);
    const phase = strategy.phases[Math.min(v6.phase ?? 0, strategy.phases.length - 1)];
    const wanted = Math.max(0, ...(phase?.wants ?? []).map(want => 'bases' in want ? want.bases : 0));
    if (wanted <= activeMiningBaseCount(snapshot, owner)) return undefined;
    const next = bootstrapExpansionMine(snapshot, owner, intel, options);
    if (!next) return undefined;
    for (const id of expansionMissionUnitIds(memory)) forgetExpansionMember(memory, id);
    task = memory.landExpansion = { mineId: next.id, sinceTick: snapshot.tick, stage: 'assemble', interruptions: [] };
    // A purchasing visit is optional. Recall the opening courier to the expansion screen; ferries and medical care
    // keep their existing ownership. Claims below prevent another shopping trip from immediately replacing this one.
    const courier = memory.mercenaryCourier && snapshot.units.find(unit => unit.id === memory.mercenaryCourier!.unitId);
    if (courier && !defending.has(courier.id) && !courier.deck && courier.hp === courier.maxHp && courier.order.type !== 'board') {
      delete memory.mercenaryCourier;
      setUnitClaim(memory, courier.id, { kind: 'expansion', targetId: next.id, x: next.x, y: next.y,
        sinceTick: snapshot.tick, expiresTick: snapshot.tick + 30, expansionMineId: next.id });
    }
  }
  const target = snapshot.resources.find(mine => mine.id === task.mineId)!;
  // Use the general's uncovered intrusion, including a threatened mine-mouth tower. A second,
  // narrower hall-distance check could send the army away one think before the rally starts.
  const homeThreat = intel.intrusion?.attackers[0];
  const atMine = intel.enemies.flatMap(enemy => enemy.army).filter(unit => groundThreatWithin(snapshot, unit, target, 800));
  const mineThreat = strengthOf(atMine) > intel.power * .5 ? atMine[0] : undefined;
  // A rally remains a real defense assignment between intrusion samples and while its last
  // reinforcements arrive. Only the rally selector may release it after the mine is safe.
  const rally = miningRallyAssignment(snapshot, owner, options, intel);
  const miningThreat = rally ?? miningJobDefenseTarget(snapshot, owner, intel, options);
  const reason = homeThreat ? 'home-threat' : miningThreat ? 'mining-threat' : mineThreat ? 'mine-threat' : undefined;
  if (reason) {
    if (!task.paused) {
      task.interruptions.push({ tick: snapshot.tick, reason,
        ...((homeThreat ?? mineThreat) ? { targetId: (homeThreat ?? mineThreat)!.id } : {}) });
      recordPlay(v6, `expansion:interrupted:${reason}`);
    }
    task.paused = true;
    for (const id of expansionMissionUnitIds(memory)) if (memory.unitClaims[id]?.kind === 'expansion') clearUnitClaim(memory, id);
  } else {
    delete task.paused;
    const alive = new Set(snapshot.units.filter(unit => unit.owner === owner && !defending.has(unit.id)
      && !unit.deck && unit.order.type !== 'board').map(unit => unit.id));
    const retained = expansionMissionUnitIds(memory);
    for (const id of retained) if (!alive.has(id)) forgetExpansionMember(memory, id);
    const pool = availableV6Army(snapshot, options, intel)
      .filter(unit => !defending.has(unit.id) && !isBacklineKind(unit) && unit.attackDamage > 0);
    const members = selectExpansionScreen(snapshot, options, pool, retained.filter(id => alive.has(id)));
    for (const id of retained) if (!members.includes(id)) {
      if (memory.unitClaims[id]?.kind === 'expansion') clearUnitClaim(memory, id);
      forgetExpansionMember(memory, id);
    }
    // Only the camp's required force, or the builder's small escort, owns this task.
    for (const id of members) setUnitClaim(memory, id, { kind: 'expansion', targetId: target.id,
      x: target.x, y: target.y, sinceTick: snapshot.tick, expiresTick: snapshot.tick + 30, expansionMineId: target.id });
  }
  return task;
}

/** Retain a sufficient camp party; after clearing, only three builder escorts remain. */
export function selectExpansionScreen(snapshot: GameSnapshot, options: AiPolicyContext, pool: Unit[], retained: string[]) {
  const task = options.memory.landExpansion!;
  const mine = snapshot.resources.find(mine => mine.id === task.mineId)!;
  const camps = neutralCamps(snapshot);
  const camp = activeCamp(task.combat?.creep, camps)
    ?? camps.find(camp => distance(camp.center, mine) <= EXPANSION_GUARD_RANGE);
  const assault = new Set(options.memory.landAttack?.general.group);
  const order = (a: Unit, b: Unit) => Number(a.hp < a.maxHp * .35) - Number(b.hp < b.maxHp * .35)
    || Number(!retained.includes(a.id)) - Number(!retained.includes(b.id))
    || Number(assault.has(a.id)) - Number(assault.has(b.id))
    || distance(a, camp?.center ?? mine) - distance(b, camp?.center ?? mine);
  let front = [...pool].sort(order);
  if (camp && !task.combat?.creep && pool.length) {
    const nearby = withinRangeOf(pool, CREEP_ASSEMBLED_RANGE);
    const assembled = pool.map(nearby).sort((a, b) => creepForce(b, camp) - creepForce(a, camp))[0]!;
    if (creepForce(assembled, camp) >= forceFor(camp)) front = [...assembled].sort(order);
  }
  // Commit a clearing party through the entire camp. Falling creep HP must not
  // immediately release its fighters; those units finish the remaining battle.
  const selected = camp && task.combat?.creep
    ? snapshot.units.filter(unit => retained.includes(unit.id)) : [];
  for (const unit of front) {
    const fighting = selected.filter(unit => pool.includes(unit));
    if (camp ? creepForce(fighting, camp) >= forceFor(camp) : selected.length >= 3) break;
    if (!selected.includes(unit)) selected.push(unit);
  }
  return selected.map(unit => unit.id);
}

/** The expedition's camp state cannot overwrite a simultaneous main-army assault. */
export function expansionMissionCommands(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, intel: V6Intel): GameCommand[] | undefined {
  const task = prepareExpansionMission(snapshot, owner, options, intel);
  if (!task || task.paused || task.stage === 'complete') return undefined;
  const shared = v6Memory(options);
  shared.plays ??= {};
  const state = { ...shared };
  delete state.general; delete state.creep; delete state.creepRetry;
  Object.assign(state, task.combat);
  const mission = { ...options, memory: { ...options.memory, v6: state } };
  const commands = planExpansionScreen(snapshot, owner, mission, intel);
  task.combat = { ...(state.creep ? { creep: state.creep } : {}),
    ...(state.creepRetry ? { creepRetry: state.creepRetry } : {}) };
  return commands;
}

function planExpansionScreen(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, intel: V6Intel): GameCommand[] {
  const task = options.memory.landExpansion!;
  const mine = snapshot.resources.find(mine => mine.id === task.mineId)!, memory = v6Memory(options);
  const home = intel.home, members = new Set(expansionMissionUnitIds(options.memory));
  const front = availableV6Army(snapshot, options, intel).filter(unit => members.has(unit.id)).filter(unit => {
    const claim = activeUnitClaim(snapshot, owner, unit, options);
    return !isMineRallyClaim(claim) && claim?.kind !== 'mineLeash' && claim?.kind !== 'expansionGarrison' && claim?.kind !== 'harassSquad';
  }).filter(unit => !isBacklineKind(unit) && unit.attackDamage > 0);
  if (!front.length) return [];
  const camps = neutralCamps(snapshot), guard = camps.find(camp => distance(camp.center, mine) <= EXPANSION_GUARD_RANGE);
  if (guard) {
    const active = memory.creep && activeCamp(memory.creep, camps);
    if (task.roadCamp && (!active || distance(active.center, task.roadCamp) > 300)) delete task.roadCamp;
    if (memory.creep && active !== guard && !task.roadCamp) delete memory.creep;
    if (!memory.creep) {
      let choice = chooseBootstrapCamp(home, snapshot, front, camps, [guard], options, mine);
      if (!choice && Object.keys(options.memory.expansionGarrisons ?? {}).length > 0) {
        // A camp on the expedition's actual road is part of reaching this mine.
        // Keep the mine as the parent objective; do not wait forever merely
        // because the final guard's safe-approach check sees this earlier camp.
        const leader = [...front].sort((a, b) => distance(a, guard.center) - distance(b, guard.center))[0]!;
        const road = groundSteeringRoute(snapshot.map, leader, guard.center);
        const blockers = camps.filter(camp => camp !== guard).map(camp => ({ camp,
          at: road.findIndex((point, index) => index > 0 && !routeClearsDisks([road[index - 1]!, point],
            camp.creeps.map(creep => ({ x: creep.x, y: creep.y, radius: CREEP_ROUTE_CLEARANCE })))) }))
          .filter(item => item.at >= 0).sort((a, b) => a.at - b.at);
        const blocker = blockers[0]?.camp;
        if (blocker && !campContested(intel, blocker.center, front)) {
          choice = chooseBootstrapCamp(home, snapshot, front, camps, [blocker], options, blocker.center);
          if (choice) { task.roadCamp = { ...blocker.center }; recordPlay(memory, 'expansion:clearRoad'); }
        }
      }
      if (choice) startBootstrapCamp(snapshot, front, choice, options);
    }
    const under = continueV7Creep(snapshot, owner, front, camps, intel, options);
    if (under) {
      task.stage = 'clear';
      memory.general = { mode: 'creep', target: under.point };
      return under.commands;
    }
    task.stage = 'assemble';
  } else {
    delete memory.creep; delete task.roadCamp;
    if (task.stage !== 'build') task.stage = 'escort';
  }
  // Assemble on the camp's safe approach while recruits arrive. Once clear, stay with the mine.
  if (task.stage === 'assemble' && front.length >= 3 && !task.staging
    && snapshot.tick - (task.stagingCheckedTick ?? -300) >= 300) {
    task.stagingCheckedTick = snapshot.tick;
    const staging = bootstrapCampApproach(snapshot, home, front, guard!, home, camps)?.staging;
    if (staging) task.staging = staging;
  }
  const destination = task.stage === 'assemble' ? task.staging ?? home : mine;
  const point = walkableGoal(snapshot.map, destination.x, destination.y);
  memory.general = { mode: 'hold', target: point, holdingSince: task.sinceTick };
  const builder = task.stage === 'escort' ? snapshot.units.find(unit => unit.owner === owner && unit.order.type === 'build'
    && unit.order.buildingKind === 'townHall' && distance(unit.order, mine) < GOLD_MINE_RULES.baseRange) : undefined;
  const escorts = builder ? [...front].sort((a, b) => distance(a, builder) - distance(b, builder)).slice(0, 3) : [];
  const road = builder?.order.type === 'build' ? groundSteeringRoute(snapshot.map, builder, builder.order) : [];
  const escortPoint = builder ? routePrefix(builder, road, 220).at(-1) ?? builder : point;
  // A small escort follows the builder's actual steering road.
  return [{ units: front.filter(unit => !escorts.includes(unit)), point }, { units: escorts, point: escortPoint }]
    .flatMap(({ units, point }): GameCommand[] => {
      const moving = units.filter(unit => distance(unit, point) > 180
        && !((unit.order.type === 'attackMove' || unit.order.type === 'move') && distance(unit.order, point) < 100));
      return moving.length ? [resolveAiCommandIntent(snapshot, owner,
        { type: task.stage === 'assemble' ? 'move' : 'attackMove', unitIds: moving.map(unit => unit.id), x: point.x, y: point.y }, options)] : [];
    });
}

/** Idle surplus helps the expedition for this think; it remains free to attack on the next. */
export function assistExpansionMission(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, front: Unit[]): GameCommand[] {
  const task = options.memory.landExpansion, state = task?.combat?.creep;
  if (!task || task.paused || !state) return [];
  const camps = neutralCamps(snapshot), camp = activeCamp(state, camps);
  if (!camp) return [];
  const point = state.stage === 'gather' ? state.staging : camp.center;
  const disks = camps.filter(other => other !== camp).flatMap(other => other.creeps.map(unit =>
    ({ x: unit.x, y: unit.y, radius: CREEP_ROUTE_CLEARANCE })));
  const helping = front.filter(unit => !isBacklineKind(unit) && unit.attackDamage > 0 && unit.hp >= unit.maxHp * .35
    && routeClearsDisks(groundSteeringRoute(snapshot.map, unit, point), disks)
    && unit.order.type !== 'attack');
  return helping.length ? [resolveAiCommandIntent(snapshot, owner, { type: state.stage === 'gather' ? 'move' : 'attackMove',
    unitIds: helping.map(unit => unit.id), ...point }, options)] : [];
}
