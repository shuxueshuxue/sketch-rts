import type { Building, GameSnapshot, PlayerId } from "../../shared/types";
import { aiSnapshotQuery, buildings } from "./snapshot";
import { clamp, distance, nearestEntity, type Point } from "./spatial";
import { mainBase, ownerDirection } from "./world-model";

export function towerPointFor(snapshot: GameSnapshot, owner: PlayerId, base: Building, threat: Point | undefined): Point {
  if (threat) {
    const dx = threat.x - base.x;
    const dy = threat.y - base.y;
    const length = Math.hypot(dx, dy) || 1;
    return {
      x: clamp(base.x - (dx / length) * 150, 0, snapshot.map.width),
      y: clamp(base.y - (dy / length) * 150, 0, snapshot.map.height),
    };
  }
  const direction = ownerDirection(snapshot, owner);
  return {
    x: clamp(base.x + direction * 150, 0, snapshot.map.width),
    y: clamp(base.y + direction * 120, 0, snapshot.map.height),
  };
}

export function safeMainBuildPoint(snapshot: GameSnapshot, owner: PlayerId, slot: number): Point {
  const base = mainBase(snapshot, owner);
  const direction = ownerDirection(snapshot, owner);
  const xSteps = [120, 190, 260, 330].map((x) => x + Math.floor(slot / 4) * 34);
  const ySteps = [100, -100, 180, -180, 260, -260].map((y) => y + (slot % 2 === 0 ? 0 : 28));
  const candidates = xSteps.flatMap((x) => ySteps.map((y) => ({ x: clamp(base.x + direction * x, 0, snapshot.map.width), y: clamp(base.y + y, 0, snapshot.map.height) })));
  return candidates.sort((a, b) => mainBuildPointScore(snapshot, owner, b, base) - mainBuildPointScore(snapshot, owner, a, base))[0] ?? base;
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
  return {
    x: clamp(base.x - direction * 86, 0, snapshot.map.width),
    y: clamp(base.y + 118, 0, snapshot.map.height),
  };
}

export function defensiveRallyPoint(snapshot: GameSnapshot, owner: PlayerId): Point {
  const base = mainBase(snapshot, owner);
  const tower = nearestEntity(buildings(snapshot, owner).filter((building) => building.kind === "defenseTower" && building.complete && distance(building, base) <= 520), base);
  if (!tower) return base;
  return { x: (base.x + tower.x) / 2, y: (base.y + tower.y) / 2 };
}
