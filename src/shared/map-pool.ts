import type { GeneratedLayoutKind, GeneratedLayoutOptions } from "./types";

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
  // A size given is the map's; absent, the seed draws it, as a sea map's does (its sizes a step larger than land's).
  layout: GeneratedLayoutOptions & { kind: GeneratedLayoutKind };
};

export const MAP_POOL = [
  { id: "greystonePass", name: { en: "Greystone Pass", zh: "灰岩隘口" }, players: 2, layout: { seed: "pool-r2-1", kind: "ring", size: 4096 } },
  { id: "stillwater", name: { en: "Stillwater", zh: "静水原" }, players: 2, layout: { seed: "pool-r2-3", kind: "ring", size: 4096 } },
  { id: "pineshade", name: { en: "Pineshade", zh: "松影林" }, players: 2, layout: { seed: "pool-r2-4", kind: "ring", size: 4096 } },
  { id: "shatteredBarrens", name: { en: "Shattered Barrens", zh: "碎石荒原" }, players: 2, layout: { seed: "pool-r2-7", kind: "ring", size: 4608 } },
  { id: "reedwater", name: { en: "Reedwater", zh: "芦苇泽" }, players: 2, layout: { seed: "pool-r2-8", kind: "ring", size: 4608 } },
  { id: "saltmarshIsle", name: { en: "Saltmarsh Isle", zh: "盐沼岛" }, players: 2, layout: { seed: "isle2-a", kind: "ring", sea: true } },
  { id: "mirrorLagoon", name: { en: "Mirror Lagoon", zh: "镜湖" }, players: 2, layout: { seed: "isle2-f", kind: "ring", sea: true } },
  { id: "fourWinds", name: { en: "Four Winds", zh: "四风原" }, players: 4, layout: { seed: "pool-r4-1", kind: "ring", size: 4608 } },
  { id: "elderwood", name: { en: "Elderwood", zh: "古木林" }, players: 4, layout: { seed: "pool-r4-3", kind: "ring", size: 4608 } },
  { id: "lakelands", name: { en: "Lakelands", zh: "千湖原" }, players: 4, layout: { seed: "pool-r4-5", kind: "ring", size: 5120 } },
  { id: "ironcrag", name: { en: "Ironcrag", zh: "铁岩堡" }, players: 4, layout: { seed: "pool-r4-6", kind: "ring", size: 5120 } },
  { id: "inlandSea", name: { en: "Inland Sea", zh: "内海" }, players: 4, layout: { seed: "isle4-b", kind: "ring", sea: true } },
  { id: "gullIsland", name: { en: "Gull Island", zh: "鸥岛" }, players: 4, layout: { seed: "isle4-f", kind: "ring", sea: true } },
  { id: "twoShores", name: { en: "Two Shores", zh: "双岸" }, players: 4, layout: { seed: "pool-s4-2", kind: "sides", size: 4608 } },
  { id: "cliffbreak", name: { en: "Cliffbreak", zh: "断崖峡" }, players: 4, layout: { seed: "pool-s4-4", kind: "sides", size: 5120 } },
  { id: "battlelineFields", name: { en: "Battleline Fields", zh: "列阵原" }, players: 4, layout: { seed: "pool-s4-6", kind: "sides", size: 5120 } },
] as const satisfies readonly PoolMap[];

export type PoolMapId = (typeof MAP_POOL)[number]["id"];

export function poolMap(id: string): PoolMap | undefined {
  return MAP_POOL.find((map) => map.id === id);
}

/** Whether these teams, one per player, can play the map: all its seats taken, and on a sides map two teams of one size. */
export function poolSeatsFit(map: PoolMap, teams: readonly string[]) {
  if (teams.length !== map.players) return false;
  if (map.layout.kind !== "sides") return true;
  const sizes = [...new Set(teams)].map((team) => teams.filter((other) => other === team).length);
  return sizes.length === 2 && sizes[0] === sizes[1];
}
