import { GOLD_MINE_RULES } from "./mining";
import type { Building, GameSnapshot, MercenaryCamp, Obstacle, ResourceNode, Shop } from "./types";

// @@@structure-body - Whatever stands on the map and is no unit is one kind of body: a building, a rock pile or gate (see
// @@@obstacle), a gold mine, a shop or a mercenary camp. Each is a footprint of whole cells (see @@@building-footprint)
// that units walk round (see @@@building-pathing) and never stand in (see @@@building-body), that no building is laid on
// (see buildingPlacementBlocker), and that a unit reaches across from its edge (see footprintGap), as in Warcraft III,
// where a gold mine, a goblin merchant and a mercenary camp are as solid as a barracks. Mines, shops and camps used to be
// points with a radius beside that model: units walked over them, farms were laid on shops and camps, and a generator
// set each shop half over its camp.
export type SiteKind = "goldMine" | "shop" | "mercenaryCamp";
export type StructureBody = { id: string; kind: SiteKind; x: number; y: number; radius: number };

type Sites = Partial<Pick<GameSnapshot, "resources" | "shops" | "mercenaryCamps">>;

// A site's body is kept per site, so the list a step hands the routing holds the same objects while the sites stand. A
// mine has no radius of its own: every mine has the economy's (see GOLD_MINE_RULES).
const bodies = new WeakMap<object, StructureBody>();
function siteBody(site: ResourceNode | Shop | MercenaryCamp, kind: SiteKind, radius: number): StructureBody {
  let body = bodies.get(site);
  if (!body || body.x !== site.x || body.y !== site.y || body.radius !== radius) {
    body = { id: site.id, kind, x: site.x, y: site.y, radius };
    bodies.set(site, body);
  }
  return body;
}

// The neutral sites: the mines, the shops and the mercenary camps. They neither move nor fall; a worked-out mine stands
// where it stood.
export function siteBodies(world: Sites): StructureBody[] {
  return [
    ...(world.resources ?? []).map(mine => siteBody(mine, "goldMine", GOLD_MINE_RULES.radius)),
    ...(world.shops ?? []).map(shop => siteBody(shop, "shop", shop.radius)),
    ...(world.mercenaryCamps ?? []).map(camp => siteBody(camp, "mercenaryCamp", camp.radius)),
  ];
}

export function standingBodies(world: Pick<GameSnapshot, "buildings"> & Partial<Pick<GameSnapshot, "obstacles">> & Sites): (Building | Obstacle | StructureBody)[] {
  return [...world.buildings, ...(world.obstacles ?? []), ...siteBodies(world)];
}
