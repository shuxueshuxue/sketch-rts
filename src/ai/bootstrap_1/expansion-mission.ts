import { BUILDING_DEFS } from '../../shared/catalog';
import { GOLD_MINE_RULES } from '../../shared/mining';
import type { GameCommand, GameSnapshot, PlayerId } from '../../shared/types';
import { walkableGoal } from '../../shared/terrain';
import { groundSteeringRoute, routePrefix } from '../../shared/route-selection';
import { resolveAiCommandIntent } from '../policy/commands';
import { activeMiningBaseCount } from '../policy/expansion-model';
import { groundThreatWithin } from '../policy/ground-threat';
import { distance } from '../policy/spatial';
import type { AiPolicyContext } from '../policy/types';
import { availableV6Army } from '../policy/v6/general';
import type { V6Intel } from '../policy/v6/intel';
import { isBacklineKind } from '../policy/v6/backline';
import { recordPlay, v6Memory } from '../policy/v6/memory';
import { v6Doctrine } from '../policy/v6/select';
import { strengthOf } from '../policy/v6/strength';
import { activeCamp, continueV7Creep, neutralCamps, EXPANSION_GUARD_RANGE } from '../policy/v7/creep';
import { bootstrapExpansionMine } from './expansion-target';
import { bootstrapCampApproach, chooseBootstrapCamp, startBootstrapCamp } from './camp-geometry';
import { miningJobDefenseTarget } from './mining-job-defense';
import { mineClaimedByAlly } from '../policy/mine-claims';
import { miningRallyAssignment } from './mining-rally';

