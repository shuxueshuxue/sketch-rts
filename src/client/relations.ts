import { shipNeedsRepair } from "../shared/ship-equipment";
import { distanceToHull, isShipKind } from "../shared/ship-geometry";
import { UNIT_DEFS } from "../shared/catalog";
import { deckVisualHeight } from "./art/baked-ships";
import { unitGlyphScale } from "./glyphs";
import { circleInPolygon, worldToLocal, shipProfile } from "../shared/ship-geometry";
import { areEnemyOwners } from "../shared/sim/command-validation";
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

/** Match the rendered feet on a raised deck, rather than the hidden hull plane. */
export function unitPointerPosition(units: readonly Unit[], unit: Unit, modeled = false): Point {
  const ship = unit.deck && units.find(candidate => candidate.id === unit.deck!.shipId);
  return { x: unit.x, y: unit.y - (ship ? deckVisualHeight(ship) + 18 * unitGlyphScale(unit.radius) * (modeled && !unit.variant ? .8 : 1) : 0) };
}

export function deckMovePoint(units: readonly Unit[], selected: readonly Unit[], point: Point): Point {
  if(!selected.length || selected.some(unit=>UNIT_DEFS[unit.kind].naval))return point;
  const ship=units.filter(ship=>ship.hp>0 && shipProfile(ship) && circleInPolygon(worldToLocal(ship,{x:point.x,y:point.y+deckVisualHeight(ship)}),0,shipProfile(ship)!.hull))
    .sort((a,b)=>Math.hypot(point.x-a.x,point.y+deckVisualHeight(a)-a.y)-Math.hypot(point.x-b.x,point.y+deckVisualHeight(b)-b.y))[0];
  return ship ? {x:point.x,y:point.y+deckVisualHeight(ship)} : point;
}

export function unitAt(units: readonly Unit[], world: Point, predicate: (unit: Unit) => boolean) {
  return units.filter(unit => predicate(unit) && !isShipKind(unit.kind) && near(unitPointerPosition(units, unit), world, UNIT_REACH)).sort((a,b) => Math.hypot(unitPointerPosition(units,a).x-world.x,unitPointerPosition(units,a).y-world.y)-Math.hypot(unitPointerPosition(units,b).x-world.x,unitPointerPosition(units,b).y-world.y))[0] ?? units.find(unit => predicate(unit) && isShipKind(unit.kind) && distanceToHull(unit, world) < 8);
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

// @@@pointer-target - What the pointer is on, as in Warcraft III: of everything whose reach takes the pointer in (an item
// or a unit 34 from its middle, a building its body, a mine 84, rocks or a gate their body and 8), the one whose middle is
// nearest. A unit at a mine's foot is the unit while the pointer is on it, the mine while the pointer is on the mine.
// Right-clicks and rally points (see @@@context-target), the hover ring and the attack cursor all go by it. A mine's
// reach took a worker's right-click on any unit beside it as an order to mine.
export function pointerTarget(snapshot: Pick<GameSnapshot, "items" | "resources" | "units" | "buildings" | "obstacles">, world: Point): PointerTarget | undefined {
  let nearest: { target: PointerTarget; gap: number } | undefined;
  const consider = (at: Point, reach: number, target: PointerTarget) => {
    const gap = Math.hypot(at.x - world.x, at.y - world.y);
    if (gap < reach && (!nearest || gap < nearest.gap)) nearest = { target, gap };
  };
  for (const item of snapshot.items) if (!item.carrierId && !item.shipId) {const ship=item.deck && snapshot.units.find(ship=>ship.id===item.deck!.shipId);consider({x:item.x,y:item.y-(ship?deckVisualHeight(ship):0)}, 34, { kind: "item", item });}
  for (const resource of snapshot.resources) consider(resource, 84, { kind: "resource", resource });
  for (const unit of snapshot.units) if (!isShipKind(unit.kind)) consider(unitPointerPosition(snapshot.units, unit), UNIT_REACH, { kind: "unit", unit });
  if (nearest?.target.kind !== "unit") for (const unit of snapshot.units) if (isShipKind(unit.kind) && (distanceToHull(unit, world) < 8 || distanceToHull(unit,{x:world.x,y:world.y+deckVisualHeight(unit)}) < 8)) consider(unit, Infinity, { kind: "unit", unit });
  for (const building of snapshot.buildings) consider(building, buildingReach(building), { kind: "building", building });
  for (const obstacle of snapshot.obstacles ?? []) consider(obstacle, obstacle.radius + 8, { kind: "obstacle", obstacle });
  return nearest?.target;
}

// @@@context-target - What a right-click on what the pointer is on (see @@@pointer-target) orders the selected units, as
// in Warcraft III: workers mine a mine and repair an own damaged building; soldiers board an own transport (see
// @@@transport); an enemy's or the creeps' unit or building, or rocks or a gate, is attacked; an ally's unit is followed
// (see @@@follow). Anything else (an own unit or building, an ally's building, a mine for soldiers) is a move there.
export function targetCommand(
  snapshot: Pick<GameSnapshot, "teams"> & Partial<Pick<GameSnapshot,"items">>,
  owner: PlayerId,
  selected: readonly Unit[],
  target: Exclude<PointerTarget, { kind: "item" }>,
  queued = false,
): GameCommand | undefined {
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
  if (relation === "enemy" || relation === "creep") return { type: "attack", unitIds: ids(selected), targetId: thing.id, queued };
  if (target.kind === "building") {
    const damaged = relation === "own" && target.building.hp < target.building.maxHp;
    return damaged && workers.length > 0 ? { type: "repair", unitIds: ids(workers), buildingId: target.building.id, queued } : undefined;
  }
  if (relation === "ally") return { type: "follow", unitIds: ids(selected), targetId: thing.id, queued };
  if (isShipKind(target.unit.kind) && selected.length && selected.every(unit => unit.deck?.shipId === target.unit.id)) return undefined;
  if (UNIT_DEFS[target.unit.kind].naval && shipNeedsRepair({items:snapshot.items ?? []},target.unit) && workers.length)
    return { type: "repairShip", unitIds: ids(workers), targetId: target.unit.id, queued };
  const boarders = selected.filter((unit) => !UNIT_DEFS[unit.kind].naval && !unit.deck);
  return isShipKind(target.unit.kind) && boarders.length > 0 ? { type: "board", unitIds: ids(boarders), transportId: target.unit.id, queued } : undefined;
}
