import { UNIT_DEFS } from "./catalog";
import type { GameMap, GameSnapshot, Owner, TerrainLandmark, Unit } from "./types";

export type PresentationCategory = "terrain" | "goldMine" | "wildlingCamp" | "mercenaryCamp" | "building" | "unit";
export type WildlingPowerBand = "green" | "orange" | "red";

export type RectProjection = { x: number; y: number; width: number; height: number };

export type MapPresentationMark = {
  id: string;
  category: PresentationCategory;
  kind: string;
  x: number;
  y: number;
  radius: number;
  priority: number;
  sourceIds: string[];
  rotation?: number;
  owner?: Owner;
  power?: number;
  powerBand?: WildlingPowerBand;
};

type WildlingCluster = {
  x: number;
  y: number;
  power: number;
  units: Unit[];
};

const WILDLING_CLUSTER_RADIUS = 280;

export function createMapPresentation(snapshot: GameSnapshot): MapPresentationMark[] {
  const marks: MapPresentationMark[] = [];
  marks.push(...snapshot.map.landmarks.map(terrainMark));
  marks.push(
    ...snapshot.resources.map((resource) => ({
      id: `present-${resource.id}`,
      category: "goldMine" as const,
      kind: resource.kind,
      x: resource.x,
      y: resource.y,
      radius: 42,
      priority: 30,
      sourceIds: [resource.id],
    })),
  );
  marks.push(
    ...snapshot.mercenaryCamps.map((camp) => ({
      id: `present-${camp.id}`,
      category: "mercenaryCamp" as const,
      kind: camp.hireKind,
      x: camp.x,
      y: camp.y,
      radius: camp.radius,
      priority: 36,
      sourceIds: [camp.id],
    })),
  );
  marks.push(...wildlingCampMarks(snapshot.units));
  marks.push(
    ...snapshot.buildings.map((building) => ({
      id: `present-${building.id}`,
      category: "building" as const,
      kind: building.kind,
      x: building.x,
      y: building.y,
      radius: building.radius,
      priority: 50,
      owner: building.owner,
      sourceIds: [building.id],
    })),
  );
  marks.push(
    ...snapshot.units.map((unit) => ({
      id: `present-${unit.id}`,
      category: "unit" as const,
      kind: unit.kind,
      x: unit.x,
      y: unit.y,
      radius: unit.radius,
      priority: unit.owner === "neutral" ? 42 : 60,
      owner: unit.owner,
      sourceIds: [unit.id],
    })),
  );
  return marks.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

export function projectWorldToRect(point: { x: number; y: number }, map: GameMap, rect: RectProjection) {
  return {
    x: rect.x + (point.x / map.width) * rect.width,
    y: rect.y + (point.y / map.height) * rect.height,
  };
}

export function campPowerBand(power: number): WildlingPowerBand {
  if (power >= 20) return "red";
  if (power >= 10) return "orange";
  return "green";
}

function terrainMark(landmark: TerrainLandmark): MapPresentationMark {
  return {
    id: `present-${landmark.id}`,
    category: "terrain",
    kind: landmark.kind,
    x: landmark.x,
    y: landmark.y,
    radius: landmark.size / 2,
    rotation: landmark.rotation,
    priority: 10,
    sourceIds: [landmark.id],
  };
}

function wildlingCampMarks(units: Unit[]): MapPresentationMark[] {
  const clusters: WildlingCluster[] = [];
  for (const unit of units.filter(isWildling)) {
    const power = UNIT_DEFS[unit.kind].creepFoodPower ?? 0;
    const cluster = nearestCluster(clusters, unit);
    if (!cluster) {
      clusters.push({ x: unit.x, y: unit.y, power, units: [unit] });
      continue;
    }
    const count = cluster.units.length;
    cluster.x = (cluster.x * count + unit.x) / (count + 1);
    cluster.y = (cluster.y * count + unit.y) / (count + 1);
    cluster.power += power;
    cluster.units.push(unit);
  }
  return clusters.map((cluster, index) => ({
    id: `present-wildling-camp-${index + 1}`,
    category: "wildlingCamp" as const,
    kind: "wildlingCamp",
    x: cluster.x,
    y: cluster.y,
    radius: Math.max(46, 26 + cluster.power * 4),
    priority: 34,
    sourceIds: cluster.units.map((unit) => unit.id),
    owner: "neutral" as const,
    power: cluster.power,
    powerBand: campPowerBand(cluster.power),
  }));
}

function nearestCluster(clusters: WildlingCluster[], unit: Unit) {
  let best: WildlingCluster | undefined;
  let bestDistance = Infinity;
  for (const cluster of clusters) {
    const gap = Math.hypot(cluster.x - unit.x, cluster.y - unit.y);
    if (gap < bestDistance) {
      best = cluster;
      bestDistance = gap;
    }
  }
  return bestDistance <= WILDLING_CLUSTER_RADIUS ? best : undefined;
}

function isWildling(unit: Unit) {
  return unit.owner === "neutral" && (UNIT_DEFS[unit.kind].creepFoodPower ?? 0) > 0;
}
