import { MAP_POOL } from "./map-pool";

// Fixed maps kept as test, research and campaign fixtures; players play the pool's maps (see @@@map-pool).
export const BASE_MAP_IDS = ["verdantCrossroads", "bareDuel", "openClaims", "campRush", "combatArena", "goldGrid", "mercPocket"] as const;

// The ladder map: every game on it is played on a War3-style ladder map generated from its layout seed (see
// @@@generated-map). The AIs' gauntlets play it, each game on a fresh layout.
export const LADDER_MAP_ID = "ladder" as const;

export const MAP_IDS = [...BASE_MAP_IDS, LADDER_MAP_ID, "grandThirty", ...MAP_POOL.map((map) => map.id)] as const;

// The gauntlets' map pool: each slot names one generated ladder map and seeds its layout. Slots are plain names, not map
// ids; every gauntlet game is played on the ladder map.
export const LADDER_SLOT_IDS: readonly string[] = Array.from({ length: 64 }, (_, index) => `ladder-${String(index + 1).padStart(2, "0")}`);

export function isMapId(value: unknown): value is (typeof MAP_IDS)[number] {
  return typeof value === "string" && (MAP_IDS as readonly string[]).includes(value);
}
