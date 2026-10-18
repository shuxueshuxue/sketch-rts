import { unitNeedsRepair } from "../shared/unit-repair";
import { isInCabin } from '../shared/ship-cabin';
import { distanceToHull, isShipKind } from "../shared/ship-geometry";
import { UNIT_DEFS } from "../shared/catalog";
import { deckVisualHeight } from "./art/canvas-ships";
import { unitGlyphScale } from "./glyphs";
import { towerTopLift } from "./tower-presentation";
import { canStandOnTower, isFortifiedTower } from "../shared/tower-garrison";
import { circleInPolygon, worldToLocal, shipProfile } from "../shared/ship-geometry";
import { areEnemyOwners } from "../shared/sim/command-validation";
import { canReach } from "../shared/naval";
import type { Building, GameCommand, GameSnapshot, Obstacle, Owner, PlayerId, ResourceNode, Unit, WorldItem } from "../shared/types";

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

// How far from its middle the pointer is on a unit or a building: a unit 34, a building its body (a town hall's is wider).
const UNIT_REACH = 34;
const buildingReach = (building: Building) => (building.kind === "townHall" ? 58 : 46);

/** Match the rendered feet on a raised deck or a tower's top, rather than the hidden plane under them. */
export function unitPointerPosition(units: readonly Unit[], unit: Unit, modeled = false, buildings: readonly Building[] = []): Point {
  const ship = unit.deck && units.find(candidate => candidate.id === unit.deck!.shipId);
  const lift = ship ? deckVisualHeight(ship) : towerTopLift(buildings, unit);
  return { x: unit.x, y: unit.y - (lift ? lift + 18 * unitGlyphScale(unit.radius) * (modeled && !unit.variant ? .8 : 1) : 0) };
}

/** The hull whose deck, drawn raised by its height, lies under a ground point on the screen. */
export function deckUnder(units: readonly Unit[], point: Point): Unit | undefined {
  return units.filter(ship=>ship.hp>0 && shipProfile(ship) && circleInPolygon(worldToLocal(ship,{x:point.x,y:point.y+deckVisualHeight(ship)}),0,shipProfile(ship)!.hull))
    .sort((a,b)=>Math.hypot(point.x-a.x,point.y+deckVisualHeight(a)-a.y)-Math.hypot(point.x-b.x,point.y+deckVisualHeight(b)-b.y))[0];
}
export function deckMovePoint(units: readonly Unit[], selected: readonly Unit[], point: Point): Point {
  if(!selected.length || selected.some(unit=>UNIT_DEFS[unit.kind].naval))return point;
  const ship=deckUnder(units,point);
  return ship ? {x:point.x,y:point.y+deckVisualHeight(ship)} : point;
}

// @@@deck-click - A point on a deck is a spot to walk to, not a sea destination: a move there (see @@@context-target)
// takes the walking units of the selection, and the ships in it hold. One point given to both sent a ship to put its
// middle on its own deck, swinging it round, while its crew went after a spot the hull carried away.
export function contextMovers(units: readonly Unit[], selected: readonly Unit[], point: Point, deck?: Unit): { movers: Unit[]; deck?: Unit } {
  const walkers = selected.filter(unit => !UNIT_DEFS[unit.kind].naval);
  const ship = walkers.length ? deck ?? deckUnder(units, point) : undefined;
  return ship ? { movers: walkers, deck: ship } : { movers: [...selected] };
}

export function unitAt(units: readonly Unit[], world: Point, predicate: (unit: Unit) => boolean) {
  return units.filter(unit => !isInCabin(unit) && predicate(unit) && !isShipKind(unit.kind) && near(unitPointerPosition(units, unit), world, UNIT_REACH)).sort((a,b) => Math.hypot(unitPointerPosition(units,a).x-world.x,unitPointerPosition(units,a).y-world.y)-Math.hypot(unitPointerPosition(units,b).x-world.x,unitPointerPosition(units,b).y-world.y))[0] ?? units.find(unit => predicate(unit) && isShipKind(unit.kind) && distanceToHull(unit, world) < 8);
}

export function buildingAt(buildings: readonly Building[], world: Point, predicate: (building: Building) => boolean) {
  return buildings.find((building) => predicate(building) && near(building, world, buildingReach(building)));
}

export type PointerTarget =
  | { kind: "item"; item: WorldItem }
  | { kind: "resource"; resource: ResourceNode }
  | { kind: "unit"; unit: Unit }
  | { kind: "building"; building: Building }
  | { kind: "obstacle"; obstacle: Obstacle };

// @@@pointer-target - Choose the nearest visible body under the pointer. Resource reach is its actual body,
// so ground beside a mine stays a move target and nearby workers remain individually selectable.
const GOLD_MINE_ART_REACH = 44;

