import { BUILDING_DEFS, healingBuildingKindForRace, isHealingBuildingKind } from "../../shared/catalog";
import { isBuildPlacementClear } from "../../shared/build-placement";
import { isWalkable, openPassage } from "../../shared/terrain";
import { detCos, detSin } from "../../shared/det-math";
import type { Building, BuildingKind, GameSnapshot, PlayerId, Unit } from "../../shared/types";
import { aiSnapshotQuery, buildings } from "./snapshot";
import { clamp, distance, nearestEntity, type Point } from "./spatial";
import { mainBase, ownerDirection, playerState } from "./world-model";

// @@@roomy-placement - Where the AIs lay a building on a map whose buildings are bodies (see @@@building-body): not
// only where the sim allows it, but a passage clear of every other building's wall and of the terrain's rock, forest and
// water (see clearOfTerrain), the gap the routing keeps open (see openPassage), so a unit walks between any two, and off the lane from any town hall to a
// mine within MINE_LANE of it, so workers are never walked round a farm. Laid as close as the sim allows (4 apart), V9's
// main filled up with farms, barracks and towers in rows that shut soldiers and workers in pockets: armies of 29 stood
// in their own base for twenty minutes and the game ran to its end with the last rival's buildings standing (ladder-10,
// v5-extra-1). A map without terrain keeps its old rule.
const MINE_LANE = 450;
const LANE_WIDTH = 24;

function roomyPlacement(snapshot: GameSnapshot, kind: BuildingKind, point: Point) {
  if (!snapshot.map.terrain) return isBuildPlacementClear(snapshot, kind, point);
  const radius = BUILDING_DEFS[kind].radius;
  const passage = openPassage(snapshot.map.terrain);
  // The passage rule covers the sim's own gap (4), so the building test is one pass; the terrain's comes last.
  for (const building of snapshot.buildings) {
    const reach = radius + building.radius + passage;
    const dx = point.x - building.x;
    const dy = point.y - building.y;
    if (dx * dx + dy * dy < reach * reach) return false;
  }
  for (const [hall, mine] of mineLanes(snapshot)) if (segmentDistance(point, hall, mine) < radius + LANE_WIDTH) return false;
  if (kind !== "townHall" && kind !== "defenseTower" && !clearOfTerrain(snapshot, point, radius + passage)) return false;
  return isBuildPlacementClear(snapshot, kind, point);
}

// Whether every cell whose center lies within `reach` of the point is open ground: the passage kept from a building's
// wall to rock, forest and water as to other walls. A moon well laid against the rock at its main's rim shut two lancers in
// a pocket of seven cells (templeSpring-5). A town hall stands where its mine is and a tower where the choke it holds is.
function clearOfTerrain(snapshot: GameSnapshot, point: Point, reach: number) {
  const terrain = snapshot.map.terrain!;
  const size = terrain.cell;
  for (let row = Math.floor((point.y - reach) / size); row <= Math.floor((point.y + reach) / size); row += 1) {
    for (let col = Math.floor((point.x - reach) / size); col <= Math.floor((point.x + reach) / size); col += 1) {
      const x = (col + 0.5) * size;
      const y = (row + 0.5) * size;
      if ((x - point.x) ** 2 + (y - point.y) ** 2 >= reach * reach) continue;
      if (!isWalkable(snapshot.map, x, y)) return false;
    }
  }
  return true;
}

// The town halls' lanes to the mines within MINE_LANE of them, once per snapshot.
const lanesBySnapshot = new WeakMap<GameSnapshot, [Point, Point][]>();

function mineLanes(snapshot: GameSnapshot) {
  const known = lanesBySnapshot.get(snapshot);
  if (known) return known;
  const lanes: [Point, Point][] = [];
  for (const hall of snapshot.buildings) {
    if (hall.kind !== "townHall") continue;
    for (const mine of snapshot.resources) if (mine.amount > 0 && distance(hall, mine) <= MINE_LANE) lanes.push([hall, mine]);
  }
  lanesBySnapshot.set(snapshot, lanes);
  return lanes;
}

