import { isRangedUnit } from "./unit-weapon-class";
import { isMechanicalUnit } from "./unit-targeting";
import { towerTopLayout } from "./tower-top-layout";
import type { GarrisonRefusal } from "./command-refusal";
import { unitMover, unitRules } from "./catalog";
import type { DamageReductionSource } from "./damage-reduction";
import type { Building, GameSnapshot, Unit } from "./types";

// @@@tower-garrison - A defense tower may be upgraded into a fortified tower (see @@@building-upgrade), each tower on its
// own: it stands broader, its health doubles, and it strikes no more; instead its owner's troops climb onto its top, up to
// TOWER_GARRISON.supply of supply (a troop with no supply, a summon, counts as one). Up there a troop does not walk: it
// strikes what is within its own reach and waits for what is not, and a ranged troop reaches TOWER_GARRISON.rangeMultiplier
// farther (see applyDerivedUnitStats). Two rules protect it until the tower falls: a melee blow never crosses between a
// tower's top and anything else, either way (see strikeReach), and every other kind of damage, shots, spells, blasts, fire
// and poison, lands at TOWER_GARRISON.damageTaken (see garrisonCover). Heals, curses and other effects reach it as
// anywhere. Any walking order takes a troop down to the tower's foot first; when the tower falls its troops are left
// standing where they stood. Its price, time and body are the fortifiedTower building's (see BUILDING_RULES).
export const TOWER_GARRISON = {
  supply: 4,
  damageTaken: 0.4,
  rangeMultiplier: 1.2,
} as const;
// Weapon class comes from the current weapon's unmodified definition. Changing weapons can change class;
// technology, veterancy and tower bonuses cannot. Only ranged weapons receive range bonuses.
// Only non-mechanical land troops climb; population and whole-body packing both limit the top.

type Snapshot = Pick<GameSnapshot, "units"> & Partial<Pick<GameSnapshot, "variants">>;

/** Whether troops may stand on this building's top: the one rule every garrison check reads. */
export function isFortifiedTower(building: Pick<Building, "kind">) {
  return building.kind === "fortifiedTower";
}

export function garrisonSupply(snapshot: Partial<Pick<GameSnapshot, "variants">>, unit: Unit) {
  return Math.max(1, unitRules(snapshot, unit).supplyUsed);
}

export function canStandOnTower(unit: Unit, snapshot: Partial<Pick<GameSnapshot, "variants">> = {}) {
  return unit.hp > 0 && !isMechanicalUnit(unit, snapshot) && unitMover(unit.kind) === "land" && !unit.deck && !unit.cabin;
}

/** The living troops on a tower's top, in the order they stand on its spots. */
export function towerGarrison(units: readonly Unit[], tower: Pick<Building, "id">) {
  return units.filter(unit => unit.hp > 0 && unit.garrison?.buildingId === tower.id).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function garrisonUsed(snapshot: Snapshot, tower: Pick<Building, "id">) {
  return towerGarrison(snapshot.units, tower).reduce((total, unit) => total + garrisonSupply(snapshot, unit), 0);
}

/** The single eligibility/room rule read by commands, AI legality and the arrival check. */
export function garrisonRefusal(snapshot: Snapshot, tower: Building, unit: Unit): GarrisonRefusal | undefined {
  const buildingId = tower.id;
  if (isMechanicalUnit(unit, snapshot)) return { reason: "garrison-mechanical", detail: { buildingId } };
  if (tower.owner !== unit.owner) return { reason: "garrison-ownership", detail: { buildingId, owner: tower.owner } };
  if (!isFortifiedTower(tower) || tower.hp <= 0 || !canStandOnTower(unit, snapshot)) return { reason: "garrison-ineligible", detail: { buildingId } };
  const troops = towerGarrison(snapshot.units, tower).filter(other => other.id !== unit.id);
  const used = troops.reduce((total, other) => total + garrisonSupply(snapshot, other), 0), required = garrisonSupply(snapshot, unit);
  if (used + required > TOWER_GARRISON.supply) return { reason: "tower-full", detail: { buildingId, used, capacity: TOWER_GARRISON.supply, required } };
  if (!towerTopLayout(tower, [...troops, unit])) return { reason: "garrison-body-size", detail: { buildingId, radius: unit.radius, towerRadius: tower.radius } };
}

export function garrisonRoomFor(snapshot: Snapshot, tower: Building, unit: Unit) {
  return !garrisonRefusal(snapshot, tower, unit);
}
export { towerTopLayout };

/** The tower's foot toward a point: where a troop climbs on and where it is set down. */
export function towerFoot(tower: Pick<Building, "x" | "y" | "radius">, unit: Pick<Unit, "radius">, toward: { x: number; y: number }) {
  const dx = toward.x - tower.x, dy = toward.y - tower.y, length = Math.hypot(dx, dy);
  const reach = tower.radius + unit.radius + 2;
  return length === 0 ? { x: tower.x, y: tower.y + reach } : { x: tower.x + dx / length * reach, y: tower.y + dy / length * reach };
}

/** A ranged troop on a tower's top reaches farther (see @@@tower-garrison); classification precedes every bonus. */
export function garrisonRangeMultiplier(unit: Pick<Unit, "kind" | "attackClass" | "garrison">) {
  return unit.garrison && isRangedUnit(unit) ? TOWER_GARRISON.rangeMultiplier : 1;
}

/** A garrison's shelter against everything but a melee blow, which never reaches it (see strikeReach). */
export function garrisonCover(unit: Pick<Unit, "garrison">): DamageReductionSource[] {
  return unit.garrison ? [{ group: "cover", amount: 1 - TOWER_GARRISON.damageTaken, filter: { delivery: ["ranged", "effect"] } }] : [];
}
