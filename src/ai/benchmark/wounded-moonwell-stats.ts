import type { BenchmarkTracker } from "../../sdk/benchmark/core";
import { isHealingBuildingKind } from "../../shared/catalog";
import type { Building, GameCommand, PlayerId, Unit, UnitOrder } from "../../shared/types";
import type { AiGameAgent } from "../game-runner";

export type WoundedMoonWellStats = {
  owners: Record<PlayerId, WoundedMoonWellOwnerStats>;
};

export type WoundedMoonWellOwnerStats = {
  woundedSamples: number;
  lowHpSamples: number;
  lowHpWithMoonWellSamples: number;
  lowHpInHealingRangeSamples: number;
  lowHpFarFromMoonWellSamples: number;
  lowHpSafeFarFromMoonWellSamples: number;
  lowHpIdleOrMoveFarFromMoonWellSamples: number;
  lowHpMoonWellDistanceSum: number;
  maxLowHpMoonWellDistance: number;
  avgLowHpMoonWellDistance: number | null;
  lowHpByNearestMoonWellDistance: WoundedMoonWellDistanceBuckets;
  lowHpByOrder: Partial<Record<UnitOrder["type"], number>>;
  lowHpSafeFarByRecentCommandScript: Record<string, number>;
  lowHpSafeFarByRecentCommandType: Partial<Record<GameCommand["type"] | "none", number>>;
  lowHpSafeFarByRecentCommandScriptAndType: Record<string, number>;
  lowHpSafeFarRecentTargetSamples: number;
  lowHpSafeFarRecentTargetInHealingRangeSamples: number;
  lowHpSafeFarRecentTargetFarFromMoonWellSamples: number;
  lowHpSafeFarRecentTargetMoonWellDistanceSum: number;
  maxLowHpSafeFarRecentTargetMoonWellDistance: number;
  avgLowHpSafeFarRecentTargetMoonWellDistance: number | null;
  lowHpSafeFarRecentTargetByNearestMoonWellDistance: WoundedMoonWellDistanceBuckets;
  lowHpSafeFarRecentTargetFarByScriptAndType: Record<string, number>;
};

type WoundedMoonWellTrackerState = {
  owners: Record<PlayerId, WoundedMoonWellOwnerStats>;
  recentCommands: Record<string, RecentUnitCommand>;
};

type RecentUnitCommand = {
  owner: PlayerId;
  scriptId: string;
  commandType: GameCommand["type"];
  target?: { x: number; y: number };
};

export type WoundedMoonWellDistanceBuckets = {
  noMoonWell: number;
  healingRange: number;
  near: number;
  mid: number;
  far: number;
};

const LOW_HP_RATIO = 0.5;
const MOON_WELL_HEAL_RANGE = 210;
const FAR_FROM_MOON_WELL_RANGE = MOON_WELL_HEAL_RANGE * 2;
const SAFE_ENEMY_RANGE = 420;

export function createWoundedMoonWellStatsTracker(): BenchmarkTracker<AiGameAgent, WoundedMoonWellTrackerState, WoundedMoonWellStats> {
  return {
    id: "woundedMoonWellStats",
    create: ({ players }) => ({ owners: Object.fromEntries(players.map((owner) => [owner, emptyOwnerStats()])), recentCommands: {} }),
    onCommand(state, context) {
      for (const unitId of commandUnitIds(context.command)) {
        state.recentCommands[unitId] = { owner: context.owner, scriptId: context.scriptId, commandType: context.command.type, ...commandTarget(context.command) };
      }
    },
    afterStep(state, context) {
      const snapshot = context.after;
      const teams = Object.fromEntries(Object.entries(context.match.agents).map(([owner, agent]) => [owner, agent.team]));
      for (const owner of context.players) {
        const ownerStats = (state.owners[owner] ??= emptyOwnerStats());
        const wells = snapshot.buildings.filter((building) => building.owner === owner && isHealingBuildingKind(building.kind) && building.complete && building.hp > 0);
        const ownTeam = teams[owner];
        const enemies = snapshot.units.filter((unit) => unit.owner !== owner && unit.owner !== "neutral" && teams[unit.owner] !== ownTeam && isCombatUnit(unit));
        for (const unit of snapshot.units) {
          if (unit.owner !== owner || !isCombatUnit(unit) || unit.hp >= unit.maxHp) continue;
          ownerStats.woundedSamples += 1;
          if (unit.hp / Math.max(1, unit.maxHp) > LOW_HP_RATIO) continue;
          recordLowHpSample(ownerStats, unit, wells, enemies, state.recentCommands[unit.id]);
        }
      }
    },
    finish(state) {
      for (const ownerStats of Object.values(state.owners)) {
        ownerStats.avgLowHpMoonWellDistance = ownerStats.lowHpWithMoonWellSamples > 0 ? ownerStats.lowHpMoonWellDistanceSum / ownerStats.lowHpWithMoonWellSamples : null;
        ownerStats.avgLowHpSafeFarRecentTargetMoonWellDistance =
          ownerStats.lowHpSafeFarRecentTargetSamples > 0 ? ownerStats.lowHpSafeFarRecentTargetMoonWellDistanceSum / ownerStats.lowHpSafeFarRecentTargetSamples : null;
      }
      return { owners: state.owners };
    },
  };
}

