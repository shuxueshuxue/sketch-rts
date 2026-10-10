import { isInCabin } from "../shared/ship-cabin";
import type { Building, GameSnapshot, MercenaryCamp, Shop, Unit } from "../shared/types";
import { pointerTarget, type PointerTarget } from "./relations";

type HoverSnapshot = Pick<GameSnapshot, "units" | "buildings" | "mercenaryCamps" | "shops" | "items" | "resources" | "obstacles">;
type Point = { x: number; y: number };
export type UnitHoverTarget = Unit | Building | ((MercenaryCamp | Shop) & { owner: "neutral" });

/** A painted 3D body owns its hover, including neutral sites. Only a missed
 * visual pick falls back to ground bodies; never inspect something behind it. */
export function unitHoverTarget(
  snapshot: HoverSnapshot,
  world: Point,
  visualPick: () => { id: string } | undefined,
  groundPick: () => PointerTarget | undefined = () => pointerTarget(snapshot, world),
): UnitHoverTarget | undefined {
  const hit = visualPick();
  if (hit) {
    const unit = snapshot.units.find(candidate => candidate.id === hit.id);
    if (unit) return unit.hp > 0 && !isInCabin(unit) ? unit : undefined;
    const building = snapshot.buildings.find(candidate => candidate.id === hit.id);
    if (building) return building.hp > 0 ? building : undefined;
    const site = snapshot.mercenaryCamps.find(candidate => candidate.id === hit.id)
      ?? snapshot.shops?.find(candidate => candidate.id === hit.id);
    return site ? { ...site, owner: "neutral" } : undefined;
  }
  const target = groundPick();
  if (target?.kind === "unit") return target.unit.hp > 0 && !isInCabin(target.unit) ? target.unit : undefined;
  if (target?.kind === "building") return target.building.hp > 0 ? target.building : undefined;
  const withinReach = (site: MercenaryCamp | Shop) => Math.hypot(site.x - world.x, site.y - world.y) < site.radius + 16;
  const site = snapshot.mercenaryCamps.find(withinReach) ?? snapshot.shops?.find(withinReach);
  return site ? { ...site, owner: "neutral" } : undefined;
}
