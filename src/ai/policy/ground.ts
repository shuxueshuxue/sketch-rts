import { unitMover } from "../../shared/catalog";
import { groundWholes, sameGround } from "../../shared/terrain";
import type { GameSnapshot, PlayerId, Unit } from "../../shared/types";

type Point = { x: number; y: number };

// @@@ai-home-ground - An AI's army walks. What stands on land it cannot walk to (an island, see @@@ground-wholes) is no
// mine to expand to, no target to march on and no camp to creep, and a ship is no army to chase: the soldiers would
// stand on the beach (see @@@reach). Ships and islands are the naval script's (see @@@ai-naval). Where the land is one
// whole and no ship is afloat, nothing is set aside and nothing new is made.
export function onHomeGround(snapshot: GameSnapshot, owner: PlayerId, point: Point) {
  if (groundWholes(snapshot.map) <= 1) return true;
  const home = homeOf(snapshot, owner);
  return !home || sameGround(snapshot.map, home, point);
}

// Whether the point stands on the same ground as the home (always, where the land is one whole).
export function sameGroundAs(snapshot: GameSnapshot, home: Point, point: Point) {
  return groundWholes(snapshot.map) <= 1 || sameGround(snapshot.map, home, point);
}

// The things on the owner's own ground: the list itself where the land is one whole.
export function onOwnGround<T extends Point>(snapshot: GameSnapshot, owner: PlayerId, things: T[]): T[] {
  return groundWholes(snapshot.map) <= 1 ? things : things.filter((thing) => onHomeGround(snapshot, owner, thing));
}

// The units that walk: the list itself where no ship is afloat.
export function withoutShips(snapshot: GameSnapshot, units: Unit[]): Unit[] {
  return shipsAfloat(snapshot) ? units.filter((unit) => unitMover(unit.kind) === "land") : units;
}

const afloat = new WeakMap<GameSnapshot, boolean>();
export function shipsAfloat(snapshot: GameSnapshot) {
  let known = afloat.get(snapshot);
  if (known === undefined) {
    known = snapshot.units.some((unit) => unitMover(unit.kind) === "sea");
    afloat.set(snapshot, known);
  }
  return known;
}

// Where the owner's ground is: its first town hall (its main), else its first building.
function homeOf(snapshot: GameSnapshot, owner: PlayerId): Point | undefined {
  return snapshot.buildings.find((building) => building.owner === owner && building.kind === "townHall") ?? snapshot.buildings.find((building) => building.owner === owner);
}