export function pointerTarget(snapshot: Pick<GameSnapshot, "items" | "resources" | "units" | "buildings" | "obstacles">, world: Point): PointerTarget | undefined {
  let nearest: { target: PointerTarget; gap: number } | undefined;
  const consider = (at: Point, reach: number, target: PointerTarget) => {
    const gap = Math.hypot(at.x - world.x, at.y - world.y);
    if (gap < reach && (!nearest || gap < nearest.gap)) nearest = { target, gap };
  };
  for (const item of snapshot.items) if (!item.carrierId && !item.shipId) {const ship=item.deck && snapshot.units.find(ship=>ship.id===item.deck!.shipId);consider({x:item.x,y:item.y-(ship?deckVisualHeight(ship):0)}, 34, { kind: "item", item });}
  // A mine is pointed at across its art, which is drawn past its two-cell body (see @@@structure-body).
  for (const resource of snapshot.resources) consider(resource, GOLD_MINE_ART_REACH, { kind: "resource", resource });
  for (const unit of snapshot.units) if (!isInCabin(unit) && !isShipKind(unit.kind)) consider(unitPointerPosition(snapshot.units, unit, false, snapshot.buildings), UNIT_REACH, { kind: "unit", unit });
  if (nearest?.target.kind !== "unit") for (const unit of snapshot.units) if (isShipKind(unit.kind) && (distanceToHull(unit, world) < 8 || distanceToHull(unit,{x:world.x,y:world.y+deckVisualHeight(unit)}) < 8)) consider(unit, Infinity, { kind: "unit", unit });
  for (const building of snapshot.buildings) consider(building, buildingReach(building), { kind: "building", building });
  for (const obstacle of snapshot.obstacles ?? []) consider(obstacle, obstacle.radius + 8, { kind: "obstacle", obstacle });
  return nearest?.target;
}

// @@@context-target - What a right-click on what the pointer is on (see @@@pointer-target) orders the selected units, as
// in Warcraft III: workers mine a mine and repair own damaged buildings or mechanical units; soldiers board an own transport (see
// @@@transport) and climb onto an own fortified tower (see @@@tower-garrison); an enemy's or the creeps' unit or building, or rocks or a gate, is attacked; an ally's unit is followed
// (see @@@follow). Anything else (an own unit or building, an ally's building, a mine for soldiers) is a move there.
// @@@context-reach - An attack goes to the selected units that can come within reach of the target, by the sim's own
// test (canReach: a footman reaches no ship out on deep water; crew on a deck are left to boarding); the others are
// walked there (the caller moves them).
// When none can, the click is refused with the reason, instead of an order the whole selection could never carry out.
export type ContextRefusal = { refusal: "unreachable" };

export function targetCommand(
  snapshot: Pick<GameSnapshot, "teams" | "map" | "units"> & Partial<Pick<GameSnapshot,"items" | "variants">>,
  owner: PlayerId,
  selected: readonly Unit[],
  target: Exclude<PointerTarget, { kind: "item" }>,
  queued = false,
): GameCommand | ContextRefusal | undefined {
  const ids = (units: readonly Unit[]) => units.map((unit) => unit.id);
  const workers = selected.filter((unit) => unit.kind === "worker");
  if (target.kind === "resource") return workers.length > 0 ? { type: "mine", unitIds: ids(workers), resourceId: target.resource.id, queued } : undefined;
  if (target.kind === "obstacle") return { type: "attack", unitIds: ids(selected), targetId: target.obstacle.id, queued };
  const thing = target.kind === "unit" ? target.unit : target.building;
  const relation = relationTo(snapshot, owner, thing.owner);
  // The deck is walkable ground regardless of its owner. Clicking a defender
  // still attacks that person; explicit attack commands still strike the hull.
  if(target.kind==='unit' && isShipKind(target.unit.kind) && selected.length && selected.every(unit=>!UNIT_DEFS[unit.kind].naval)){
    const crew=selected.filter(unit=>unit.deck && unit.deck.shipId!==target.unit.id);
    if(crew.length)return {type:'board',unitIds:ids(crew),transportId:target.unit.id,queued};
    if(relation==='enemy' || relation==='creep' || selected.some(unit=>unit.deck))return undefined;
  }
  if (relation === "enemy" || relation === "creep") {
    // Crew on a deck reach across by boarding, which their own order sees to: they keep the attack as given.
    const strikers = selected.filter((unit) => unit.deck || canReach(snapshot.map, unit, thing, snapshot.units));
    return strikers.length ? { type: "attack", unitIds: ids(strikers), targetId: thing.id, queued } : { refusal: "unreachable" };
  }
  if (target.kind === "building") {
    const damaged = relation === "own" && target.building.hp < target.building.maxHp;
    if (damaged && workers.length > 0) return { type: "repair", unitIds: ids(workers), buildingId: target.building.id, queued };
    // An own fortified tower takes up the troops that can stand on its top (see @@@tower-garrison).
    const climbers = relation === "own" && isFortifiedTower(target.building) ? selected.filter(unit => canStandOnTower(unit) && unit.garrison?.buildingId !== target.building.id) : [];
    return climbers.length ? { type: "garrison", unitIds: ids(climbers), buildingId: target.building.id, queued } : undefined;
  }
  if (relation === "ally") return { type: "follow", unitIds: ids(selected), targetId: thing.id, queued };
  if (isShipKind(target.unit.kind) && selected.length && selected.every(unit => unit.deck?.shipId === target.unit.id)) return undefined;
  if (unitNeedsRepair({ ...snapshot, items: snapshot.items ?? [] }, target.unit) && workers.length)
    return { type: "repairUnit", unitIds: ids(workers), targetId: target.unit.id, queued };
  const boarders = selected.filter((unit) => !UNIT_DEFS[unit.kind].naval && !unit.deck);
  return isShipKind(target.unit.kind) && boarders.length > 0 ? { type: "board", unitIds: ids(boarders), transportId: target.unit.id, queued } : undefined;
}
