import { UNIT_DEFS, unitMover } from "./catalog";
import { detCos, detSin } from "./det-math";
import { isWalkable, walkableGoal } from "./terrain";
import type { Building, GameMap, Unit } from "./types";

// @@@reach - A unit fights only what it can come within its reach of from its own ground (see @@@terrain-movers): a
// soldier strikes a ship that has come in to the shallows, where it can wade out to it, and not one out on deep water; an
// archer on the beach shoots a ship within its range of the shore; a ship shoots what stands within its range of the water.
// Seeking a target, turning on an attacker, keeping one and charging all ask this, so nobody stands on a beach waiting for
// a ship it will never reach. Two units on the same ground always can, as before (a walk that cannot join them is the
// walk's matter, not the fight's).
export function canReach(map: Pick<GameMap, "terrain" | "width" | "height">, attacker: Unit, target: Unit | Building) {
  if (!map.terrain) return true;
  const mover = unitMover(attacker.kind);
  if (mover === ("order" in target ? unitMover(target.kind) : "land")) return true;
  if (isWalkable(map, target.x, target.y, mover)) return true;
  // A building is reached at its wall (see @@@building-reach), a unit at its center.
  const stand = walkableGoal(map, target.x, target.y, mover);
  return Math.hypot(stand.x - target.x, stand.y - target.y) - ("order" in target ? 0 : target.radius) <= attacker.attackRange;
}

// @@@transport - A transport (a unit whose kind carries) takes aboard the soldiers told to board it once they come
// alongside, while their supply fits in what it carries, and sets them ashore, on the land nearest it, when it reaches the
// water nearest the point it was told to unload at. Aboard they are out of the game (nobody sees, strikes or orders them)
// but still count toward their owner's supply, and they drown with it.
export const BOARDING_GAP = 24;
// A passenger steps ashore only on land this near the transport's side.
export const LANDING_REACH = 72;

export function carries(unit: Unit) {
  return UNIT_DEFS[unit.kind].carries ?? 0;
}

export function alongside(unit: Unit, transport: Unit) {
  return Math.hypot(unit.x - transport.x, unit.y - transport.y) <= unit.radius + transport.radius + BOARDING_GAP;
}

// Where the transport's passenger number `index` of `count` steps ashore: the land nearest a point on the transport's side,
// the passengers spread round it; undefined when no land is near enough.
export function landingSpot(map: Pick<GameMap, "terrain" | "width" | "height">, transport: Unit, index: number, count: number) {
  const angle = (index / Math.max(1, count)) * Math.PI * 2;
  const spot = walkableGoal(map, transport.x + detCos(angle) * transport.radius, transport.y + detSin(angle) * transport.radius, "land");
  return Math.hypot(spot.x - transport.x, spot.y - transport.y) <= transport.radius + LANDING_REACH ? spot : undefined;
}