function segmentDistance(point: Point, a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

export function towerPointFor(snapshot: GameSnapshot, owner: PlayerId, base: Building, threat: Point | undefined): Point {
  let preferred: Point;
  if (threat) {
    const dx = threat.x - base.x;
    const dy = threat.y - base.y;
    const length = Math.hypot(dx, dy) || 1;
    const targetThreatDistance = BUILDING_DEFS.defenseTower.attackRange - 30;
    const baseOffset = clamp(length - targetThreatDistance, -150, 150);
    preferred = {
      x: clamp(base.x + (dx / length) * baseOffset, 0, snapshot.map.width),
      y: clamp(base.y + (dy / length) * baseOffset, 0, snapshot.map.height),
    };
    return legalBuildPointNear(snapshot, "defenseTower", preferred);
  }
  const direction = ownerDirection(snapshot, owner);
  preferred = {
    x: clamp(base.x + direction * 150, 0, snapshot.map.width),
    y: clamp(base.y + direction * 120, 0, snapshot.map.height),
  };
  if (distance(base, mainBase(snapshot, owner)) <= 500) return legalBuildPointNear(snapshot, "defenseTower", preferred);
  return safeTowerPointNear(snapshot, owner, base, preferred);
}

function safeTowerPointNear(snapshot: GameSnapshot, owner: PlayerId, base: Point, preferred: Point): Point {
  if (roomyPlacement(snapshot, "defenseTower", preferred) && neutralClearanceScore(snapshot, owner, preferred) >= 360) return preferred;
  const candidates = [
    preferred,
    ...[150, 210, 280, 360, 420].flatMap((radius) =>
      Array.from({ length: 16 }, (_, index) => {
        const angle = (index / 16) * Math.PI * 2;
        return { x: clamp(base.x + detCos(angle) * radius, 0, snapshot.map.width), y: clamp(base.y + detSin(angle) * radius, 0, snapshot.map.height) };
      }),
    ),
  ];
  return (
    candidates
      .filter((point) => distance(point, base) <= 430)
      .filter((point) => roomyPlacement(snapshot, "defenseTower", point))
      .sort((a, b) => towerPointScore(snapshot, owner, b, base, preferred) - towerPointScore(snapshot, owner, a, base, preferred))[0] ?? legalBuildPointNear(snapshot, "defenseTower", preferred)
  );
}

function towerPointScore(snapshot: GameSnapshot, owner: PlayerId, point: Point, base: Point, preferred: Point) {
  return Math.min(neutralClearanceScore(snapshot, owner, point), 620) * 3 - distance(point, preferred) * 0.7 - Math.max(0, distance(point, base) - 300) * 0.8;
}

function neutralClearanceScore(snapshot: GameSnapshot, owner: PlayerId, point: Point) {
  const nearestNeutral = nearestEntity(aiSnapshotQuery(snapshot).forPlayer(owner).neutral.units, point);
  return nearestNeutral ? distance(point, nearestNeutral) : 1_000;
}

export function safeMainBuildPoint(snapshot: GameSnapshot, owner: PlayerId, slot: number, buildingKind: BuildingKind = "farm"): Point {
  const base = mainBase(snapshot, owner);
  const direction = ownerDirection(snapshot, owner);
  const xSteps = [120, 190, 260, 330].map((x) => x + Math.floor(slot / 4) * 34);
  const ySteps = [100, -100, 180, -180, 260, -260].map((y) => y + (slot % 2 === 0 ? 0 : 28));
  const candidates = xSteps.flatMap((x) => ySteps.map((y) => ({ x: clamp(base.x + direction * x, 0, snapshot.map.width), y: clamp(base.y + y, 0, snapshot.map.height) })));
  // @@@scored-once - Each candidate is scored once and the sort compares the stored scores: the comparator returns the
  // same numbers as scoring inside it did, so the order (and the pick) is the same, for a sixth of the scoring.
  const neutrals = neutralUnitsOf(snapshot);
  const ownBuildings = buildings(snapshot, owner);
  return (
    candidates
      .filter((point) => roomyPlacement(snapshot, buildingKind, point))
      .map((point) => ({ point, score: mainBuildPointScore(neutrals, ownBuildings, point, base) }))
      .sort((a, b) => b.score - a.score)[0]?.point ?? legalBuildPointNear(snapshot, buildingKind, base)
  );
}

function mainBuildPointScore(neutrals: Unit[], ownBuildings: Building[], point: Point, base: Point) {
  const neutralDistance = nearestDistance(neutrals, point);
  const ownBuildingDistance = nearestDistance(ownBuildings, point);
  const neutralScore = neutralDistance !== undefined ? Math.min(neutralDistance, 520) * 3 : 1_560;
  const spacingPenalty = ownBuildingDistance !== undefined ? Math.max(0, 135 - ownBuildingDistance) * 5 : 0;
  return neutralScore - spacingPenalty - distance(point, base) * 0.25;
}

// The neutral units in snapshot order: what forPlayer(owner).neutral.units lists, without building the rest of the view.
function neutralUnitsOf(snapshot: GameSnapshot): Unit[] {
  return snapshot.units.filter((unit) => unit.owner === "neutral");
}

// The distance from `point` to the nearest of `entities`, or undefined when there are none. The scores above used
// distance(point, nearestEntity(list, point)) on a list made for the call; that is this minimum (distance is symmetric),
// found without sorting the list.
function nearestDistance(entities: readonly Point[], point: Point): number | undefined {
  let nearest: number | undefined;
  for (const entity of entities) {
    const gap = distance(point, entity);
    if (nearest === undefined || gap < nearest) nearest = gap;
  }
  return nearest;
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
    .filter((point) => roomyPlacement(snapshot, healingKind, point))
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
  if (roomyPlacement(snapshot, kind, preferred)) return preferred;
  // @@@placement-candidates - AI layout should avoid illegal foundations before the sim has to reject the command.
  const offsets = [72, 104, 140, 180, 230, 290, 360, 440, 520, 640, 800, 1_000].flatMap((radius) =>
    Array.from({ length: 16 }, (_, index) => {
      const angle = (index / 16) * Math.PI * 2;
      return { x: detCos(angle) * radius, y: detSin(angle) * radius };
    }),
  );
  return (
    offsets
      .map((offset) => ({ x: clamp(preferred.x + offset.x, 0, snapshot.map.width), y: clamp(preferred.y + offset.y, 0, snapshot.map.height) }))
      .find((point) => roomyPlacement(snapshot, kind, point)) ?? preferred
  );
}
