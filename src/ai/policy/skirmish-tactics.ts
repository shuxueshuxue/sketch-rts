import { BUILDING_DEFS } from "../../shared/catalog";
import type { GameCommand, GameSnapshot, PlayerId, Unit } from "../../shared/types";
import { armyPower } from "./combat-math";
import { resolveAiCommandIntent } from "./commands";
import { buildings, combatUnits, enemyBuildings, hostileCombatUnits, neutralUnitsNear } from "./snapshot";
import { averagePoint, clamp, distance, nearestEntity, type Point } from "./spatial";
import { behaviorDisabled, recordBehavior } from "./telemetry";
import type { PresetAiPolicyOptions } from "./types";
import { mainBase } from "./world-model";

export function planSkirmishPreservation(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand[] {
  if (behaviorDisabled(options, "skirmishPreservation")) {
    recordBehavior(options, "skirmishPreservation", "disabledSkips");
    return [];
  }

  const ownBase = mainBase(snapshot, owner);
  const ownCombat = combatUnits(snapshot, owner);
  // @@@creep-preservation - Neutral camps are real combat threats; v2 must stop donating wounded units while creeping.
  const enemies = hostileCombatUnits(snapshot, owner, options.teams);
  const retreatPoint = skirmishRetreatPoint(snapshot, owner, enemies, ownBase);
  const combatRetreats = combatWoundedRetreatCommands(snapshot, owner, ownCombat, enemies, retreatPoint, options);
  if (combatRetreats.length > 0) {
    for (const command of combatRetreats) recordBehavior(options, "skirmishPreservation", "woundedRangedPullbacks");
    return combatRetreats;
  }
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
  if (commands.length > 0) return commands;

  const recoveryCommands = woundedRecoveryCommands(snapshot, owner, ownCombat, enemies, retreatPoint, options);
  if (recoveryCommands.length > 0) {
    for (const command of recoveryCommands) recordBehavior(options, "skirmishPreservation", "woundedMeleeSaves");
    return recoveryCommands;
  }

  const skirmish = localSkirmish(snapshot, owner, ownCombat, enemies, ownBase, options);
  if (!skirmish) return [];
  recordBehavior(options, "skirmishPreservation", "attempts");
  recordBehavior(options, "skirmishPreservation", "disadvantagedRetreats");
  return [resolveAiCommandIntent(snapshot, owner, { type: "attackMove", unitIds: skirmish.allies.map((unit) => unit.id), x: retreatPoint.x, y: retreatPoint.y }, options)];
}

function woundedRecoveryCommands(snapshot: GameSnapshot, owner: PlayerId, ownCombat: Unit[], enemies: Unit[], retreatPoint: Point, options: PresetAiPolicyOptions): GameCommand[] {
  if (options.version !== "v2") return [];
  return ownCombat
    .filter((unit) => unit.hp < unit.maxHp * 0.36)
    .filter((unit) => unit.order.type === "idle" || unit.order.type === "attackMove")
    .filter((unit) => enemies.every((enemy) => distance(enemy, unit) > 420))
    .flatMap((unit) => {
      const recoveryPoint = woundedRecoveryPoint(snapshot, owner, unit, retreatPoint);
      if (distance(unit, recoveryPoint) <= 110) return [];
      return [resolveAiCommandIntent(snapshot, owner, { type: "move", unitIds: [unit.id], x: recoveryPoint.x, y: recoveryPoint.y }, options)];
    });
}

function woundedRecoveryPoint(snapshot: GameSnapshot, owner: PlayerId, unit: Unit, retreatPoint: Point): Point {
  const well = nearestEntity(buildings(snapshot, owner).filter((building) => building.kind === "moonWell" && building.complete && building.hp > 0), unit);
  if (!well) return retreatPoint;
  if (distance(unit, well) <= BUILDING_DEFS.moonWell.attackRange - 12) return unit;
  const dx = unit.x - well.x;
  const dy = unit.y - well.y;
  const length = Math.hypot(dx, dy) || 1;
  // @@@wounded-healing-ring - Long-term recovery should converge inside healing range without reusing the neutral-leash escape point.
  const radius = BUILDING_DEFS.moonWell.attackRange * 0.75;
  return {
    x: clamp(well.x + (dx / length) * radius, 0, snapshot.map.width),
    y: clamp(well.y + (dy / length) * radius, 0, snapshot.map.height),
  };
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

function rangedKiteCommand(snapshot: GameSnapshot, owner: PlayerId, unit: Unit, enemies: Unit[], safePoint: Point, options: PresetAiPolicyOptions): GameCommand | undefined {
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
  const enemyBase = nearestEnemyBase(snapshot, owner, ownBase, options);
  for (const anchor of ownCombat) {
    if (distance(anchor, ownBase) < 700 || (enemyBase && distance(anchor, enemyBase) < 700)) continue;
    const allies = ownCombat.filter((unit) => distance(unit, anchor) <= 520);
    if (allies.length < 2) continue;
    const localEnemies = enemies.filter((unit) => distance(unit, anchor) <= 560);
    if (localEnemies.length < 2) continue;
    if (armyPower(localEnemies) <= armyPower(allies) * 1.05) continue;
    return { allies, enemies: localEnemies };
  }
  return undefined;
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