function recordLowHpSample(stats: WoundedMoonWellOwnerStats, unit: Unit, wells: Building[], enemies: Unit[], recentCommand: RecentUnitCommand | undefined) {
  stats.lowHpSamples += 1;
  stats.lowHpByOrder[unit.order.type] = (stats.lowHpByOrder[unit.order.type] ?? 0) + 1;
  const nearestWellDistance = nearestDistance(unit, wells);
  if (nearestWellDistance === null) {
    stats.lowHpByNearestMoonWellDistance.noMoonWell += 1;
    return;
  }

  stats.lowHpWithMoonWellSamples += 1;
  stats.lowHpMoonWellDistanceSum += nearestWellDistance;
  stats.maxLowHpMoonWellDistance = Math.max(stats.maxLowHpMoonWellDistance, nearestWellDistance);
  if (nearestWellDistance <= MOON_WELL_HEAL_RANGE) {
    stats.lowHpInHealingRangeSamples += 1;
    stats.lowHpByNearestMoonWellDistance.healingRange += 1;
    return;
  }
  if (nearestWellDistance <= FAR_FROM_MOON_WELL_RANGE) {
    stats.lowHpByNearestMoonWellDistance.near += 1;
    return;
  }
  stats.lowHpFarFromMoonWellSamples += 1;
  if (nearestWellDistance <= 700) stats.lowHpByNearestMoonWellDistance.mid += 1;
  else stats.lowHpByNearestMoonWellDistance.far += 1;
  if (unit.order.type === "idle" || unit.order.type === "move") stats.lowHpIdleOrMoveFarFromMoonWellSamples += 1;
  if (enemies.every((enemy) => distance(enemy, unit) > SAFE_ENEMY_RANGE)) {
    stats.lowHpSafeFarFromMoonWellSamples += 1;
    const ownRecentCommand = recentCommand && recentCommand.owner === unit.owner ? recentCommand : undefined;
    recordRecentCommandStats(stats, ownRecentCommand);
    recordRecentCommandTargetStats(stats, wells, ownRecentCommand);
  }
}

function emptyOwnerStats(): WoundedMoonWellOwnerStats {
  return {
    woundedSamples: 0,
    lowHpSamples: 0,
    lowHpWithMoonWellSamples: 0,
    lowHpInHealingRangeSamples: 0,
    lowHpFarFromMoonWellSamples: 0,
    lowHpSafeFarFromMoonWellSamples: 0,
    lowHpIdleOrMoveFarFromMoonWellSamples: 0,
    lowHpMoonWellDistanceSum: 0,
    maxLowHpMoonWellDistance: 0,
    avgLowHpMoonWellDistance: null,
    lowHpByNearestMoonWellDistance: { noMoonWell: 0, healingRange: 0, near: 0, mid: 0, far: 0 },
    lowHpByOrder: {},
    lowHpSafeFarByRecentCommandScript: {},
    lowHpSafeFarByRecentCommandType: {},
    lowHpSafeFarByRecentCommandScriptAndType: {},
    lowHpSafeFarRecentTargetSamples: 0,
    lowHpSafeFarRecentTargetInHealingRangeSamples: 0,
    lowHpSafeFarRecentTargetFarFromMoonWellSamples: 0,
    lowHpSafeFarRecentTargetMoonWellDistanceSum: 0,
    maxLowHpSafeFarRecentTargetMoonWellDistance: 0,
    avgLowHpSafeFarRecentTargetMoonWellDistance: null,
    lowHpSafeFarRecentTargetByNearestMoonWellDistance: { noMoonWell: 0, healingRange: 0, near: 0, mid: 0, far: 0 },
    lowHpSafeFarRecentTargetFarByScriptAndType: {},
  };
}

