import { UNIT_DEFS } from "../shared/catalog";
import { createGame } from "../shared/sim";
import type { Game, CreateGameOptions } from "../shared/sim";
import type { ItemKind, MapId, Unit } from "../shared/types";
import { campPowerBand, type WildlingPowerBand } from "../shared/presentation";

export type SdkMapObjectiveCamp = {
  index: number;
  x: number;
  y: number;
  role: "free" | "mine" | "mercenary";
  power: number;
  band: WildlingPowerBand;
  bounty: number;
  unitIds: string[];
  itemKinds: ItemKind[];
  guardedObjectiveIds: string[];
};

export type SdkMapObjectiveReport = {
  mapId: MapId;
  players: number;
  carriedItems: number;
  camps: SdkMapObjectiveCamp[];
  freeCamps: number;
  guardedCamps: number;
  bands: Record<WildlingPowerBand, number>;
  totalPower: number;
  totalBounty: number;
};

const CAMP_CLUSTER_RADIUS = 360;
const OBJECTIVE_GUARD_RADIUS = 360;

export function analyzeMapObjectives(mapId: MapId, options: CreateGameOptions = {}): SdkMapObjectiveReport {
  return analyzeGameMapObjectives(createGame(mapId, options));
}

export function analyzeGameMapObjectives(game: Game): SdkMapObjectiveReport {
  const carriedItemByUnit = new Map(game.items.filter((item) => item.carrierId).map((item) => [item.carrierId!, item.kind]));
  const camps = wildlingClusters(game.units).map<SdkMapObjectiveCamp>((cluster, index) => {
    const guardedMines = game.resources.filter((resource) => distance(cluster, resource) <= OBJECTIVE_GUARD_RADIUS).map((resource) => resource.id);
    const guardedMercs = game.mercenaryCamps.filter((camp) => distance(cluster, camp) <= OBJECTIVE_GUARD_RADIUS).map((camp) => camp.id);
    const power = cluster.units.reduce((total, unit) => total + (UNIT_DEFS[unit.kind].creepFoodPower ?? 0), 0);
    const bounty = cluster.units.reduce((total, unit) => total + (UNIT_DEFS[unit.kind].goldBounty ?? 0), 0);
    return {
      index: index + 1,
      x: cluster.x,
      y: cluster.y,
      role: guardedMines.length > 0 ? "mine" : guardedMercs.length > 0 ? "mercenary" : "free",
      power,
      band: campPowerBand(power),
      bounty,
      unitIds: cluster.units.map((unit) => unit.id),
      itemKinds: cluster.units.map((unit) => carriedItemByUnit.get(unit.id)).filter((kind): kind is ItemKind => Boolean(kind)),
      guardedObjectiveIds: [...guardedMines, ...guardedMercs],
    };
  });
  const bands = { green: 0, orange: 0, red: 0 };
  for (const camp of camps) bands[camp.band] += 1;
  return {
    mapId: game.map.id,
    players: game.activePlayers.length,
    carriedItems: game.items.filter((item) => item.carrierId).length,
    camps,
    freeCamps: camps.filter((camp) => camp.role === "free").length,
    guardedCamps: camps.filter((camp) => camp.role !== "free").length,
    bands,
    totalPower: camps.reduce((total, camp) => total + camp.power, 0),
    totalBounty: camps.reduce((total, camp) => total + camp.bounty, 0),
  };
}

function wildlingClusters(units: Unit[]) {
  const clusters: { x: number; y: number; units: Unit[] }[] = [];
  for (const unit of units.filter((candidate) => candidate.owner === "neutral" && (UNIT_DEFS[candidate.kind].creepFoodPower ?? 0) > 0)) {
    const cluster = nearestCluster(clusters, unit);
    if (!cluster) {
      clusters.push({ x: unit.x, y: unit.y, units: [unit] });
      continue;
    }
    const count = cluster.units.length;
    cluster.x = (cluster.x * count + unit.x) / (count + 1);
    cluster.y = (cluster.y * count + unit.y) / (count + 1);
    cluster.units.push(unit);
  }
  return clusters;
}

function nearestCluster<T extends { x: number; y: number }>(clusters: T[], unit: Unit) {
  let best: T | undefined;
  let bestDistance = Infinity;
  for (const cluster of clusters) {
    const gap = distance(cluster, unit);
    if (gap < bestDistance) {
      best = cluster;
      bestDistance = gap;
    }
  }
  return bestDistance <= CAMP_CLUSTER_RADIUS ? best : undefined;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
