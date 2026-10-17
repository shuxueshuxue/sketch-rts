import { unitMover, unitRules } from "./catalog";
import { seconds } from "./time";
import type { DamageReductionSource } from "./damage-reduction";
import type { Building, GameSnapshot, Unit } from "./types";

// @@@tower-garrison - A defense tower may be fortified, each tower on its own: it grows broader, its health doubles, and
// it strikes no more; instead its owner's troops climb onto its top, up to TOWER_GARRISON.supply of supply (a troop with no
// supply, a summon, counts as one). Up there a troop does not walk: it strikes what is within its own reach and waits for
// what is not. Two rules protect it until the tower falls: a melee blow never crosses between a tower's top and anything
// else, either way (see strikeReach), and every other kind of damage, shots, spells, blasts, fire and poison, lands at
// TOWER_GARRISON.damageTaken (see garrisonCover). Heals, curses and other effects reach it as anywhere. Any walking order
// takes a troop down to the tower's foot first; when the tower falls its troops are left standing where they stood.
// Price: a new tower costs 125 and 6.5s; fortifying gives up the tower's own weapon for +200 health and a sheltered
// platform, so it costs less than another tower, and takes as long as a barracks.
export const TOWER_GARRISON = {
  cost: 100,
  time: seconds(12),
  radius: 40,
  maxHpMultiplier: 2,
  supply: 4,
  damageTaken: 0.4,
} as const;
// Where the troops stand on a fortified top, from the tower's center, in garrison order.
const TOP_SPOTS = [{ x: -14, y: -14 }, { x: 14, y: -14 }, { x: -14, y: 14 }, { x: 14, y: 14 }] as const;

type Snapshot = Pick<GameSnapshot, "units"> & Partial<Pick<GameSnapshot, "variants">>;

export function canFortify(building: Building) {
  return building.kind === "defenseTower" && building.complete && !building.fortified && !building.fortify;
}

export function garrisonSupply(snapshot: Partial<Pick<GameSnapshot, "variants">>, unit: Unit) {
  return Math.max(1, unitRules(snapshot, unit).supplyUsed);
}

export function canStandOnTower(unit: Unit) {
  return unit.hp > 0 && unitMover(unit.kind) === "land" && !unit.deck && !unit.cabin;
}

/** The living troops on a tower's top, in the order they stand on its spots. */
export function towerGarrison(units: readonly Unit[], tower: Pick<Building, "id">) {
  return units.filter(unit => unit.hp > 0 && unit.garrison?.buildingId === tower.id).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function garrisonUsed(snapshot: Snapshot, tower: Pick<Building, "id">) {
  return towerGarrison(snapshot.units, tower).reduce((total, unit) => total + garrisonSupply(snapshot, unit), 0);
}

/** Whether this troop may climb onto this tower now. */
export function garrisonRoomFor(snapshot: Snapshot, tower: Building, unit: Unit) {
  return !!tower.fortified && tower.hp > 0 && tower.owner === unit.owner && canStandOnTower(unit)
    && garrisonUsed(snapshot, tower) + garrisonSupply(snapshot, unit) <= TOWER_GARRISON.supply;
}

export function towerTopSpot(tower: Pick<Building, "x" | "y">, index: number) {
  const spot = TOP_SPOTS[index % TOP_SPOTS.length]!;
  return { x: tower.x + spot.x, y: tower.y + spot.y };
}

/** The tower's foot toward a point: where a troop climbs on and where it is set down. */
export function towerFoot(tower: Pick<Building, "x" | "y" | "radius">, unit: Pick<Unit, "radius">, toward: { x: number; y: number }) {
  const dx = toward.x - tower.x, dy = toward.y - tower.y, length = Math.hypot(dx, dy);
  const reach = tower.radius + unit.radius + 2;
  return length === 0 ? { x: tower.x, y: tower.y + reach } : { x: tower.x + dx / length * reach, y: tower.y + dy / length * reach };
}

/** A garrison's shelter against everything but a melee blow, which never reaches it (see strikeReach). */
export function garrisonCover(unit: Pick<Unit, "garrison">): DamageReductionSource[] {
  return unit.garrison ? [{ group: "cover", amount: 1 - TOWER_GARRISON.damageTaken, filter: { delivery: ["ranged", "effect"] } }] : [];
}
