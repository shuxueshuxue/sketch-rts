import { joinPublicPath } from "../shared/deployment-base";
import { isInCabin } from "../shared/ship-cabin";
import type { GameSnapshot, Owner, PlayerId } from "../shared/types";
import { relationTo, type Relation } from "./relations";

export const HOVER_CURSOR_SIZE = 32;
/** Every SVG's arrow tip is at this pixel, including the pointer-lock image. */
export const HOVER_CURSOR_HOTSPOT = [4, 3] as const;
export const HOVER_CURSOR_ART: Readonly<Record<Relation, { file: string; color: string; shape: string }>> = {
  own: { file: "own.svg", color: "#88ce86", shape: "shield" },
  ally: { file: "ally.svg", color: "#84d5e6", shape: "linked-rings" },
  enemy: { file: "enemy.svg", color: "#ec9695", shape: "diamond" },
  creep: { file: "neutral.svg", color: "#e8bd78", shape: "circle" },
};

const publicBasePath = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
type HoverSnapshot = Pick<GameSnapshot, "teams" | "players" | "units" | "buildings" | "mercenaryCamps" | "shops">;
export type UnitHoverCursorMode = "inspect" | "placement" | "targeting" | "unavailable";
export type UnitHoverCursorOptions = {
  mode?: UnitHoverCursorMode;
  pointerLocked?: boolean;
  basePath?: string;
};
export type UnitHoverCursor = {
  nativeCursor: string;
  relation?: Relation;
  iconUrl?: string;
  hotspot?: typeof HOVER_CURSOR_HOTSPOT;
};

export function unitHoverCursorUrl(relation: Relation, basePath = publicBasePath) {
  return joinPublicPath(basePath, `art/cursors/${HOVER_CURSOR_ART[relation].file}`);
}

/** A relation marker for inspection, never a promise that the selection can attack.
 * Resolve the current entity by ID so captures, death and disappearing 3D picks
 * cannot leave the cursor showing an old owner. Both 2D and 3D use this result. */
export function unitHoverCursor(
  snapshot: HoverSnapshot | undefined,
  viewer: PlayerId | undefined,
  hoveredId: string | undefined,
  options: UnitHoverCursorOptions = {},
): UnitHoverCursor {
  const mode = options.mode ?? "inspect";
  const fallback = mode === "placement" ? "copy" : mode === "targeting" ? "crosshair" : mode === "unavailable" ? "not-allowed" : "default";
  const ordinary = { nativeCursor: options.pointerLocked ? "none" : fallback };
  if (mode !== "inspect" || !snapshot || !viewer || !Object.hasOwn(snapshot.players, viewer) || !hoveredId) return ordinary;

  const unit = snapshot.units.find(candidate => candidate.id === hoveredId);
  let owner: Owner;
  if (unit) {
    if (unit.hp <= 0 || isInCabin(unit)) return ordinary;
    owner = unit.owner;
  } else {
    const building = snapshot.buildings.find(candidate => candidate.id === hoveredId);
    if (building) {
      if (building.hp <= 0) return ordinary;
      owner = building.owner;
    } else if (snapshot.mercenaryCamps.some(candidate => candidate.id === hoveredId) || snapshot.shops?.some(candidate => candidate.id === hoveredId)) {
      owner = "neutral";
    } else return ordinary;
  }
  const relation = relationTo(snapshot, viewer, owner);
  const iconUrl = unitHoverCursorUrl(relation, options.basePath ?? publicBasePath);
  return {
    nativeCursor: options.pointerLocked ? "none" : `url(${JSON.stringify(iconUrl)}) ${HOVER_CURSOR_HOTSPOT.join(" ")}, default`,
    relation, iconUrl, hotspot: HOVER_CURSOR_HOTSPOT,
  };
}
