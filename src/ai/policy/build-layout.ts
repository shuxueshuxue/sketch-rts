import { BUILDING_DEFS, healingBuildingKindForRace, isHealingBuildingKind } from "../../shared/catalog";
import { isBuildPlacementClear } from "../../shared/build-placement";
import type { Building, BuildingKind, GameSnapshot, PlayerId, Unit } from "../../shared/types";
import { aiSnapshotQuery, buildings } from "./snapshot";
import { clamp, distance, nearestEntity, type Point } from "./spatial";
import { mainBase, ownerDirection, playerState } from "./world-model";

export function towerPointFor(snapshot: GameSnapshot, owner: PlayerId, base: Building, threat: Point | undefined): Point {
  let preferred: Point;
  if (threat) {
    const dx = threat.x - base.x;
    const dy = threat.y - base.y;
    const length = Math.hypot(dx, dy) || 1;
    preferred = {
      x: clamp(base.x - (dx / length) * 150, 0, snapshot.map.width),
      y: clamp(base.y - (dy / length) * 150, 0, snapshot.map.height),
    };
    return legalBuildPointNear(snapshot, "defenseTower", preferred);
  }
  const direction = ownerDirection(snapshot, owner);
  preferred = {
    x: clamp(base.x + direction * 150, 0, snapshot.map.width),
    y: clamp(base.y + direction * 120, 0, snapshot.map.height),
  };
  return legalBuildPointNear(snapshot, "defenseTower", preferred);
}

export function safeMainBuildPoint(snapshot: GameSnapshot, owner: PlayerId, slot: number, buildingKind: BuildingKind = "farm"): Point {
  const base = mainBase(snapshot, owner);
  const direction = ownerDirection(snapshot, owner);
  const xSteps = [120, 190, 260, 330].map((x) => x + Math.floor(slot / 4) * 34);
  const ySteps = [100, -100, 180, -180, 260, -260].map((y) => y + (slot % 2 === 0 ? 0 : 28));
  const candidates = xSteps.flatMap((x) => ySteps.map((y) => ({ x: clamp(base.x + direction * x, 0, snapshot.map.width), y: clamp(base.y + y, 0, snapshot.map.height) })));
  return candidates
    .filter((point) => isBuildPlacementClear(snapshot, buildingKind, point))
    .sort((a, b) => mainBuildPointScore(snapshot, owner, b, base) - mainBuildPointScore(snapshot, owner, a, base))[0] ?? legalBuildPointNear(snapshot, buildingKind, base);
}

function mainBuildPointScore(snapshot: GameSnapshot, owner: PlayerId, point: Point, base: Point) {
  const neutralDistance = nearestEntity(aiSnapshotQuery(snapshot).forPlayer(owner).neutral.units, point);
  const ownBuildingDistance = nearestEntity(buildings(snapshot, owner), point);
  const neutralScore = neutralDistance ? Math.min(distance(point, neutralDistance), 520) * 3 : 1_560;
  const spacingPenalty = ownBuildingDistance ? Math.max(0, 135 - distance(point, ownBuildingDistance)) * 5 : 0;
  return neutralScore - spacingPenalty - distance(point, base) * 0.25;
}

export function healingWellPointFor(snapshot: GameSnapshot, owner: PlayerId, base: Point): Point {
  const direction = ownerDirection(snapshot, owner);
  const healingKind = healingBuildingKindForRace(playerState(snapshot, owner).race);
  const healingRange = BUILDING_DEFS[healingKind].attackRange;
  const recoveryCluster = woundedRecoveryClusterPoint(snapshot, owner, base);
  const candidates = [
    ...(recoveryCluster ? [recoveryCluster] : []),
    { x: base.x - direction * 86, y: base.y + 118 },
    { x: base.x - direction * 150, y: base.y + 176 },
    { x: base.x - direction * 150, y: base.y + 56 },
    { x: base.x - direction * 34, y: base.y + 188 },
    { x: base.x - direction * 34, y: base.y + 36 },
  ].map((point) => ({ x: clamp(point.x, 0, snapshot.map.width), y: clamp(point.y, 0, snapshot.map.height) }));
  return candidates
    .filter((point) => isBuildPlacementClear(snapshot, healingKind, point))
    .sort((a, b) => healingWellPointScore(snapshot, owner, b, base, healingRange) - healingWellPointScore(snapshot, owner, a, base, healingRange))[0] ?? legalBuildPointNear(snapshot, healingKind, base);
}

