import { BUILDING_DEFS } from '../../shared/catalog';
import { GOLD_MINE_RULES } from '../../shared/mining';
import type { GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { walkableGoal } from '../../shared/terrain';
import { groundSteeringRoute, routeClearsDisks, routePrefix } from '../../shared/route-selection';
import { resolveAiCommandIntent } from '../policy/commands';
import { activeMiningBaseCount } from '../policy/expansion-model';
import { groundThreatWithin } from '../policy/ground-threat';
import { averagePoint, distance, withinRangeOf } from '../policy/spatial';
import type { AiPolicyContext } from '../policy/types';
import { availableV6Army, V7_WOUNDED_SHARE } from '../policy/v6/general';
import type { V6Intel } from '../policy/v6/intel';
import { isBacklineKind } from '../policy/v6/backline';
import { recordPlay, v6Memory } from '../policy/v6/memory';
import { v6Doctrine } from '../policy/v6/select';
import { strengthOf } from '../policy/v6/strength';
import { activeCamp, campContested, continueV7Creep, creepForce, forceFor, neutralCamps, unavailableClearingReason, CREEP_ASSEMBLED_RANGE, V7_GATHERED_RANGE, CREEP_ROUTE_CLEARANCE, EXPANSION_GUARD_RANGE } from '../policy/v7/creep';
import { bootstrapExpansionMine } from './expansion-target';
import { assessBootstrapCamp, bootstrapCampApproach, campRecruitRoadClear, startBootstrapCamp } from './camp-geometry';
import { recordExecutorReason } from '../executor-reasons';
import { miningJobDefenseTarget } from './mining-job-defense';
import { mineClaimedByAlly } from '../policy/mine-claims';
import { miningRallyAssignment } from './mining-rally';
import { activeUnitClaim, clearUnitClaim, forgetExpansionMember, isMineRallyClaim, recordUnitTaskClaim, setUnitClaim } from '../policy/claims';
import type { AiPolicyMemory, MiningMissionMemory } from '../memory';
import { expansionGarrisonReady } from './expansion-garrison';
import { strategyLeaseAllows } from '../strategy/control';
import { landExpansionActor } from '../strategy/incumbent-actors';

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
    if (!strategyLeaseAllows(memory, id, landExpansionActor(task))) continue;
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
  if (task) delete task.reason;
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
      task.reason = 'saving-hall-capital';
      recordExecutorReason(options, { executor: 'expansion.prepare', outcome: 'blocked', reason: 'insufficient-hall-capital',
        taskId: `expansion:${task.mineId}:${task.sinceTick}`, targetIds: [task.mineId] });
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
    task.reason = !hall.complete ? 'building-hall' : ready ? 'garrison-established' : 'await-garrison';
    if (hall.complete && !ready) return task;
  }
  if (!task || task.stage === 'complete' || !mine || hall && hall.owner !== owner || mineClaimedByAlly(snapshot, owner, mine, options)) {
    if (task && task.stage !== 'complete') recordExecutorReason(options, { executor: 'expansion.prepare', outcome: 'abandoned',
      reason: !mine ? snapshot.resources.some(resource => resource.id === task!.mineId) ? 'mine-exhausted' : 'mine-missing'
        : hall && hall.owner !== owner ? 'mine-occupied' : 'ally-mine-claim',
      taskId: `expansion:${task.mineId}:${task.sinceTick}`, targetIds: [task.mineId] });
    const { strategy } = v6Doctrine(snapshot, owner, options);
    const phase = strategy.phases[Math.min(v6.phase ?? 0, strategy.phases.length - 1)];
    const wanted = Math.max(0, ...(phase?.wants ?? []).map(want => 'bases' in want ? want.bases : 0));
    if (wanted <= activeMiningBaseCount(snapshot, owner)) return undefined;
    const next = bootstrapExpansionMine(snapshot, owner, intel, options);
    if (!next) {
      recordExecutorReason(options, { executor: 'expansion.prepare', outcome: 'blocked', reason: 'no-eligible-expansion-target' });
      return undefined;
    }
    for (const id of expansionMissionUnitIds(memory)) forgetExpansionMember(memory, id);
    task = memory.landExpansion = { mineId: next.id, sinceTick: snapshot.tick, stage: 'assemble', interruptions: [] };
    // A purchasing visit is optional. Recall the opening courier to the expansion screen; ferries and medical care
    // keep their existing ownership. Claims below prevent another shopping trip from immediately replacing this one.
    const courier = memory.mercenaryCourier && snapshot.units.find(unit => unit.id === memory.mercenaryCourier!.unitId);
    if (courier && !defending.has(courier.id) && !courier.deck && courier.hp === courier.maxHp && courier.order.type !== 'board'
      && strategyLeaseAllows(memory, courier.id, landExpansionActor(task))) {
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
    task.reason = `paused:${reason}`;
    recordExecutorReason(options, { executor: 'expansion.prepare', outcome: 'paused', reason,
      taskId: `expansion:${task.mineId}:${task.sinceTick}`, targetIds: [task.mineId] });
    if (!task.paused) {
      task.interruptions.push({ tick: snapshot.tick, reason,
        ...((homeThreat ?? mineThreat) ? { targetId: (homeThreat ?? mineThreat)!.id } : {}) });
      recordPlay(v6, `expansion:interrupted:${reason}`);
    }
    task.pausedAt ??= snapshot.tick;
    task.paused = true;
    for (const id of expansionMissionUnitIds(memory)) if (memory.unitClaims[id]?.kind === 'expansion') clearUnitClaim(memory, id);
  } else {
    if (task.pausedAt !== undefined && task.combat?.creep) task.combat.creep.since += snapshot.tick - task.pausedAt;
    delete task.pausedAt;
    delete task.paused;
    const actor = landExpansionActor(task);
    const alive = new Set(snapshot.units.filter(unit => unit.owner === owner && !defending.has(unit.id)
      && !unit.deck && unit.order.type !== 'board' && strategyLeaseAllows(memory, unit.id, actor)).map(unit => unit.id));
    const retained = expansionMissionUnitIds(memory);
    for (const id of retained) if (!alive.has(id)) forgetExpansionMember(memory, id);
    const assault = new Set(memory.landAttack?.general.group);
    const pool = availableV6Army(snapshot, { ...options, strategyActor: actor }, intel)
      .filter(unit => !defending.has(unit.id) && !isBacklineKind(unit) && unit.attackDamage > 0
        && (!assault.has(unit.id) || retained.includes(unit.id) || activeMiningBaseCount(snapshot, owner) === 0));
    const members = selectExpansionScreen(snapshot, options, pool, retained.filter(id => alive.has(id)), intel);
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
export function selectExpansionScreen(snapshot: GameSnapshot, options: AiPolicyContext, pool: Unit[], retained: string[], intel: V6Intel) {
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
    // Rate each assembled cohort once, not on both sides of every sort comparison.
    // Keep the first cohort on ties, as the stable sort did.
    const assembled = pool.map(nearby).map(units => ({ units, force: creepForce(units, camp) }))
      .reduce((best, candidate) => candidate.force > best.force ? candidate : best);
    if (assembled.force >= forceFor(camp)) front = [...assembled.units].sort(order);
  }
  // Commit a clearing party through the entire camp. Falling creep HP must not
  // immediately release its fighters; those units finish the remaining battle.
  const selected = camp && task.combat?.creep
    ? snapshot.units.filter(unit => retained.includes(unit.id)) : [];
  for (const unit of front) {
    // continueV7Creep sends these patients back to staging instead of fighting.
    // Their rating and free-volley DPS cannot fund the minimum clearing party.
    const fighting = selected.filter(unit => pool.includes(unit) && unit.hp >= unit.maxHp * V7_WOUNDED_SHARE);
    if (camp ? creepForce(fighting, camp) >= forceFor(camp)
      && !campContested(intel, camp.center, selected)
      && !campContested(intel, averagePoint(selected), selected) : selected.length >= 3) break;
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
  const mission = { ...options, executorTaskId: `expansion:${task.mineId}:${task.sinceTick}`, memory: { ...options.memory, v6: state } };
  const contestedBefore = shared.plays['creep:enemy'] ?? 0;
  const commands = planExpansionScreen(snapshot, owner, mission, intel);
  if ((shared.plays['creep:enemy'] ?? 0) > contestedBefore) {
    task.interruptions.push({ tick: snapshot.tick, reason: 'camp-threat' });
    recordPlay(shared, 'expansion:interrupted:camp-threat');
  }
  task.combat = { ...(state.creep ? { creep: state.creep } : {}),
    ...(state.creepRetry ? { creepRetry: state.creepRetry } : {}) };
  return commands;
}

function planExpansionScreen(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, intel: V6Intel): GameCommand[] {
  const task = options.memory.landExpansion!;
  const members = new Set(expansionMissionUnitIds(options.memory));
  const front = availableV6Army(snapshot, options, intel).filter(unit => members.has(unit.id)).filter(unit => {
    const claim = activeUnitClaim(snapshot, owner, unit, options);
    return !isMineRallyClaim(claim) && claim?.kind !== 'mineLeash' && claim?.kind !== 'expansionGarrison' && claim?.kind !== 'harassSquad';
  }).filter(unit => !isBacklineKind(unit) && unit.attackDamage > 0);
  return planMiningScreen(snapshot, owner, options, intel, task, front);
}

/** Land and overseas mining missions share their clearing, staging and escort behavior. */
export function planMiningScreen(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, intel: V6Intel,
  task: MiningMissionMemory, front: Unit[]): GameCommand[] {
  const mine = snapshot.resources.find(mine => mine.id === task.mineId)!, memory = v6Memory(options), home = intel.home;
  if (!front.length) {
    const ids = task.combat?.creep?.group ?? [];
    const reason = ids.length ? unavailableClearingReason(snapshot, owner, ids, options) : 'no-mining-screen-units';
    task.reason = `blocked:${reason}`;
    recordExecutorReason(options, { executor: 'mining.screen', outcome: 'blocked', reason, targetIds: [task.mineId], unitIds: ids });
    return [];
  }
  const camps = neutralCamps(snapshot), guard = camps.find(camp => distance(camp.center, mine) <= EXPANSION_GUARD_RANGE);
  if (guard) {
    let blockedReason: string | undefined;
    const active = memory.creep && activeCamp(memory.creep, camps);
    if (task.roadCamp && (!active || distance(active.center, task.roadCamp) > 300)) delete task.roadCamp;
    if (memory.creep && active !== guard && !task.roadCamp) {
      if (active) recordExecutorReason(options, { executor: 'mining.screen', outcome: 'abandoned', reason: 'clearing-target-superseded',
        targetIds: active.creeps.map(unit => unit.id), unitIds: [...memory.creep.group] });
      delete memory.creep;
    }
    if (!memory.creep) {
      const fighting = front.filter(unit => unit.hp >= unit.maxHp * V7_WOUNDED_SHARE);
      const assessment = assessBootstrapCamp(home, snapshot, fighting, camps, [guard], options, mine);
      let choice = assessment.choice;
      blockedReason = assessment.reason;
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
          choice = assessBootstrapCamp(home, snapshot, fighting, camps, [blocker], options, blocker.center).choice;
          if (choice) { task.roadCamp = { ...blocker.center }; recordPlay(memory, 'expansion:clearRoad'); }
        }
      }
      if (choice) startBootstrapCamp(snapshot, front, choice, options);
    }
    const state = memory.creep, target = activeCamp(state, camps);
    const recruits = state ? front.filter(unit => !state.group.includes(unit.id)
      && unit.hp >= unit.maxHp * V7_WOUNDED_SHARE && !['cast', 'charge'].includes(unit.order.type)) : [];
    const arrived = state ? recruits.filter(unit => distance(unit, state.staging) <= V7_GATHERED_RANGE) : [];
    state?.group.push(...arrived.map(unit => unit.id));
    const under = continueV7Creep(snapshot, owner, front, camps, intel, options, reason => { blockedReason = reason; });
    if (under) {
      const walking = state && target ? recruits.filter(unit => !arrived.includes(unit)
        && campRecruitRoadClear(snapshot, unit, state.staging, camps, target)
        && !(unit.order.type === 'move' && distance(unit.order, state.staging) < V7_GATHERED_RANGE)) : [];
      if (walking.length) under.commands.push(resolveAiCommandIntent(snapshot, owner,
        { type: 'move', unitIds: walking.map(unit => unit.id), ...state!.staging }, options));
      task.stage = 'clear';
      task.reason = state?.stage === 'gather' ? 'gathering-clearing-party' : 'clearing-camp';
      memory.general = { mode: 'creep', target: under.point };
      return under.commands;
    }
    task.stage = 'assemble';
    task.reason = blockedReason === 'insufficient-clearing-force' ? 'await-clearing-force' : `blocked:${blockedReason ?? 'clearing-party-unavailable'}`;
  } else {
    const active = activeCamp(memory.creep, camps);
    if (active) recordExecutorReason(options, { executor: 'mining.screen', outcome: 'abandoned', reason: 'clearing-prerequisite-no-longer-needed',
      targetIds: active.creeps.map(unit => unit.id), unitIds: [...memory.creep!.group] });
    delete memory.creep; delete task.roadCamp;
    if (task.stage !== 'build') task.stage = 'escort';
    task.reason ??= task.stage === 'build' ? 'building-hall' : 'escorting-construction-site';
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
