import type { GeneratedLayoutKind, GeneratedLayoutOptions, MapIdea } from "./types";

// @@@map-pool - The ladder's maps, as Warcraft III's: a fixed set of named maps a room picks from. Each is the layout
// the generator draws (see @@@generated-map) from its own seed and options for exactly its number of players, so
// nothing of a map is stored but its line here. map-pool.test.ts locks every map's hash: a generator change that would
// redraw a pool map fails there instead of quietly changing the map. The AIs' gauntlets keep drawing fresh layouts
// (LADDER_SLOT_IDS), so no AI learns only the maps players see.
export type PoolMap = {
  id: string;
  name: { en: string; zh: string };
  // The map's seats: a room on it plays with exactly this many players.
  players: 2 | 4;
  // The idea the map is drawn on (see @@@generated-ideas); a size given is the map's, absent the seed draws one of the
  // idea's.
  layout: GeneratedLayoutOptions & { kind: GeneratedLayoutKind; idea: MapIdea };
};

export const MAP_POOL = [
  { id: "brokenSea", name: { en: "Broken Sea", zh: "碎海" }, players: 4, layout: { seed: "pool-brokenSea-1", kind: "ring", idea: "islandStarts" } },
  { id: "templeSpring", name: { en: "Temple Spring", zh: "神泉殿" }, players: 4, layout: { seed: "pool-templeSpring-1", kind: "ring", idea: "fountainRing" } },
  { id: "turtleLake", name: { en: "Turtle Lake", zh: "龟湖" }, players: 4, layout: { seed: "pool-turtleLake-1", kind: "ring", idea: "turtleIsle" } },
  { id: "elderwood", name: { en: "Elderwood", zh: "古木林" }, players: 4, layout: { seed: "pool-elderwood-1", kind: "ring", idea: "twistedPaths" } },
  { id: "ringwater", name: { en: "Ringwater", zh: "环海" }, players: 4, layout: { seed: "pool-ringwater-1", kind: "ring", idea: "outerSea" } },
  { id: "loneMarket", name: { en: "Lone Market", zh: "孤市" }, players: 2, layout: { seed: "pool-loneMarket-1", kind: "ring", idea: "oneMarket" } },
  { id: "reedwater", name: { en: "Reedwater", zh: "芦苇泽" }, players: 2, layout: { seed: "pool-reedwater-1", kind: "ring", idea: "floodedValley" } },
  { id: "veiledHill", name: { en: "Veiled Hill", zh: "雾丘" }, players: 2, layout: { seed: "pool-veiledHill-1", kind: "ring", idea: "hiddenHill" } },
  { id: "greystonePass", name: { en: "Greystone Pass", zh: "灰岩隘口" }, players: 2, layout: { seed: "pool-greystonePass-1", kind: "ring", idea: "bridgeStand" } },
  { id: "pineshade", name: { en: "Pineshade", zh: "松影林" }, players: 2, layout: { seed: "pool-pineshade-1", kind: "ring", idea: "deepJungle" } },
  { id: "gullIsland", name: { en: "Gull Island", zh: "鸥岛" }, players: 2, layout: { seed: "pool-gullIsland-1", kind: "ring", idea: "northIsles" } },
  { id: "stillwater", name: { en: "Stillwater", zh: "静水原" }, players: 4, layout: { seed: "pool-stillwater-1", kind: "sides", idea: "riverValley" } },
  { id: "twoShores", name: { en: "Two Shores", zh: "双岸" }, players: 4, layout: { seed: "pool-twoShores-1", kind: "sides", idea: "twoShores" } },
] as const satisfies readonly PoolMap[];

export type PoolMapId = (typeof MAP_POOL)[number]["id"];

export function poolMap(id: string): PoolMap | undefined {
  return MAP_POOL.find((map) => map.id === id);
}

/** Alliances are independent of a named map's physical starting seats. */
export function poolSeatsFit(map: PoolMap, teams: readonly string[]) {
  return teams.length === map.players;
}