/** A room army owns one mining objective through clearing, escort and construction. */
export function prepareExpansionMission(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, intel: V6Intel) {
  const memory = options.memory, v6 = v6Memory(options);
  let task = memory.landExpansion;
  // Arrived defenders return to the general's combat view, but still belong to the mine defense.
  // Neither retaining yesterday's escorts nor recruiting today may take them from that task.
  const defending = new Set(memory.miningDefense?.unitIds);
  if (task) task.unitIds = task.unitIds.filter(id => !defending.has(id));
  for (const id of defending) if (memory.unitClaims[id]?.kind === 'expansion') delete memory.unitClaims[id];
  if (activeMiningBaseCount(snapshot, owner) === 0
    && snapshot.players[owner]!.gold < BUILDING_DEFS.townHall.cost
    && !snapshot.buildings.some(building => building.owner === owner && building.kind === 'townHall' && !building.complete)
    && !snapshot.units.some(unit => unit.owner === owner && unit.order.type === 'build' && unit.order.buildingKind === 'townHall')) {
    if (task) {
      if (task.stage !== 'fund') recordPlay(v6, 'expansion:needsFunds');
      task.stage = 'fund';
    }
    return undefined;
  }
  const mineId = task?.mineId;
  const mine = mineId === undefined ? undefined : snapshot.resources.find(mine => mine.id === mineId && mine.amount > 0);
  const hall = mine && snapshot.buildings.find(building => building.kind === 'townHall'
    && distance(building, mine) < GOLD_MINE_RULES.baseRange);
  if (task && hall?.owner === owner) task.stage = hall.complete ? 'complete' : 'build';
  if (!task || task.stage === 'complete' || !mine || hall && hall.owner !== owner || mineClaimedByAlly(snapshot, owner, mine, options)) {
    const { strategy } = v6Doctrine(snapshot, owner, options);
    const phase = strategy.phases[Math.min(v6.phase ?? 0, strategy.phases.length - 1)];
    const wanted = Math.max(0, ...(phase?.wants ?? []).map(want => 'bases' in want ? want.bases : 0));
    if (wanted <= activeMiningBaseCount(snapshot, owner)) return undefined;
    const next = bootstrapExpansionMine(snapshot, owner, intel, options);
    if (!next) return undefined;
    task = memory.landExpansion = { mineId: next.id, sinceTick: snapshot.tick, stage: 'assemble', unitIds: [], interruptions: [] };
    // A purchasing visit is optional. Recall the opening courier to the expansion screen; ferries and medical care
    // keep their existing ownership. Claims below prevent another shopping trip from immediately replacing this one.
    const courier = memory.mercenaryCourier && snapshot.units.find(unit => unit.id === memory.mercenaryCourier!.unitId);
    if (courier && !defending.has(courier.id) && !courier.deck && courier.hp === courier.maxHp && courier.order.type !== 'board') {
      delete memory.mercenaryCourier;
      task.unitIds.push(courier.id);
      memory.unitClaims[courier.id] = { kind: 'expansion', targetId: next.id, x: next.x, y: next.y,
        sinceTick: snapshot.tick, expiresTick: snapshot.tick + 30 };
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
    for (const id of task.unitIds) if (memory.unitClaims[id]?.kind === 'expansion') delete memory.unitClaims[id];
  } else {
    delete task.paused;
    const alive = new Set(snapshot.units.filter(unit => unit.owner === owner && !defending.has(unit.id)
      && !unit.deck && unit.order.type !== 'board').map(unit => unit.id));
    task.unitIds = [...new Set([...task.unitIds.filter(id => alive.has(id)), ...availableV6Army(snapshot, options, intel)
      .filter(unit => !defending.has(unit.id) && !isBacklineKind(unit) && unit.attackDamage > 0).map(unit => unit.id)])];
    // Reuse the existing errand claim contract. New shop/mercenary trips cannot borrow the expansion's screen.
    for (const id of task.unitIds) memory.unitClaims[id] = { kind: 'expansion', targetId: target.id,
      x: target.x, y: target.y, sinceTick: snapshot.tick, expiresTick: snapshot.tick + 30 };
  }
  return task;
}

export function expansionMissionCommands(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, intel: V6Intel): GameCommand[] | undefined {
  const task = prepareExpansionMission(snapshot, owner, options, intel);
  if (!task || task.paused || task.stage === 'complete') return undefined;
  const mine = snapshot.resources.find(mine => mine.id === task.mineId)!, memory = v6Memory(options);
  const front = availableV6Army(snapshot, options, intel).filter(unit => !options.memory.miningDefense?.unitIds.includes(unit.id)
    && !isBacklineKind(unit) && unit.attackDamage > 0);
  if (!front.length) return [];
  const camps = neutralCamps(snapshot), guard = camps.find(camp => distance(camp.center, mine) <= EXPANSION_GUARD_RANGE);
  if (guard) {
    if (memory.creep && activeCamp(memory.creep, camps) !== guard) delete memory.creep;
    if (!memory.creep) {
      const choice = chooseBootstrapCamp(intel.home, snapshot, front, camps, [guard], options, mine);
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
    delete memory.creep;
    if (task.stage !== 'build') task.stage = 'escort';
  }
  // Assemble on the camp's safe approach while recruits arrive. Once clear, stay with the mine.
  if (task.stage === 'assemble' && front.length >= 3 && !task.staging
    && snapshot.tick - (task.stagingCheckedTick ?? -300) >= 300) {
    task.stagingCheckedTick = snapshot.tick;
    const staging = bootstrapCampApproach(snapshot, intel.home, front, guard!, intel.home, camps)?.staging;
    if (staging) task.staging = staging;
  }
  const destination = task.stage === 'assemble' ? task.staging ?? intel.home : mine;
  const point = walkableGoal(snapshot.map, destination.x, destination.y);
  memory.general = { mode: 'hold', target: point, holdingSince: task.sinceTick };
  const builder = task.stage === 'escort' ? snapshot.units.find(unit => unit.owner === owner && unit.order.type === 'build'
    && unit.order.buildingKind === 'townHall' && distance(unit.order, mine) < GOLD_MINE_RULES.baseRange) : undefined;
  const escorts = builder ? [...front].sort((a, b) => distance(a, builder) - distance(b, builder)).slice(0, 3) : [];
  const road = builder?.order.type === 'build' ? groundSteeringRoute(snapshot.map, builder, builder.order) : [];
  const escortPoint = builder ? routePrefix(builder, road, 220).at(-1) ?? builder : point;
  // A small escort follows the builder's actual steering road; the rest keep the cleared mine covered.
  return [{ units: front.filter(unit => !escorts.includes(unit)), point }, { units: escorts, point: escortPoint }]
    .flatMap(({ units, point }): GameCommand[] => {
      const moving = units.filter(unit => distance(unit, point) > 180
        && !((unit.order.type === 'attackMove' || unit.order.type === 'move') && distance(unit.order, point) < 100));
      return moving.length ? [resolveAiCommandIntent(snapshot, owner,
        { type: task.stage === 'assemble' ? 'move' : 'attackMove', unitIds: moving.map(unit => unit.id), x: point.x, y: point.y }, options)] : [];
    });
}
