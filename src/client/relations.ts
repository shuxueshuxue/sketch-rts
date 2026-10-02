import { areEnemyOwners } from "../shared/sim/command-validation";
import type { Building, GameCommand, GameSnapshot, Obstacle, Owner, PlayerId, Unit } from "../shared/types";

type Point = { x: number; y: number };

// @@@relation - How an owner stands to the player looking on: themselves, an ally (a player on their team), an enemy, or
// the creeps. What a right-click orders goes by it (see @@@context-target).
export type Relation = "own" | "ally" | "enemy" | "creep";

export function relationTo(sides: Pick<GameSnapshot, "teams">, viewer: PlayerId, owner: Owner): Relation {
  if (owner === viewer) return "own";
  if (owner === "neutral") return "creep";
  return areEnemyOwners(sides, owner, viewer) ? "enemy" : "ally";
}

// @@@relation-ink - Friend and foe in colour, as in Warcraft III and StarCraft: own green, an ally's yellow, an enemy's
// red, the creeps' orange. Selection and hover rings take them, and the minimap does when told to (see
// @@@minimap-relations); units, buildings and health bars keep their own colours.
export const RELATION_INK: Readonly<Record<Relation, string>> = { own: "#3d9a3f", ally: "#d6a417", enemy: "#c8372b", creep: "#df7a1f" };

// Whether the viewer has an ally in the match: the minimap starts in friend-or-foe colours if so.
export function hasAlly(snapshot: Pick<GameSnapshot, "teams" | "players">, viewer: PlayerId) {
  return Object.keys(snapshot.players).some((player) => relationTo(snapshot, viewer, player) === "ally");
}

const near = (a: Point, b: Point, reach: number) => Math.hypot(a.x - b.x, a.y - b.y) < reach;

// What the pointer is on: a unit within 34 of its middle, a building within its body (a town hall's is wider), rocks or
// a gate anywhere on theirs (see @@@obstacle).
export function unitAt(units: readonly Unit[], world: Point, predicate: (unit: Unit) => boolean) {
  return units.find((unit) => predicate(unit) && near(unit, world, 34));
}

export function buildingAt(buildings: readonly Building[], world: Point, predicate: (building: Building) => boolean) {
  return buildings.find((building) => predicate(building) && near(building, world, building.kind === "townHall" ? 58 : 46));
}

export function obstacleAt(obstacles: readonly Obstacle[] | undefined, world: Point) {
  return obstacles?.find((obstacle) => near(obstacle, world, obstacle.radius + 8));
}

// @@@context-target - What a right-click on someone else's unit or building orders, as in Warcraft III: an enemy's or the
// creeps', or rocks or a gate, are attacked; an ally's unit is followed (see @@@follow); an ally's building is neither,
// so the right-click is a move there. Anything not an own unit's or building's was attacked, an ally's too.
export function rightClickOrder(
  snapshot: Pick<GameSnapshot, "teams" | "units" | "buildings" | "obstacles">,
  viewer: PlayerId,
  unitIds: string[],
  world: Point,
  queued = false,
): { command: Extract<GameCommand, { type: "attack" | "follow" }>; target: Unit | Building | Obstacle } | undefined {
  const hostile = (owner: Owner) => owner !== viewer && areEnemyOwners(snapshot, owner, viewer);
  const enemy = unitAt(snapshot.units, world, (unit) => hostile(unit.owner)) ?? buildingAt(snapshot.buildings, world, (building) => hostile(building.owner)) ?? obstacleAt(snapshot.obstacles, world);
  if (enemy) return { command: { type: "attack", unitIds, targetId: enemy.id, queued }, target: enemy };
  const ally = unitAt(snapshot.units, world, (unit) => relationTo(snapshot, viewer, unit.owner) === "ally");
  return ally ? { command: { type: "follow", unitIds, targetId: ally.id, queued }, target: ally } : undefined;
}
