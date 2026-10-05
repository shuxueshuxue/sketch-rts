import { UNIT_DEFS, unitMover } from "./catalog";
import { detCos, detSin } from "./det-math";
import { isOpenGround, isWalkable, sameGround, walkableGoal, walkDestination } from "./terrain";
import type { Building, GameMap, Obstacle, Unit } from "./types";

// @@@reach - A unit fights only what it can come within its reach of from its own ground (see @@@terrain-movers): a
// soldier strikes a ship that has come in to the shallows, where it can wade out to it, and not one out on deep water; an
// archer on the beach shoots a ship within its range of the shore; a ship shoots what stands within its range of the water.
// Seeking a target, turning on an attacker, keeping one and charging all ask this, so nobody stands on a beach waiting for
// a ship it will never reach. A target on the attacker's own ground it can always reach (a walk the buildings bar is the
// walk's matter, not the fight's); any other it reaches from where its ground comes nearest. Two land units were taken to
// share their ground, and on the islands they do not: three riders sought a snapper 118 to 152 off across a deep channel
// and pressed against each other on the shore for minutes, each walk ending at the same spot (pool-elderwood-4).
export function canReach(map: Pick<GameMap, "terrain" | "width" | "height">, attacker: Unit, target: Unit | Building | Obstacle) {
  if (!map.terrain) return true;
  const mover = unitMover(attacker.kind);
  if (isWalkable(map, target.x, target.y, mover) && sameGround(map, attacker, target, mover)) return true;
  // A building is reached at its wall (see @@@building-reach), a unit at its center.
  const stand = walkDestination(map, attacker, walkableGoal(map, target.x, target.y, mover), mover);
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
  return unit.cargoCapacity ?? UNIT_DEFS[unit.kind].carries ?? 0;
}

export function alongside(unit: Unit, transport: Unit) {
  return Math.hypot(unit.x - transport.x, unit.y - transport.y) <= unit.radius + transport.radius + BOARDING_GAP;
}

/** One reachable shore for the whole boat, rather than chasing each passenger in turn. */
export function boardingBerth(map: GameMap, passenger: Unit, transport: Unit) {
  if (!map.terrain) return { x: transport.x, y: transport.y };
  const terrain = map.terrain;
  const candidates: { x: number; y: number; score: number }[] = [];
  for (let index = 0; index < terrain.cells.length; index++) {
    if (terrain.cells[index] !== ",") continue;
    const point = { x: (index % terrain.cols + 0.5) * terrain.cell, y: (Math.floor(index / terrain.cols) + 0.5) * terrain.cell };
    if (!isOpenGround(map, point.x, point.y) || !isOpenGround(map, point.x, point.y, "sea")) continue;
    if (!sameGround(map, passenger, point) || !sameGround(map, transport, point, "sea")) continue;
    const score = Math.hypot(point.x - transport.x, point.y - transport.y) * 2 + Math.hypot(point.x - passenger.x, point.y - passenger.y) * 0.15;
    candidates.push({ ...point, score });
  }
  for (const point of candidates.sort((a,b) => a.score-b.score)) {
    const land = walkDestination(map, passenger, point);
    const sea = walkDestination(map, transport, point, "sea");
    if (Math.hypot(land.x-point.x, land.y-point.y) < 1 && Math.hypot(sea.x-point.x, sea.y-point.y) < 1)
      return { x: point.x, y: point.y };
  }
  const land = walkDestination(map, passenger, walkableGoal(map, transport.x, transport.y));
  const sea = walkDestination(map, transport, walkableGoal(map, land.x, land.y, "sea"), "sea");
  return Math.hypot(land.x-sea.x, land.y-sea.y) <= passenger.radius+transport.radius+BOARDING_GAP ? sea : undefined;
}

// Where the transport's passenger number `index` of `count` steps ashore: the land nearest a point on the transport's side,
// the passengers spread round it; undefined when no land is near enough.
export function landingSpot(map: Pick<GameMap, "terrain" | "width" | "height">, transport: Unit, index: number, count: number) {
  const angle = (index / Math.max(1, count)) * Math.PI * 2;
  const spot = walkableGoal(map, transport.x + detCos(angle) * transport.radius, transport.y + detSin(angle) * transport.radius, "land");
  return Math.hypot(spot.x - transport.x, spot.y - transport.y) <= transport.radius + LANDING_REACH ? spot : undefined;
}
