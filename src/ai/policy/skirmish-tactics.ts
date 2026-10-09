import { SIM_TICKS_PER_SECOND } from "../../shared/time";
import { canReceiveHealing } from "../../shared/healing";
import { BUILDING_DEFS, healingBuildingKindForRace, isHealingBuildingKind } from "../../shared/catalog";
import { aimingProfile } from "../../shared/aiming";
import { UNIT_DEFS } from "../../shared/catalog";
import type { GameCommand, GameSnapshot, PlayerId, Unit } from "../../shared/types";
import { armyPower } from "./combat-math";
import { resolveAiCommandIntent } from "./commands";
import { opponentPlayerIds } from "./ownership";
import { buildings, combatUnits, enemyBuildings, hostileCombatUnits, units } from "./snapshot";
import { averagePoint, clamp, distance, nearestEntity, withinRangeOf, type Point } from "./spatial";
import { behaviorDisabled, recordBehavior } from "./telemetry";
import type { PresetAiPolicyOptions } from "./types";
import { isV5HybridPolicy, isV6Policy } from "./versions";
import { veteranRecoveryHpRatio } from "./veterancy";
import { mainBase, playerState } from "./world-model";

export function planSkirmishPreservation(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand[] {
  if (behaviorDisabled(options, "skirmishPreservation")) {
    recordBehavior(options, "skirmishPreservation", "disabledSkips");
    return [];
  }

  const ownBase = mainBase(snapshot, owner);
  // V6's spirits are free and expire on their own: they fight to the end instead of walking home wounded.
  const ownCombat = combatUnits(snapshot, owner).filter((unit) => !(isV6Policy(options) && unit.kind === "spirit"));
  // @@@creep-preservation - Neutral camps are real combat threats; v2 must stop donating wounded units while creeping.
  const enemies = hostileCombatUnits(snapshot, owner, options.teams);
  const retreatPoint = skirmishRetreatPoint(snapshot, owner, enemies, ownBase);
  const combatRetreats = combatWoundedRetreatCommands(snapshot, owner, ownCombat, enemies, retreatPoint, options);
  if (combatRetreats.length > 0) {
    for (const command of combatRetreats) recordBehavior(options, "skirmishPreservation", "woundedRangedPullbacks");
    return combatRetreats;
  }
  if (shouldLetTowerMercCloseoutContinue(snapshot, owner, ownCombat, enemies, options)) return [];
  const commands: GameCommand[] = [];

  for (const unit of ownCombat) {
    const kite = rangedKiteCommand(snapshot, owner, unit, enemies, ownBase, options);
    if (kite) {
      commands.push(kite);
      recordBehavior(options, "skirmishPreservation", "rangedKites");
      continue;
    }
    if (unit.hp >= unit.maxHp * 0.36) continue;
    const nearbyEnemies = enemies.filter((enemy) => distance(enemy, unit) <= 380);
    if (nearbyEnemies.length === 0) continue;
    if (unit.attackRange > 100) {
      const pull = pullbackPoint(unit, retreatPoint, 0.36);
      commands.push(resolveAiCommandIntent(snapshot, owner, { type: "move", unitIds: [unit.id], x: pull.x, y: pull.y }, options));
      recordBehavior(options, "skirmishPreservation", "woundedRangedPullbacks");
    } else {
      commands.push(resolveAiCommandIntent(snapshot, owner, { type: "move", unitIds: [unit.id], x: retreatPoint.x, y: retreatPoint.y }, options));
      recordBehavior(options, "skirmishPreservation", "woundedMeleeSaves");
    }
  }
  // Recovery elsewhere must not suppress the front's volley or pullback; each unit gets one tactical assignment.
  const recoveryCommands = woundedRecoveryCommands(snapshot, owner, unassignedCombat(ownCombat, commands), enemies, retreatPoint, options);
  if (recoveryCommands.length > 0) {
    for (const command of recoveryCommands) recordBehavior(options, "skirmishPreservation", "woundedMeleeSaves");
    commands.push(...recoveryCommands);
  }
  const veteranRecoveryCommands = veteranCoreRecoveryCommands(snapshot, owner, unassignedCombat(ownCombat, commands), enemies, retreatPoint, options);
  if (veteranRecoveryCommands.length > 0) {
    for (const command of veteranRecoveryCommands) recordBehavior(options, "skirmishPreservation", "woundedMeleeSaves");
    commands.push(...veteranRecoveryCommands);
  }
  if (shouldLetDeadEconomyCloseoutContinue(snapshot, owner, ownCombat, options)) return commands;

  const skirmish = localSkirmish(snapshot, owner, unassignedCombat(ownCombat, commands), enemies, ownBase, options);
  if (!skirmish) return commands;
  const criticalPickoff = localSkirmishCriticalPickoff(snapshot, owner, skirmish, options);
  if (criticalPickoff) return [...commands, criticalPickoff];
  recordBehavior(options, "skirmishPreservation", "attempts");
  recordBehavior(options, "skirmishPreservation", "disadvantagedRetreats");
  const intent = deadOpponentBaseSkirmishNeedsCleanRetreat(snapshot, owner, skirmish, options)
    ? { type: "move" as const, unitIds: skirmish.allies.map((unit) => unit.id), x: retreatPoint.x, y: retreatPoint.y }
    : { type: "attackMove" as const, unitIds: skirmish.allies.map((unit) => unit.id), x: retreatPoint.x, y: retreatPoint.y };
  return [...commands, resolveAiCommandIntent(snapshot, owner, intent, options)];
}

function unassignedCombat(army: Unit[], commands: GameCommand[]): Unit[] {
  const assigned = new Set(commands.flatMap(command => 'unitIds' in command ? command.unitIds : []));
  return army.filter(unit => !assigned.has(unit.id));
}

function localSkirmishCriticalPickoff(snapshot: GameSnapshot, owner: PlayerId, skirmish: { allies: Unit[]; enemies: Unit[] }, options: PresetAiPolicyOptions): GameCommand | undefined {
  if (!isV5HybridPolicy(options)) return undefined;
  const target = skirmish.enemies
    .filter((enemy) => enemy.owner !== "neutral" && enemy.attackRange > 100 && enemy.hp <= enemy.maxHp * 0.18)
    .sort((a, b) => a.hp - b.hp || b.attackDamage - a.attackDamage)[0];
  if (!target) return undefined;
  const attackers = skirmish.allies.filter((ally) => ally.attackDamage > 0 && ally.hp >= ally.maxHp * 0.36 && distance(ally, target) <= skirmishPickoffJoinRange(ally));
  const volley = attackers.reduce((total, ally) => total + ally.attackDamage, 0);
  // @@@skirmish-critical-pickoff - Preservation owns this frame; finish an in-range ranged unit before retreating instead of letting focusFire lose the units to conflict filtering.
  if (attackers.length < 2 || volley < target.hp * 1.35) return undefined;
  return resolveAiCommandIntent(snapshot, owner, { type: "focusFire", unitIds: attackers.map((unit) => unit.id), targetId: target.id }, options);
}

function skirmishPickoffJoinRange(unit: Unit) {
  return unit.attackRange + (unit.attackRange > 100 ? 80 : 95);
}

function shouldLetDeadEconomyCloseoutContinue(snapshot: GameSnapshot, owner: PlayerId, ownCombat: Unit[], options: PresetAiPolicyOptions) {
  if (options.version !== "v2" || ownCombat.length < 18) return false;
  const opponents = opponentPlayerIds(snapshot, owner, options);
  if (opponents.length < 1) return false;
  if (buildings(snapshot, owner).filter((building) => building.kind === "townHall" && building.complete).length < 2) return false;
  // @@@dead-economy-skirmish - A no-worker enemy team cannot punish a bad trade economically; do not let preservation reset the closeout army forever.
  return !opponents.some((opponent) => units(snapshot, opponent).filter((unit) => unit.kind === "worker").length > 1);
}

function shouldLetTowerMercCloseoutContinue(snapshot: GameSnapshot, owner: PlayerId, ownCombat: Unit[], enemies: Unit[], options: PresetAiPolicyOptions) {
  if (options.version !== "v4-tr" || ownCombat.length < 2) return false;
  const opponents = opponentPlayerIds(snapshot, owner, options);
  if (opponents.length < 1) return false;
  const remainingBuildings = enemyBuildings(snapshot, owner, options.teams);
  if (remainingBuildings.length === 0) return false;
  const enemyWorkers = opponents.reduce((total, opponent) => total + units(snapshot, opponent).filter((unit) => unit.kind === "worker").length, 0);
  if (enemyWorkers > 2) return false;
  const opponentCombat = enemies.filter((unit) => unit.owner !== "neutral");
  if (opponentCombat.length > Math.max(2, ownCombat.length - 1)) return false;
  // @@@tower-merc-closeout-preservation - V4-TR's late army is small and mercenary-limited; once the enemy economy is dead, preservation must not oscillate ranged mercs away from the last buildings.
  return ownCombat.some((unit) => {
    if (remainingBuildings.some((building) => distance(unit, building) <= 1_000)) return true;
    if (unit.order.type !== "attackMove") return false;
    const order = unit.order;
    return remainingBuildings.some((building) => distance(order, building) <= 720);
  });
}

function woundedRecoveryCommands(snapshot: GameSnapshot, owner: PlayerId, ownCombat: Unit[], enemies: Unit[], retreatPoint: Point, options: PresetAiPolicyOptions): GameCommand[] {
  if (options.version !== "v2") return [];
  return ownCombat
    .filter((unit) => canReceiveHealing(unit, snapshot))
    .filter((unit) => unit.hp < unit.maxHp * 0.36)
    .filter((unit) => unit.order.type === "idle" || unit.order.type === "move" || unit.order.type === "attackMove")
    .filter((unit) => enemies.every((enemy) => distance(enemy, unit) > 420))
    .flatMap((unit) => {
      const recoveryPoint = woundedRecoveryPoint(snapshot, owner, unit, retreatPoint);
      if (distance(unit, recoveryPoint) <= 110) return [];
      return [resolveAiCommandIntent(snapshot, owner, { type: "move", unitIds: [unit.id], x: recoveryPoint.x, y: recoveryPoint.y }, options)];
    });
}

function woundedRecoveryPoint(snapshot: GameSnapshot, owner: PlayerId, unit: Unit, retreatPoint: Point): Point {
  if (!canReceiveHealing(unit, snapshot)) return retreatPoint;
  const healingKind = healingBuildingKindForRace(playerState(snapshot, owner).race);
  const healingRange = BUILDING_DEFS[healingKind].attackRange;
  const well = nearestEntity(buildings(snapshot, owner).filter((building) => isHealingBuildingKind(building.kind) && building.complete && building.hp > 0), unit);
  if (!well) return retreatPoint;
  if (distance(unit, well) <= healingRange - 12) return unit;
  const dx = unit.x - well.x;
  const dy = unit.y - well.y;
  const length = Math.hypot(dx, dy) || 1;
  // @@@wounded-healing-ring - Long-term recovery should converge inside healing range without reusing the neutral-leash escape point.
  const radius = healingRange * 0.75;
  return {
    x: clamp(well.x + (dx / length) * radius, 0, snapshot.map.width),
    y: clamp(well.y + (dy / length) * radius, 0, snapshot.map.height),
  };
}

function veteranCoreRecoveryCommands(snapshot: GameSnapshot, owner: PlayerId, ownCombat: Unit[], enemies: Unit[], retreatPoint: Point, options: PresetAiPolicyOptions): GameCommand[] {
  if (options.version !== "v2") return [];
  return ownCombat
    .filter((unit) => unit.hp < unit.maxHp * veteranRecoveryHpRatio(unit, options))
    .filter((unit) => unit.order.type === "idle" || unit.order.type === "move" || unit.order.type === "attackMove")
    .filter((unit) => enemies.some((enemy) => distance(enemy, unit) <= 560))
    .flatMap((unit) => {
      const recoveryPoint = woundedRecoveryPoint(snapshot, owner, unit, retreatPoint);
      if (distance(unit, recoveryPoint) <= 110) return [];
      // @@@veteran-core-preservation - Starred units are accumulated combat capital; recover them before the ordinary critical-health cutoff treats them as disposable bodies.
      return [resolveAiCommandIntent(snapshot, owner, { type: "move", unitIds: [unit.id], x: recoveryPoint.x, y: recoveryPoint.y }, options)];
    });
}

function combatWoundedRetreatCommands(snapshot: GameSnapshot, owner: PlayerId, ownCombat: Unit[], enemies: Unit[], retreatPoint: Point, options: PresetAiPolicyOptions): GameCommand[] {
  if (options.version !== "v2" || options.policyMode !== "combat") return [];
  return ownCombat
    .filter((unit) => unit.hp / Math.max(1, unit.maxHp) <= 0.42 && enemies.some((enemy) => distance(enemy, unit) <= 520))
    .filter((unit) => unit.attackRange > 100 || unit.hp < unit.maxHp * 0.36)
    .map((unit) => {
      const pull = pullbackPoint(unit, retreatPoint, 0.36);
      return resolveAiCommandIntent(snapshot, owner, { type: "move", unitIds: [unit.id], x: pull.x, y: pull.y }, options);
    });
}

function skirmishRetreatPoint(snapshot: GameSnapshot, owner: PlayerId, enemies: Unit[], ownBase: Point): Point {
  if (owner === "neutral") return ownBase;
  const nearMainNeutrals = enemies.filter((unit) => unit.owner === "neutral" && distance(unit, ownBase) <= 900);
  if (nearMainNeutrals.length === 0) return ownBase;
  const pressure = averagePoint(nearMainNeutrals);
  const dx = ownBase.x - pressure.x;
  const dy = ownBase.y - pressure.y;
  const length = Math.hypot(dx, dy) || 1;
  // @@@neutral-leash-retreat - Pulling wounded troops to the town hall can drag nearby creeps through the worker line.
  return {
    x: clamp(ownBase.x + (dx / length) * 260, 0, snapshot.map.width),
    y: clamp(ownBase.y + (dy / length) * 260, 0, snapshot.map.height),
  };
}

// @@@v5-stutter-step - A shooter reloading next to a melee attacker is taking free swings. While its weapon is on cooldown it
// weighs the next shot against melee contact. Mounted shooters can spend a larger movement budget without losing aim.
const STUTTER_MIN_STEP = 30;
const STUTTER_MAX_STEP = 160;
const STUTTER_THREAT_MARGIN = 60;
const STUTTER_HEALERS: ReadonlySet<string> = new Set(["priest", "emberAcolyte", "fieldMedic"]);

function v5StutterStepCommand(snapshot: GameSnapshot, owner: PlayerId, unit: Unit, enemies: Unit[], safePoint: Point, options: PresetAiPolicyOptions): GameCommand | undefined {
  if (unit.attackRange <= 100 || unit.attackDamage <= 0 || STUTTER_HEALERS.has(unit.kind)) return undefined;
  const threat = enemies
    .filter((enemy) => enemy.attackRange <= 80 && distance(enemy, unit) <= enemy.attackRange + enemy.radius + unit.radius + STUTTER_THREAT_MARGIN)
    .sort((a, b) => distance(a, unit) - distance(b, unit))[0];
  if (!threat) return undefined;
  const profile = aimingProfile(UNIT_DEFS[unit.kind]);
  if (unit.aim && unit.kind !== "horseArcher" && profile) {
    const contactSeconds = Math.max(0, distance(threat, unit) - threat.attackRange - unit.radius - threat.radius) / Math.max(2, threat.speed);
    const shotSeconds = unit.cooldown / SIM_TICKS_PER_SECOND + Math.hypot(threat.x - unit.aim.x, threat.y - unit.aim.y) / profile.speed;
    if (unit.hp >= unit.maxHp * .6 && contactSeconds > shotSeconds + 0.1) return undefined;
  }
  let step = Math.min(STUTTER_MAX_STEP, unit.speed * unit.cooldown / SIM_TICKS_PER_SECOND);
  if (unit.kind === "horseArcher" && unit.aim && profile) {
    const budget = Math.max(0, profile.moveTolerance - Math.hypot(unit.x - unit.aim.anchorX, unit.y - unit.aim.anchorY));
    step = Math.min(step, budget / 1.3);
  }
  if (step < STUTTER_MIN_STEP) return undefined;
  const dx = unit.x - threat.x;
  const dy = unit.y - threat.y;
  const length = Math.hypot(dx, dy) || 1;
  const homeX = safePoint.x - unit.x;
  const homeY = safePoint.y - unit.y;
  const homeLength = Math.hypot(homeX, homeY) || 1;
  const x = clamp(unit.x + (dx / length) * step + (homeX / homeLength) * step * 0.3, 0, snapshot.map.width);
  const y = clamp(unit.y + (dy / length) * step + (homeY / homeLength) * step * 0.3, 0, snapshot.map.height);
  return resolveAiCommandIntent(snapshot, owner, { type: "move", unitIds: [unit.id], x, y }, options);
}

function rangedKiteCommand(snapshot: GameSnapshot, owner: PlayerId, unit: Unit, enemies: Unit[], safePoint: Point, options: PresetAiPolicyOptions): GameCommand | undefined {
  if (isV5HybridPolicy(options)) return v5StutterStepCommand(snapshot, owner, unit, enemies, safePoint, options);
  if (options.version !== "v2" || unit.attackRange <= 100 || unit.hp >= unit.maxHp * 0.82) return undefined;
  const closeMelee = enemies
    .filter((enemy) => enemy.attackRange <= 80 && distance(enemy, unit) <= Math.max(75, enemy.attackRange + enemy.radius + unit.radius))
    .filter((enemy) => unit.hp / Math.max(1, unit.maxHp) < enemy.hp / Math.max(1, enemy.maxHp))
    .sort((a, b) => distance(a, unit) - distance(b, unit))[0];
  if (!closeMelee) return undefined;
  const dx = unit.x - closeMelee.x;
  const dy = unit.y - closeMelee.y;
  const length = Math.hypot(dx, dy) || 1;
  const homeBiasX = safePoint.x - unit.x;
  const homeBiasY = safePoint.y - unit.y;
  const homeLength = Math.hypot(homeBiasX, homeBiasY) || 1;
  const x = clamp(unit.x + (dx / length) * 150 + (homeBiasX / homeLength) * 45, 0, snapshot.map.width);
  const y = clamp(unit.y + (dy / length) * 150 + (homeBiasY / homeLength) * 45, 0, snapshot.map.height);
  return resolveAiCommandIntent(snapshot, owner, { type: "move", unitIds: [unit.id], x, y }, options);
}

function localSkirmish(snapshot: GameSnapshot, owner: PlayerId, ownCombat: Unit[], enemies: Unit[], ownBase: Point, options: PresetAiPolicyOptions): { allies: Unit[]; enemies: Unit[] } | undefined {
  const enemyBase = options.version === "v4-tr" ? nearestEnemyBase(snapshot, owner, ownBase, options) : undefined;
  const enemiesNear = withinRangeOf(enemies, 560);
  const alliesNear = withinRangeOf(ownCombat, 520);
  for (const anchor of ownCombat) {
    // @@@enemy-base-skirmish - V2/V3 should preserve bad enemy-base dives; V4-TR wins by keeping tower/merc pressure committed.
    if (distance(anchor, ownBase) < 700) continue;
    if (enemyBase && distance(anchor, enemyBase) < 700) continue;
    const localEnemies = enemiesNear(anchor);
    if (localEnemies.length < 2) continue;
    const allies = localSkirmishAllies(snapshot, owner, alliesNear(anchor), localEnemies, options);
    if (allies.length < 2) continue;
    if (dormantNeutralThreatsStillOnRoute(localEnemies, allies)) continue;
    if (armyPower(localEnemies) <= armyPower(allies) * 1.05) continue;
    return { allies, enemies: localEnemies };
  }
  return undefined;
}

// nearbyAllies: the own combat units within 520 of the anchor, in their order.
function localSkirmishAllies(snapshot: GameSnapshot, owner: PlayerId, nearbyAllies: Unit[], localEnemies: Unit[], options: PresetAiPolicyOptions) {
  if (!isV5HybridPolicy(options) || opponentPlayerIds(snapshot, owner, options).length < 2) return nearbyAllies;
  if (playerState(snapshot, owner).race !== "ember") return nearbyAllies;
  const localEnemyIds = new Set(localEnemies.map((unit) => unit.id));
  const engagedAllies = nearbyAllies.filter(
    (unit) =>
      localEnemies.some((enemy) => distance(unit, enemy) <= 520) ||
      ((unit.order.type === "attack" || unit.order.type === "attackMove") && unit.order.targetId !== undefined && localEnemyIds.has(unit.order.targetId)),
  );
  // @@@v5-skirmish-reservation - Hybrid 1v2 preservation must not reserve healthy rear reinforcements before attackWave can commit them.
  return engagedAllies.length >= 2 ? engagedAllies : nearbyAllies;
}

function deadOpponentBaseSkirmishNeedsCleanRetreat(snapshot: GameSnapshot, owner: PlayerId, skirmish: { allies: Unit[]; enemies: Unit[] }, options: PresetAiPolicyOptions) {
  if (options.version !== "v2" || opponentPlayerIds(snapshot, owner, options).length < 2) return false;
  const center = averagePoint(skirmish.allies);
  const deadBaseOwners = opponentPlayerIds(snapshot, owner, options).filter(
    (opponent) => buildings(snapshot, opponent).some((building) => distance(building, center) <= 560) && units(snapshot, opponent).length === 0,
  );
  if (deadBaseOwners.length === 0) return false;
  const liveEnemies = skirmish.enemies.filter((enemy) => !deadBaseOwners.includes(enemy.owner));
  // @@@dead-base-clean-retreat - Once a dead opponent's buildings are only terrain, preservation must not attack-move into them while a live opponent's army owns the field.
  return liveEnemies.length >= 2 && armyPower(liveEnemies) > armyPower(skirmish.allies) * 1.05;
}

function dormantNeutralThreatsStillOnRoute(enemies: Unit[], allies: Unit[]) {
  // @@@dormant-neutral-route - Idle/leashing creeps near a route are objective-planning input; skirmish preservation should react once they engage.
  return enemies.every((enemy) => enemy.owner === "neutral" && (enemy.order.type === "idle" || enemy.order.type === "move") && allies.every((ally) => distance(enemy, ally) > 280));
}

function nearestEnemyBase(snapshot: GameSnapshot, owner: PlayerId, from: Point, options: PresetAiPolicyOptions) {
  return nearestEntity(enemyBuildings(snapshot, owner, options.teams).filter((building) => building.kind === "townHall" && building.complete), from);
}

function pullbackPoint(unit: Unit, ownBase: Point, amount: number): Point {
  return {
    x: unit.x + (ownBase.x - unit.x) * amount,
    y: unit.y + (ownBase.y - unit.y) * amount,
  };
}
