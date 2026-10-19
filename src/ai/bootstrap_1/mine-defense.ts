import { harassSquadAssignment, harassSquadGuard, mountedHarassment, planHarassSquad, recordHarassSquadCommands } from './harass-squad';
import { mercenaryControlUnitIds } from './mercenary-control';
import { assistExpansionMission, expansionMissionCommands, expansionMissionUnitIds } from './expansion-mission';
import { attackRoadCampCommands, chooseRoomAttack, observeLandAttack, prepareLandAttack } from './attack-objective';
import { lootRecoveryUnitIds } from './loot-recovery';
import { shoppingUnitIds } from './shopping';
import { campRecruitRoadClear, chooseBootstrapCamp, startBootstrapCamp } from './camp-geometry';
import { routeAssaultCampCommands } from './assault-camp-roads';
import { armedFoes } from './safe-land-route';
import { postRecoveryAssignments, recoverBootstrapFront } from './front-recovery';
import { coveredDefenseTarget, holdCoveredPost } from './covered-defense';
import { miningJobDefenseTarget } from './mining-job-defense';
import { BUILDING_DEFS, UNIT_DEFS } from '../../shared/catalog';
import type { Building, GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { sameGround, walkingDistance } from '../../shared/terrain';
import { nearestByRoute, routeArrivals, routeWithinDistance } from '../../shared/route-selection';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { activeMiningBaseCount } from '../policy/expansion-model';
import { resolveAiCommandIntent } from '../policy/commands';
import { averagePoint, distance } from '../policy/spatial';
import { groundFrontThreat, groundRespondingPower, groundThreatWithin } from '../policy/ground-threat';
import { mobileCare } from './mobile-care';
import { buildings } from '../policy/snapshot';
import { isBacklineKind } from '../policy/v6/backline';
import { readIntrusion, readV6Intel, type V6Intel, type V6Intrusion } from '../policy/v6/intel';
import { bootstrapExpansionMine } from './expansion-target';
import { availableV6Army, planV6Army, retreatV6Front, V7_WOUNDED_SHARE, waitsForTowers } from '../policy/v6/general';
import { activeCamp, neutralCamps, V7_GATHERED_RANGE, V7_HOME_REACH } from '../policy/v7/creep';
import { DETACHMENT_MIN, planV6CloseoutArmy } from '../policy/v6/closeout';
import { strengthOf, TOWER_STRENGTH } from '../policy/v6/strength';
import { summonedMiningRaids } from './summoned-raids';
import { mountedFieldOwns } from './mounted-field';
import { planV8Charge } from '../policy/v8/charge';
import type { AiPolicyContext, AiScript } from '../policy/types';
import { anchoredMiningDefense, miningRallyAssignment, planMiningRally, recordMiningRallyCommands, recordMiningRallyAcceptedCommands, miningRallyOwns } from './mining-rally';
import { activeUnitClaim, isMineRallyClaim } from '../policy/claims';

import { expansionOwnsDefender, MINING_PURSUIT_RADIUS, miningLeashAssignment, miningLeashOwns, planMiningLeash, recordMiningLeashCommands, recordMiningLeashAcceptedCommands } from './mining-leash';

export { recordMiningGeneralCommands } from './mining-leash';

type Detachment = { hall: Building; attackers: Unit[]; crew: Unit[] };

function miningRaids(snapshot: GameSnapshot, intel: V6Intel) {
  const foes = intel.enemies.flatMap(enemy => enemy.army);
  const aimedAt = (unit: Unit, hall: Building) => unit.order.type === 'attack' && unit.order.targetId === hall.id
    || unit.order.type === 'attackMove' && distance(unit.order, hall) <= hall.radius + 80;
  return intel.ownHalls.filter(hall => snapshot.resources.some(mine => mine.amount > 0
    && distance(mine, hall) <= GOLD_MINE_RULES.baseRange)).map(hall => ({ hall,
    attackers: foes.filter(unit => sameGround(snapshot.map, unit, hall)
      && (distance(unit, hall) < 650 || aimedAt(unit, hall) && distance(unit, hall) < 1800
        || intel.intrusion !== undefined && distance(intel.intrusion.building, hall) <= GOLD_MINE_RULES.baseRange
          && intel.intrusion.attackers.includes(unit))),
  })).filter(raid => raid.attackers.length > 0)
    .sort((a, b) => Number(b.attackers.some(unit => aimedAt(unit, b.hall))) - Number(a.attackers.some(unit => aimedAt(unit, a.hall)))
      || strengthOf(b.attackers) - strengthOf(a.attackers));
}

/** A mine raid beyond its local defense takes priority over an outpost's battle. */
export function uncoveredMiningRaid(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): V6Intrusion | undefined {
  const intel = readV6Intel(snapshot, owner, options), guard = detachment(snapshot, owner, options);
  return uncoveredRaid(snapshot, intel, guard);
}

function uncoveredRaid(snapshot: GameSnapshot, intel: V6Intel, guard: Detachment | undefined): V6Intrusion | undefined {
  for (const { hall, attackers } of miningRaids(snapshot, intel)) {
    if (mountedHarassment(snapshot, intel, attackers)) continue;
    if (guard && attackers.every(unit => guard.attackers.includes(unit))) continue;
    const cover = intel.ownTowers.filter(tower => distance(tower, hall) <= tower.attackRange)
      .reduce((power, tower) => power + TOWER_STRENGTH * tower.hp / tower.maxHp, 0);
    const threat = strengthOf(attackers);
    if (threat > cover) return { building: hall, attackers, threat };
  }
  return undefined;
}

function detachment(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): Detachment | undefined {
  const intel = readV6Intel(snapshot, owner, options);
  const squad = harassSquadGuard(snapshot, owner, options, intel);
  if (squad) return squad;
  const raids = miningRaids(snapshot, intel);
  const pool = intel.army.filter(unit => !unit.deck && unit.hp >= unit.maxHp * .6
    && activeUnitClaim(snapshot, owner, unit, options)?.kind !== 'expansionGarrison'
    && !isMineRallyClaim(activeUnitClaim(snapshot, owner, unit, options))
    && !['board', 'cast', 'charge'].includes(unit.order.type));
  for (const { hall, attackers } of raids) {
    if (mountedHarassment(snapshot, intel, attackers)) continue;
    const nearby = routeArrivals(snapshot.map, pool, hall, 'land')
      .filter(({ unit, ticks }) => ticks < SIM_TICKS_PER_SECOND * 1300 / unit.speed
        && (unit.expiresTick === undefined || unit.expiresTick > snapshot.tick + ticks))
      .map(({ unit }) => unit);
    const fighters = nearby.filter(unit => !isBacklineKind(unit) && unit.attackDamage > 0);
    const crew = fighters.filter(unit => unit.attackRange <= 80).slice(0, 2);
    if (attackers.some(unit => unit.expiresTick !== undefined)) {
      const dispeller = nearby.find(unit => UNIT_DEFS[unit.kind].abilities.includes('curse'));
      if (dispeller) crew.push(dispeller);
    }
    const cover = intel.ownTowers.filter(tower => attackers.some(unit => distance(tower, unit) <= tower.attackRange))
      .reduce((power, tower) => power + TOWER_STRENGTH * tower.hp / tower.maxHp, 0);
    for (const fighter of fighters) {
      if (crew.length >= 3 && strengthOf(crew) + cover >= strengthOf(attackers) * 1.25) break;
      if (!crew.includes(fighter)) crew.push(fighter);
    }
    // A detachment must cover its raid and leave a larger army for the other front.
    if (crew.length < 3 || strengthOf(crew) + cover < strengthOf(attackers) * 1.25
      || strengthOf(crew) > intel.power * .55) continue;
    return { hall, attackers, crew };
  }
}

export const mineDefense: AiScript = {
  id: 'mineDefense', phase: 'tactics', redirects: 'local',
  claimsUnits: mineGuardUnitIds,
  onCommands: recordHarassSquadCommands,
  run(snapshot, owner, options): GameCommand[] {
    const squad = planHarassSquad(snapshot, owner, options, readV6Intel(snapshot, owner, options));
    if (squad !== undefined) return squad;
    const guard = detachment(snapshot, owner, options);
    if (!guard) return [];
    const crewIds = new Set(guard.crew.map(unit => unit.id));
    const charges = planV8Charge(snapshot, owner, options).filter(command => command.type === 'cast' && crewIds.has(command.unitId));
    const charging = new Set(charges.flatMap(command => command.type === 'cast' ? [command.unitId] : []));
    const threat = averagePoint(guard.attackers), gap = distance(threat, guard.hall);
    const post = { x: guard.hall.x + (threat.x - guard.hall.x) * Math.min(1, 200 / gap),
      y: guard.hall.y + (threat.y - guard.hall.y) * Math.min(1, 200 / gap) };
    const moving = guard.crew.filter(unit => {
      if (charging.has(unit.id)) return false;
      const order = unit.order;
      if (order.type === 'attackMove' && distance(order, post) < 80) return false;
      if (order.type === 'idle' && distance(unit, post) < 80) return false;
      if (order.type === 'attack' && snapshot.units.some(target => target.id === order.targetId && distance(target, post) < 450)) return false;
      return true;
    });
    return [...charges, ...(moving.length ? [resolveAiCommandIntent(snapshot, owner,
      { type: 'attackMove', unitIds: moving.map(unit => unit.id), ...post }, options)] : [])];
  },
};

export function mineGuardUnitIds(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const squad = harassSquadAssignment(snapshot, owner, options, readV6Intel(snapshot, owner, options));
  return new Set((squad?.crew ?? detachment(snapshot, owner, options)?.crew)?.filter(unit => !squad || unit.hp >= unit.maxHp * .35).map(unit => unit.id));
}

export function planBootstrapGeneral(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): GameCommand[] {
  const whole = mainArmyIntel(snapshot, owner, options), beforePriority = options.memory.v6?.general;
  const expansion = expansionMissionCommands(snapshot, owner, options, whole);
  const reserved = new Set(expansion === undefined ? [] : expansionMissionUnitIds(options.memory));
  if (options.memory.v6?.creep?.group.some(id => reserved.has(id)) && !options.memory.landAttack?.camp)
    delete options.memory.v6.creep;
  const army = whole.army.filter(unit => !reserved.has(unit.id));
  const intel = { ...whole, army, power: strengthOf(army), ...(army.length ? { armyCenter: averagePoint(army) } : {}) };
  let defendedHall: Building | undefined, haulingDefense = false;
  const defense = (() => {
    // Local micro may own every fighter. The shared planner also returns before
    // choosing a defense post in this case; there is no main-army center to use.
    if (!army.length) return undefined;
    const anchored = anchoredMiningDefense(snapshot, owner, options, intel);
    if (anchored) { defendedHall = nearestByRoute(snapshot.map, intel.ownHalls, anchored.hall, 'land'); return anchored; }
    const mining = miningJobDefenseTarget(snapshot, owner, intel, options);
    if (mining) { haulingDefense = true; return mining; }
    const covered = coveredDefenseTarget(snapshot, intel);
    defendedHall = covered && nearestByRoute(snapshot.map, intel.ownHalls, covered.hall, 'land');
    return covered;
  })();
  const task = options.memory.landAttack;
  const living = task?.general.group?.filter(id => snapshot.units.some(unit => unit.id === id)) ?? [];
  const borrowed = living.length > 0 && living.every(id => reserved.has(id));
  const available = new Set(availableV6Army(snapshot, options, intel).map(unit => unit.id));
  const localJob = living.length > 0 && living.every(id => !available.has(id));
  prepareLandAttack(snapshot, owner, options, intel, beforePriority,
    defense ? 'defense' : borrowed ? 'expansion' : localJob ? 'defense' : undefined);
  const creep = options.memory.v6?.creep, previous = options.memory.v6?.general;
  const retreatBefore = { ...options.memory.v6?.plays };
  const recruits = creep ? availableV6Army(snapshot, options, intel).filter(unit => !unit.deck && !isBacklineKind(unit)
    && unit.attackDamage > 0 && unit.hp >= unit.maxHp * V7_WOUNDED_SHARE
    && !creep.group.includes(unit.id) && !['cast', 'charge'].includes(unit.order.type)) : [];
  // Reinforcements walk to the existing staging point. Count them in the camp's force only after they arrive.
  const arrived = creep ? recruits.filter(unit => distance(unit, creep.staging) <= V7_GATHERED_RANGE) : [];
  if (creep) creep.group.push(...arrived.map(unit => unit.id));
  let commands = attackRoadCampCommands(snapshot, owner, options, intel, false) ?? planV6Army(snapshot, owner, options, intel, {
    reinforcements: 'siege', expansionBasis: 'mines',
    expansionHandled: expansion !== undefined || options.memory.landAttack !== undefined,
    // Secure a working economy; an unfunded wish alone cannot reserve a stranded host.
    reserveExpansion: activeMiningBaseCount(snapshot, owner) > 0
      || snapshot.players[owner]!.gold >= BUILDING_DEFS.townHall.cost
      || snapshot.units.some(unit => unit.owner === owner && unit.kind === 'worker'
        && unit.order.type === 'build' && unit.order.buildingKind === 'townHall'),
    chooseCamp: (...args) => expansion === undefined ? chooseBootstrapCamp(intel.home, ...args) : undefined,
    startCamp: startBootstrapCamp,
    campTerritory: 'ground',
    chooseMine: (view, world) => expansion === undefined ? bootstrapExpansionMine(view, owner, world, options) : undefined,
    threatWithin: (unit, point, range) => groundThreatWithin(snapshot, unit, point, range),
    frontThreat: (world, front) => groundFrontThreat(snapshot, world, front),
    respondingPower: (world, target, front) => groundRespondingPower(snapshot, world, target, front),
    selectAttack: (choices, eligible) => chooseRoomAttack(snapshot, options, intel, choices, eligible),
    withinHomeReach: (world, point) => [world.home, ...world.ownHalls]
      .some(hall => routeWithinDistance(snapshot.map, hall, point, 'land', V7_HOME_REACH)),
    campOnOwnSide: (world, point) => {
      const own = nearestByRoute(snapshot.map, [world.home, ...world.ownHalls], point, 'land')!;
      const enemy = nearestByRoute(snapshot.map, world.enemies.flatMap(enemy => enemy.bases.map(base => base.hall)), point, 'land');
      return enemy === undefined || walkingDistance(snapshot.map, own, point, 'land')! < walkingDistance(snapshot.map, enemy, point, 'land')!;
    },
    defenseTarget: () => defense,
    towerWaiting: holdCoveredPost,
    waitForTowers: waitsForTowers,
    gatherAssault: intel.enemies.some(enemy => enemy.army.length > 0),
    recovery: (wounded, point) => recoverBootstrapFront(snapshot, owner, wounded, point, options),
    // A distant detour to apparently nearby attackers leaves the mining perimeter uncovered.
    pursue: defense => (!defendedHall || distance(defense.hall, defense.field) <= MINING_PURSUIT_RADIUS)
      && walkingDistance(snapshot.map, defense.hall, defense.field)! <= distance(defense.hall, defense.field) + defense.leash!,
  });
  if (creep && options.memory.v6?.creep === creep) {
    const camps = neutralCamps(snapshot), target = activeCamp(creep, camps)!;
    const walking = recruits.filter(unit => !arrived.includes(unit)
      && campRecruitRoadClear(snapshot, unit, creep.staging, camps, target)
      && !(unit.order.type === 'move' && distance(unit.order, creep.staging) < V7_GATHERED_RANGE));
    if (walking.length) commands.push(resolveAiCommandIntent(snapshot, owner,
      { type: 'move', unitIds: walking.map(unit => unit.id), ...creep.staging }, options));
  }
  const general = options.memory.v6?.general;
  const hall = haulingDefense ? undefined : defendedHall ?? intel.ownHalls.find(hall => hall.id === previous?.targetHallId);
  if (hall && general?.mode === 'defend') {
    general.targetHallId = hall.id;
    // V9's fleeing-enemy branch has no intrusion and bypasses pursue(). It obeys the same defended-base boundary.
    if (general.target && distance(general.target, hall) > MINING_PURSUIT_RADIUS) {
      const point = options.memory.miningDefense?.point ?? options.memory.miningLeash?.point ?? hall;
      const front = availableV6Army(snapshot, options, intel).filter(unit => !isBacklineKind(unit)
        && unit.hp >= unit.maxHp * V7_WOUNDED_SHARE && !expansionOwnsDefender(snapshot, owner, options, unit));
      const ids = new Set(front.map(unit => unit.id));
      commands = commands.flatMap((command): GameCommand[] => {
        if (!('unitIds' in command)) return [command];
        const unitIds = command.unitIds.filter(id => !ids.has(id));
        return unitIds.length ? [{ ...command, unitIds }] : [];
      });
      const walking = front.filter(unit => distance(unit, point) > 240);
      const waiting = front.filter(unit => distance(unit, point) <= 240);
      if (walking.length) commands.push({ type: 'move', unitIds: walking.map(unit => unit.id), ...point, avoidCombat: true });
      if (waiting.length) commands.push({ type: 'holdPosition', unitIds: waiting.map(unit => unit.id) });
      general.mode = 'guard'; general.target = point;
    }
  }
  if (previous?.mode === 'attack' && general?.mode !== 'attack' && options.memory.v6?.retreatedAt === snapshot.tick) {
    const ordered = new Set(commands.flatMap(command => 'unitIds' in command ? command.unitIds : []));
    const leaving = intel.army.filter(unit => !isBacklineKind(unit) && previous.group!.includes(unit.id) && !ordered.has(unit.id));
    commands.push(...retreatV6Front(snapshot, owner, leaving, general!.target!, options)
      .map(command => ({ ...command, avoidCombat: true })));
  }
  if (general?.mode === 'hold') {
    const assistance = assistExpansionMission(snapshot, owner, options, army);
    const helping = new Set(assistance.flatMap(command => 'unitIds' in command ? command.unitIds : []));
    commands = commands.flatMap((command): GameCommand[] => {
      if (!('unitIds' in command)) return [command];
      const unitIds = command.unitIds.filter(id => !helping.has(id));
      return unitIds.length ? [{ ...command, unitIds }] : [];
    });
    commands.push(...assistance);
  }
  observeLandAttack(snapshot, options, retreatBefore);
  const road = options.memory.landAttack?.camp ? undefined : attackRoadCampCommands(snapshot, owner, options, intel, true);
  if (road !== undefined) return [...(expansion ?? []), ...road];
  const routed = general?.mode === 'attack' && general.stage !== 'gather'
    && !intel.army.some(unit => general.group!.includes(unit.id) && (unit.kind === 'ballista' || unit.kind === 'catapult'))
    ? routeAssaultCampCommands(snapshot, commands,
      intel.army.filter(unit => !isBacklineKind(unit) && general.group!.includes(unit.id)).map(unit => unit.id), general.target!,
      armedFoes(snapshot, owner, options)) : commands;
  return [...(expansion ?? []), ...routed];
}

/** Rallying reinforcements keep their route while arrived fighters defend the anchored mine. */
export const miningRally: AiScript = {
  id: 'miningRally', phase: 'tactics', redirects: 'local',
  onCommands: recordMiningRallyAcceptedCommands,
  afterPlan: (snapshot, owner, options) => recordMiningRallyCommands(snapshot, owner, options.memory),
  claimsUnits(snapshot, owner, options) {
    const assignment = miningRallyAssignment(snapshot, owner, options, mainArmyIntel(snapshot, owner, options));
    return new Set(assignment?.units.filter(unit => assignment.state.phase === 'gather' || !assignment.arrivedIds.includes(unit.id)).map(unit => unit.id));
  },
  run(snapshot, owner, options) { return planMiningRally(snapshot, owner, options, mainArmyIntel(snapshot, owner, options)); },
};

export const miningLeash: AiScript = {
  id: 'miningLeash', phase: 'tactics', redirects: 'local',
  claimsUnits(snapshot, owner, options) {
    return new Set(miningLeashAssignment(snapshot, owner, options, mainArmyIntel(snapshot, owner, options))?.units.map(unit => unit.id));
  },
  run: (snapshot, owner, options) => planMiningLeash(snapshot, owner, options, mainArmyIntel(snapshot, owner, options)),
  onCommands: recordMiningLeashAcceptedCommands,
  afterPlan: (snapshot, owner, options) => recordMiningLeashCommands(snapshot, owner, options.memory),
};

export function planBootstrapCloseout(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): GameCommand[] {
  const intel = mainArmyIntel(snapshot, owner, options), job = options.memory.v6?.closeout;
  // A cleanup crew that loses its minimum force recruits again through the same ordinary selector.
  if (job && intel.army.filter(unit => job.unitIds.includes(unit.id)).length < DETACHMENT_MIN) delete options.memory.v6!.closeout;
  return planV6CloseoutArmy(snapshot, owner, options, intel);
}

export function mainArmyIntel(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): V6Intel {
  const intel = readV6Intel(snapshot, owner, options), guard = detachment(snapshot, owner, options);
  const crew = new Set(guard?.crew.map(unit => unit.id));
  for (const id of mercenaryControlUnitIds(snapshot, owner, options)) crew.add(id);
  for (const id of lootRecoveryUnitIds(snapshot, owner, options)) crew.add(id);
  for (const id of shoppingUnitIds(snapshot, owner, options)) crew.add(id);
  for (const id of mobileCare.claimsUnits!(snapshot, owner, options)) crew.add(id);
  for (const { patient, walk } of postRecoveryAssignments(snapshot, owner, options)) if (!walk) crew.add(patient.id);
  for (const { spirit } of summonedMiningRaids(snapshot, owner, options)) crew.add(spirit.id);
  const army = intel.army.filter(unit => activeUnitClaim(snapshot, owner, unit, options)?.kind !== 'expansionGarrison'
    && !miningRallyOwns(snapshot, options.memory, unit.id) && !miningLeashOwns(snapshot, options.memory, unit.id) && !crew.has(unit.id) && !mountedFieldOwns(snapshot, owner, unit.id)
    && !options.memory.mounted?.some(assignment => assignment.unitIds.includes(unit.id)));
  const covered = guard && intel.intrusion && distance(intel.intrusion.building, guard.hall) < 600
    && intel.intrusion.attackers.every(unit => guard.attackers.includes(unit));
  const { armyCenter, intrusion, ...world } = { ...intel,
    ownHalls: snapshot.buildings.filter(building => building.owner === owner && building.kind === 'townHall'),
    intrusion: readIntrusion(buildings(snapshot, owner), intel.enemies, true) };
  const main: V6Intel = { ...world, army, power: strengthOf(army) };
  // A spent birth mine no longer anchors the army's regrouping and defensive commitment.
  const working = intel.ownHalls.find(hall => sameGround(snapshot.map, intel.home, hall)
    && snapshot.resources.some(mine => mine.amount > 0 && distance(mine, hall) < GOLD_MINE_RULES.baseRange));
  if (working) main.home = { x: working.x, y: working.y };
  if (army.length) main.armyCenter = averagePoint(army);
  const raid = uncoveredRaid(snapshot, intel, guard);
  if (raid) main.intrusion = raid;
  else if (intrusion && !covered && !mountedHarassment(snapshot, intel, intrusion.attackers)) main.intrusion = intrusion;
  return main;
}