function recordRecentCommandStats(stats: WoundedMoonWellOwnerStats, command: RecentUnitCommand | undefined) {
  const scriptId = command?.scriptId ?? "none";
  const commandType = command?.commandType ?? "none";
  stats.lowHpSafeFarByRecentCommandScript[scriptId] = (stats.lowHpSafeFarByRecentCommandScript[scriptId] ?? 0) + 1;
  stats.lowHpSafeFarByRecentCommandType[commandType] = (stats.lowHpSafeFarByRecentCommandType[commandType] ?? 0) + 1;
  const combined = `${scriptId}:${commandType}`;
  stats.lowHpSafeFarByRecentCommandScriptAndType[combined] = (stats.lowHpSafeFarByRecentCommandScriptAndType[combined] ?? 0) + 1;
}

function recordRecentCommandTargetStats(stats: WoundedMoonWellOwnerStats, wells: Building[], command: RecentUnitCommand | undefined) {
  if (!command?.target) return;
  const nearestWellDistance = nearestDistance(command.target, wells);
  if (nearestWellDistance === null) {
    stats.lowHpSafeFarRecentTargetByNearestMoonWellDistance.noMoonWell += 1;
    return;
  }
  stats.lowHpSafeFarRecentTargetSamples += 1;
  stats.lowHpSafeFarRecentTargetMoonWellDistanceSum += nearestWellDistance;
  stats.maxLowHpSafeFarRecentTargetMoonWellDistance = Math.max(stats.maxLowHpSafeFarRecentTargetMoonWellDistance, nearestWellDistance);
  if (nearestWellDistance <= MOON_WELL_HEAL_RANGE) {
    stats.lowHpSafeFarRecentTargetInHealingRangeSamples += 1;
    stats.lowHpSafeFarRecentTargetByNearestMoonWellDistance.healingRange += 1;
    return;
  }
  if (nearestWellDistance <= FAR_FROM_MOON_WELL_RANGE) {
    stats.lowHpSafeFarRecentTargetByNearestMoonWellDistance.near += 1;
    return;
  }
  stats.lowHpSafeFarRecentTargetFarFromMoonWellSamples += 1;
  if (nearestWellDistance <= 700) stats.lowHpSafeFarRecentTargetByNearestMoonWellDistance.mid += 1;
  else stats.lowHpSafeFarRecentTargetByNearestMoonWellDistance.far += 1;
  const combined = `${command.scriptId}:${command.commandType}`;
  stats.lowHpSafeFarRecentTargetFarByScriptAndType[combined] = (stats.lowHpSafeFarRecentTargetFarByScriptAndType[combined] ?? 0) + 1;
}

function commandUnitIds(command: GameCommand): string[] {
  if ("unitIds" in command) return command.unitIds;
  if ("unitId" in command) return [command.unitId];
  return [];
}

function commandTarget(command: GameCommand): { target: { x: number; y: number } } | {} {
  if ("x" in command && "y" in command && command.x !== undefined && command.y !== undefined) return { target: { x: command.x, y: command.y } };
  return {};
}

function nearestDistance(unit: { x: number; y: number }, buildings: Building[]) {
  let best = Infinity;
  for (const building of buildings) best = Math.min(best, distance(unit, building));
  return best === Infinity ? null : best;
}

function isCombatUnit(unit: Unit) {
  return unit.kind !== "worker";
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