function healingWellPointScore(snapshot: GameSnapshot, owner: PlayerId, point: Point, base: Point, healingRange: number) {
  const ownBuildings = buildings(snapshot, owner);
  const nearestWell = nearestEntity(ownBuildings.filter((building) => isHealingBuildingKind(building.kind)), point);
  const nearestBuilding = nearestEntity(ownBuildings, point);
  const wellOverlapPenalty = nearestWell ? Math.max(0, 110 - distance(point, nearestWell)) * 40 : 0;
  const buildingSpacingPenalty = nearestBuilding ? Math.max(0, 95 - distance(point, nearestBuilding)) * 12 : 0;
  const woundedCoverage = woundedRecoveryUnits(snapshot, owner, base).filter((unit) => distance(unit, point) <= healingRange).length;
  return woundedCoverage * 220 - distance(point, base) * 0.2 - wellOverlapPenalty - buildingSpacingPenalty;
}

function woundedRecoveryClusterPoint(snapshot: GameSnapshot, owner: PlayerId, base: Point): Point | undefined {
  const wounded = woundedRecoveryUnits(snapshot, owner, base);
  if (wounded.length < 2) return undefined;
  const point = {
    x: wounded.reduce((total, unit) => total + unit.x, 0) / wounded.length,
    y: wounded.reduce((total, unit) => total + unit.y, 0) / wounded.length,
  };
  const healingKind = healingBuildingKindForRace(playerState(snapshot, owner).race);
  const existingWell = nearestEntity(buildings(snapshot, owner).filter((building) => isHealingBuildingKind(building.kind) && building.hp > 0), point);
  if (existingWell && distance(existingWell, point) <= BUILDING_DEFS[healingKind].attackRange) return undefined;
  // @@@recovery-cluster-well - If wounded fighters are already safely clustering near the main, the healing building should cover that real recovery point.
  return { x: clamp(point.x, 0, snapshot.map.width), y: clamp(point.y, 0, snapshot.map.height) };
}

function woundedRecoveryUnits(snapshot: GameSnapshot, owner: PlayerId, base: Point): Unit[] {
  return snapshot.units.filter(
    (unit) =>
      unit.owner === owner &&
      unit.kind !== "worker" &&
      unit.hp / Math.max(1, unit.maxHp) <= 0.5 &&
      distance(unit, base) <= 760 &&
      (unit.order.type === "idle" || unit.order.type === "move"),
  );
}

export function defensiveRallyPoint(snapshot: GameSnapshot, owner: PlayerId): Point {
  const base = mainBase(snapshot, owner);
  const tower = nearestEntity(buildings(snapshot, owner).filter((building) => building.kind === "defenseTower" && building.complete && distance(building, base) <= 520), base);
  if (!tower) return base;
  return { x: (base.x + tower.x) / 2, y: (base.y + tower.y) / 2 };
}

export function legalBuildPointNear(snapshot: GameSnapshot, kind: BuildingKind, preferred: Point): Point {
  if (isBuildPlacementClear(snapshot, kind, preferred)) return preferred;
  // @@@placement-candidates - AI layout should avoid illegal foundations before the sim has to reject the command.
  const offsets = [72, 104, 140, 180, 230, 290, 360, 440, 520, 640, 800, 1_000].flatMap((radius) =>
    Array.from({ length: 16 }, (_, index) => {
      const angle = (index / 16) * Math.PI * 2;
      return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    }),
  );
  return (
    offsets
      .map((offset) => ({ x: clamp(preferred.x + offset.x, 0, snapshot.map.width), y: clamp(preferred.y + offset.y, 0, snapshot.map.height) }))
      .find((point) => isBuildPlacementClear(snapshot, kind, point)) ?? preferred
  );
}
