import { BUILDING_DEFS, UNIT_DEFS } from "./catalog";
import { detCos, detSin } from "./det-math";
import { createBuilding, createUnit, STANDARD_MAP_SIZE } from "./map";
import { createObstacle, OBSTACLE_DEFS } from "./obstacle";
import { BODY_MARGIN, cellIndexAt, isShoreFootprint, walkableGoal, type Terrain } from "./terrain";
import { seconds } from "./time";
import type { Building, GeneratedLayoutKind, GeneratedLayoutOptions, ItemKind, MapIdea, MapSite, MercenaryCamp, MercenaryUnitKind, Obstacle, ObstacleKind, PlayerId, ResourceNode, TerrainLandmark, Unit, UnitKind, WorldItem } from "./types";

// @@@generated-map - A seeded ladder map for a game of any size, drawn fresh for every seed on one of a dozen ideas, the
// way every Warcraft III ladder map stands on one idea of its own (see @@@generated-ideas): a ring of mines round a
// fountain, an island in a lake, a market everyone fights for, a river crossed by bridges, a flooded valley, a hill in the
// woods. What every idea shares:
// - Every player's main sits on a plateau walled by its cliff, and outside that by forest, all round but at its single
//   ramp; its main mine inside; its natural at the ramp's foot behind a medium guard (see @@@generated-main).
// - The ground is open but for what the idea puts on it (see @@@generated-open): forest along the map's edge, groves,
//   outcrops and lakes in the ground between the ways until the open share of the land comes down to the idea's share. The
//   ways and clearings stay open, so what stands beside them narrows them into chokes and never closes them.
// - Water is the idea's: a lake, a river, a strait, bays, a sea round the map. Wherever there is open water a ship can use,
//   every start has a beach on it (see @@@generated-water); nothing in a layout says whether a map is a sea map.
// - ring: the players stand on a ring round the middle, an equal turn apart, and the map is the same seen from every start;
//   sides: two teams of equal size face each other across the map, mirrored.
// Every feature is drawn with all its symmetric copies at once and kept only if every copy keeps its distances, and the
// grid itself is made exactly symmetric wherever the symmetry maps cells onto cells (two or four players on a ring, the
// mirror of two sides). A drawn map is kept only if every start, mine, camp and post is on one walkable whole, every
// main has room to build and every expansion room for a hall; otherwise the next draw is tried. Nothing in a layout names
// a player's version or role: the AIs read it as they read any map.

export type GeneratedMap = {
  kind: GeneratedLayoutKind;
  idea: MapIdea;
  // The map is size by size; every distance inside it is in the game's own units, whatever the size.
  size: number;
  starts: Record<PlayerId, { baseX: number; baseY: number; mineX: number; mineY: number }>;
  buildings: Building[];
  units: Unit[];
  resources: ResourceNode[];
  mercenaryCamps: MercenaryCamp[];
  items: WorldItem[];
  landmarks: TerrainLandmark[];
  terrain: Terrain;
  // @@@generated-camps - Every camp's place, its colour (green to train on near home, orange guarding a mine, a shop or a
  // post, red for the prizes everyone fights for: the middle, an island, a far mine), the ground round it, and what it drops,
  // for whoever fills the camps with creeps.
  camps: { x: number; y: number; tier: CampColor; habitat: CampHabitat; drop?: "minor" | "major" }[];
  // Neutral buildings' places: a shop, which a player buys at, no building's footprint and in nobody's way.
  sites: MapSite[];
  // The rocks and gates across shortcuts (see @@@generated-obstacles).
  obstacles: Obstacle[];
};

export type CampColor = "green" | "orange" | "red";
export type CampHabitat = "water" | "hill" | "forest" | "open";

type Point = { x: number; y: number };
// Ladder-map camp tiers: easy near home, medium at a natural, strong at contested mines and on routes, hard in the middle.
type CampTier = "easy" | "medium" | "strong" | "hard";
type Camp = { at: Point; tier: CampTier; item?: ItemKind; color?: CampColor };
// Blocker codes on the grid: 1 forest, 2 rock, 3 water.
type Blocker = 1 | 2 | 3;

// Terrain cells are this many units square.
export const TERRAIN_CELL = 32;
const MINE_GOLD = 6_000;
// A mine the idea makes its prize (the jungle's exposed middle, the turtle's island): half as much again.
const RICH_GOLD = 9_000;
const EDGE = 90;
// No creep stands this near a start or its main mine (see @@@start-safety).
const START_SAFETY = 440;
// A camp's creeps stand this far around its center.
const CAMP_SPREAD = 55;
// Mines stand this far apart (a natural this far from its own start's main mine); camps this far apart (the AI reads
// creeps within 320 of one another as one camp).
const MINE_SPACING = 700;
const NATURAL_MAIN_SPACING = 450;
// A natural stands this far from every other natural (and a little farther from every other start).
const NATURAL_SPACING = 1_400;
const CAMP_SPACING = 480;
// A camp this near a mine is its guard (the AI waits for creeps within 350 of a mine before expanding there): guards stand
// GUARD_OFFSET from their mine and every other camp at least CAMP_MINE_SPACING from every mine.
const GUARD_OFFSET = 200;
const CAMP_MINE_SPACING = 520;
// Contested ground (mines between players, route camps, mercenary posts) keeps this far from every start.
const CONTESTED_START_SPACING = 900;
const MERC_SPACING = 380;
const TRIES = 60;
const ATTEMPTS = 30;
// Every path keeps this far outside every plateau (a plateau's own ways up are carved apart).
const PLATEAU_MARGIN = 96;
// @@@generated-open - What blocks a map's land, on open ground: forest (or rock, by patches) BORDER_CELLS deep along the
// map's edge; a skirt SKIRT wide round every main's plateau, shut but for its ramp; what the idea walls off; then masses of
// MASS_RADIUS (a grove, an outcrop or a lake, in the shares of the map's theme) in the ground between the ways until the
// open share of the land is down to the idea's share (WALK_SHARE for most: the old maps, carved out of forest, kept 18 to
// 28 per cent open); last, copses here and there for the eye.
const WALK_SHARE = [0.56, 0.68] as const;
const BORDER_CELLS = [2, 7] as const;
const SKIRT = [90, 240] as const;
const MASS_RADIUS = [110, 280] as const;
// @@@generated-water - Deep water is the idea's (Water: a lake, a lagoon, a bay, a river, a strait, a sea along the edge),
// drawn first, which every mine, camp, post and plateau keeps off (see Field.dry). A way may cross water marked crossable,
// where its ground becomes a ford of shallows (walked and sailed both) or a bridge (walked, and no ship passes under it);
// never other water. An island holds a mine that only a ship reaches: ISLAND_WATER of water round it keeps its shallows off
// the land's. Every start has a beach on the open water nearest its natural, with a way down to it, wherever the idea has
// such water; the rim of all water is a strip of shallows, where soldiers wade out to strike a ship (see
// @@@terrain-movers). A draw is kept only if every beach takes a shipyard on water of OPEN_WATER deep cells or more, and
// every island's mine is reached from such a shipyard's water.
const SEA_WOBBLE = 0.12;
const ISLAND_RADIUS = 300;
const ISLAND_WATER = 200;
const BEACH_RADIUS = 190;
const OPEN_WATER = 64;
// A rock pile or gate shuts its way only where the walk round it is at least this many times the step across it.
const SHORTCUT = 4;

const CAMP_KINDS: Record<CampTier, UnitKind[][]> = {
  easy: [
    ["wildling", "mossGnawer"],
    ["thornSlinger", "wildling"],
    ["mossGnawer", "mossGnawer", "wildling"],
  ],
  medium: [
    ["stonebackBrute", "thornSlinger", "barkMender"],
    ["gladeWitch", "wildling", "thornSlinger"],
    ["stonebackBrute", "mossGnawer", "wildling"],
  ],
  strong: [
    ["stonebackBrute", "gladeWitch", "thornSlinger", "barkMender"],
    ["stonebackBrute", "stonebackBrute", "thornSlinger", "wildling"],
    ["gladeWitch", "gladeWitch", "thornSlinger", "barkMender"],
  ],
  hard: [
    ["stonebackBrute", "stonebackBrute", "gladeWitch", "thornSlinger", "thornSlinger", "barkMender"],
    ["stonebackBrute", "stonebackBrute", "stonebackBrute", "gladeWitch", "barkMender", "barkMender"],
  ],
};
const TIER_COLOR: Record<CampTier, CampColor> = { easy: "green", medium: "orange", strong: "orange", hard: "red" };
const MINOR_ITEMS: ItemKind[] = ["experienceBook", "guardianScroll"];
const MAJOR_ITEMS: ItemKind[] = ["lightningRod", "flameCloak", "stormStaff", "breachCharge"];
const MERC_KINDS: MercenaryUnitKind[] = ["mercenary", "contractArcher", "fieldMedic"];
// A map's look: the shares of its masses that are groves, outcrops and lakes (an idea may set its own), and where its edges
// and walls turn to rock (where a patch noise runs over `rockFill`).
type Theme = { forest: number; rock: number; water: number; rockFill: number };
const THEMES: Theme[] = [
  { forest: 0.65, rock: 0.2, water: 0.15, rockFill: 0.72 },
  { forest: 0.25, rock: 0.6, water: 0.15, rockFill: 0.56 },
  { forest: 0.4, rock: 0.15, water: 0.45, rockFill: 0.74 },
  { forest: 0.45, rock: 0.35, water: 0.2, rockFill: 0.64 },
];
const KIND_CHAR = { ground: ".", shallow: ",", mud: "m", bridge: "=", forest: "T", rock: "#", water: "~" } as const;

// @@@generated-ideas - The ideas a map is drawn on, after the Warcraft III maps whose idea each takes (see
// task-home/scratch/sketch-rts-maps/plan.html): the seats it takes, its sizes, its share of open land, its masses, and its
// layout. A seed draws one of the ideas that take the game's seats, but for the open ring and the open sides, which take
// any seats and are drawn only where no other idea does.
type Layout = (field: Field, players: PlayerId[], teams: Record<PlayerId, string>, teamOrder: string[]) => boolean;
type IdeaSpec = {
  kind: GeneratedLayoutKind;
  seats: (count: number) => boolean;
  sizes: (count: number) => number[];
  walk: readonly [number, number];
  masses?: { forest: number; rock: number; water: number };
  layout: Layout;
};
const duel = (count: number) => count === 2;
const four = (count: number) => count === 4;
const IDEAS: Record<MapIdea, IdeaSpec> = {
  openRing: { kind: "ring", seats: () => true, sizes: (count) => sizesFor("ring", count), walk: WALK_SHARE, layout: openRing },
  openSides: { kind: "sides", seats: () => true, sizes: (count) => sizesFor("sides", count), walk: WALK_SHARE, layout: (field, players, teams, teamOrder) => sidesLayout(field, players, teams, teamOrder, "open") },
  fountainRing: { kind: "ring", seats: four, sizes: () => [STANDARD_MAP_SIZE + 1_024, STANDARD_MAP_SIZE + 1_536], walk: WALK_SHARE, layout: fountainRing },
  turtleIsle: { kind: "ring", seats: four, sizes: () => [STANDARD_MAP_SIZE + 512], walk: [0.54, 0.62], masses: { forest: 0.55, rock: 0.45, water: 0 }, layout: turtleIsle },
  twistedPaths: { kind: "ring", seats: four, sizes: () => [STANDARD_MAP_SIZE + 1_024, STANDARD_MAP_SIZE + 1_536], walk: [0.46, 0.52], masses: { forest: 0.85, rock: 0.15, water: 0 }, layout: twistedPaths },
  outerSea: { kind: "ring", seats: four, sizes: () => [STANDARD_MAP_SIZE + 1_024, STANDARD_MAP_SIZE + 1_536], walk: WALK_SHARE, layout: outerSea },
  oneMarket: { kind: "ring", seats: duel, sizes: () => [STANDARD_MAP_SIZE + 512, STANDARD_MAP_SIZE + 1_024], walk: WALK_SHARE, layout: oneMarket },
  floodedValley: { kind: "ring", seats: duel, sizes: () => [STANDARD_MAP_SIZE + 512, STANDARD_MAP_SIZE + 1_024], walk: [0.6, 0.7], masses: { forest: 0.5, rock: 0.5, water: 0 }, layout: floodedValley },
  hiddenHill: { kind: "ring", seats: duel, sizes: () => [STANDARD_MAP_SIZE + 512], walk: [0.5, 0.6], layout: hiddenHill },
  bridgeStand: { kind: "ring", seats: duel, sizes: () => [STANDARD_MAP_SIZE, STANDARD_MAP_SIZE + 512], walk: WALK_SHARE, layout: bridgeStand },
  deepJungle: { kind: "ring", seats: duel, sizes: () => [STANDARD_MAP_SIZE, STANDARD_MAP_SIZE + 512], walk: [0.36, 0.44], masses: { forest: 0.8, rock: 0.05, water: 0.15 }, layout: deepJungle },
  northIsles: { kind: "ring", seats: duel, sizes: () => [STANDARD_MAP_SIZE + 1_024, STANDARD_MAP_SIZE + 1_536], walk: WALK_SHARE, layout: northIsles },
  riverValley: { kind: "sides", seats: four, sizes: () => [STANDARD_MAP_SIZE + 1_024, STANDARD_MAP_SIZE + 1_536], walk: WALK_SHARE, layout: (field, players, teams, teamOrder) => sidesLayout(field, players, teams, teamOrder, "river") },
  twoShores: { kind: "sides", seats: four, sizes: () => [STANDARD_MAP_SIZE + 1_024, STANDARD_MAP_SIZE + 1_536], walk: WALK_SHARE, layout: (field, players, teams, teamOrder) => sidesLayout(field, players, teams, teamOrder, "strait") },
};
const FALLBACK: Record<GeneratedLayoutKind, MapIdea> = { ring: "openRing", sides: "openSides" };

export function generateMap(options: GeneratedLayoutOptions, players: PlayerId[], teams: Record<PlayerId, string>): GeneratedMap {
  const random = seededRandom(options.seed);
  const teamOrder = [...new Set(players.map((player) => teams[player] ?? player))];
  const teamSizes = teamOrder.map((team) => players.filter((player) => (teams[player] ?? player) === team).length);
  const evenTeams = teamOrder.length === 2 && teamSizes[0] === teamSizes[1] && teamSizes[0]! >= 2;
  const kind = options.kind ?? (options.idea ? IDEAS[options.idea].kind : evenTeams && random() < 1 / 3 ? "sides" : "ring");
  if (kind === "sides" && !evenTeams) throw new Error(`A sides layout needs two teams of the same size (two or more), not ${teamSizes.join(" and ")}`);
  const fitting = (Object.keys(IDEAS) as MapIdea[]).filter((idea) => IDEAS[idea].kind === kind && idea !== FALLBACK[kind] && IDEAS[idea].seats(players.length));
  const idea = options.idea ?? (fitting.length > 0 ? pick(random, fitting) : FALLBACK[kind]);
  const spec = IDEAS[idea];
  if (spec.kind !== kind || !spec.seats(players.length)) throw new Error(`The ${idea} idea is not drawn as a ${kind} layout for ${players.length} players`);
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    // The last draws leave the land between the ways open: no mass or copse can cost a map its connection.
    const plain = attempt >= ATTEMPTS - 5;
    const field = new Field(random, options.size ?? pick(random, spec.sizes(players.length)), kind, players.length, spec);
    if (!spec.layout(field, players, teams, teamOrder)) continue;
    const terrain = carveTerrain(field, plain);
    if (!terrain) continue;
    return assemble(kind, idea, field, players, terrain);
  }
  throw new Error(`No ${idea} map fits the seed ${options.seed} for ${players.length} players`);
}

function sizesFor(kind: GeneratedLayoutKind, count: number): number[] {
  if (kind === "sides") return count <= 4 ? [STANDARD_MAP_SIZE + 512, STANDARD_MAP_SIZE + 1_024] : [STANDARD_MAP_SIZE + 1_536, STANDARD_MAP_SIZE + 2_048];
  if (count <= 2) return [STANDARD_MAP_SIZE, STANDARD_MAP_SIZE + 512];
  if (count <= 4) return [STANDARD_MAP_SIZE + 512, STANDARD_MAP_SIZE + 1_024];
  // More players stand on a longer ring: the map grows with the square root of their number.
  const grown = Math.ceil((STANDARD_MAP_SIZE + 768) * Math.sqrt(count / 4) / 512) * 512;
  return [grown, grown + 512];
}

// A disk of ground kept open (a clearing, a plateau), its edge wobbling by `wobble` of its radius.
type Clearing = { at: Point; radius: number; wobble: number; plateau?: boolean };
// A path along its points, `half` wide either side: a way kept open (crossing what water it may by a ford, or a bridge),
// or a tree line.
type Path = { points: Point[]; half: number; wobble: number; bridge?: boolean };
// Water along its points, `half` wide either side (one point: a disk); a way crosses it where it is crossable. A shoal or a
// mud is laid the same way, over the land.
type Water = { points: Point[]; half: number; wobble: number; crossable?: boolean };
type Disk = { at: Point; radius: number };
// Where a beach meets the water, and the way out onto it.
type Shore = { at: Point; out: Point };
type Plateau = { base: Point; radius: number; ramp: Point; rampRadius: number; main: boolean };

// Everything placed so far, and whether a feature with all its copies keeps its distances from it.
class Field {
  readonly starts = new Map<PlayerId, { base: Point; mine: Point }>();
  readonly bases: Point[] = [];
  readonly mains: Point[] = [];
  readonly mines: Point[] = [];
  readonly rich: Point[] = [];
  readonly camps: Camp[] = [];
  readonly mercs: { at: Point; kind: MercenaryUnitKind }[] = [];
  readonly sites: { kind: "shop"; at: Point }[] = [];
  readonly clearings: Clearing[] = [];
  readonly paths: Path[] = [];
  readonly walls: Path[] = [];
  // Every plateau (a start's main, a hill) and the foot of a way up it; a hill has one entry a ramp.
  readonly plateaus: Plateau[] = [];
  // Ground that stays open whatever is drawn on it (a start, a mine and its hall, a camp, a post).
  readonly reserved: Disk[] = [];
  // The idea's water (see @@@generated-water): deep water, the depth of the sea along the map's edge, land raised in it that
  // walks join (a home island, a lake's island crossed to), islands only a ship reaches, and every start's shore.
  readonly waters: Water[] = [];
  coast = 0;
  readonly lands: Disk[] = [];
  readonly islands: Disk[] = [];
  readonly shores: Shore[] = [];
  // Ground the idea floods shallow (but its ways and clearings, which stay dry), lays with mud, or walls off: forest or rock
  // over a polygon, or in a ring round a point (its ways through left open).
  readonly shoals: Water[] = [];
  readonly muds: Water[] = [];
  readonly blocks: Point[][] = [];
  readonly rings: { at: Point; inner: number; outer: number }[] = [];
  // The rocks and gates across shortcuts (see @@@generated-obstacles), each with the way's direction where it stands.
  readonly obstacles: { kind: ObstacleKind; at: Point; along: Point }[] = [];
  // The draws a map makes once for every copy of a feature.
  readonly easyKinds: UnitKind[];
  readonly mediumKinds: UnitKind[];
  readonly strongKinds: UnitKind[];
  readonly hardKinds: UnitKind[];
  readonly minorItem: ItemKind;
  readonly majorItem: ItemKind;
  readonly mercKind: MercenaryUnitKind;
  readonly theme: Theme;
  readonly walkShare: number;
  readonly noiseSeed: number;
  readonly center: number;
  // All the copies of a point under the map's symmetry, and the one copy a point stands for (see Symmetry).
  symmetry: Symmetry = { copies: (point) => [point], canonical: (point) => point };

  constructor(
    readonly random: () => number,
    readonly size: number,
    readonly kind: GeneratedLayoutKind,
    readonly count: number,
    readonly spec: IdeaSpec,
  ) {
    this.center = size / 2;
    this.easyKinds = pick(random, CAMP_KINDS.easy);
    this.mediumKinds = pick(random, CAMP_KINDS.medium);
    this.strongKinds = pick(random, CAMP_KINDS.strong);
    this.hardKinds = pick(random, CAMP_KINDS.hard);
    this.minorItem = pick(random, MINOR_ITEMS);
    this.majorItem = pick(random, MAJOR_ITEMS);
    this.mercKind = pick(random, MERC_KINDS);
    const theme = pick(random, THEMES);
    this.theme = spec.masses ? { ...theme, ...spec.masses } : theme;
    this.walkShare = this.between(spec.walk[0], spec.walk[1]);
    this.noiseSeed = Math.floor(random() * 2_147_483_647);
  }

  between(low: number, high: number) {
    return low + this.random() * (high - low);
  }

  copies(point: Point) {
    return this.symmetry.copies(point).map(roundPoint);
  }

  inside(points: Point[], margin: number) {
    return points.every((point) => point.x >= margin && point.y >= margin && point.x <= this.size - margin && point.y <= this.size - margin);
  }

  // A mine's copies: apart from every mine and from one another, at least `fromMains` from every main mine and
  // `fromStarts` from every start.
  mineFits(copies: Point[], fromStarts: number, fromMains = MINE_SPACING) {
    return this.inside(copies, 300) && apart(copies, MINE_SPACING) && copies.every((mine) => nearest(mine, this.mines) >= MINE_SPACING && nearest(mine, this.mains) >= fromMains && nearest(mine, this.bases) >= fromStarts && this.dry(mine, 230));
  }

  // A camp's copies: apart from every camp and from one another, off every mine but the one it guards, clear of the starts.
  campFits(copies: Point[], guarded: Point[], fromStarts: number) {
    return (
      this.inside(copies, 200) &&
      apart(copies, CAMP_SPACING) &&
      copies.every((camp) => nearest(camp, this.camps.map((other) => other.at)) >= CAMP_SPACING && nearest(camp, this.bases) >= fromStarts && nearest(camp, this.mercs.map((merc) => merc.at)) >= MERC_SPACING) &&
      copies.every((camp) => [...this.mains, ...this.mines].every((mine) => guarded.some((own) => own === mine) || distance(camp, mine) >= CAMP_MINE_SPACING)) &&
      copies.every((camp) => this.offPlateaus(camp, 150) && this.dry(camp, CAMP_SPREAD + 30))
    );
  }

  mercFits(copies: Point[]) {
    return (
      this.inside(copies, 200) &&
      apart(copies, MERC_SPACING) &&
      copies.every((merc) => nearest(merc, [...this.mains, ...this.mines]) >= MERC_SPACING && nearest(merc, this.camps.map((camp) => camp.at)) >= MERC_SPACING && nearest(merc, this.bases) >= CONTESTED_START_SPACING) &&
      copies.every((merc) => this.offPlateaus(merc, 150) && this.dry(merc, 150))
    );
  }

  // Whether ground `reach` round the point stays land: on raised land or an island, or off every water at its widest.
  dry(point: Point, reach: number) {
    if ([...this.lands, ...this.islands].some((land) => distance(point, land.at) + reach <= land.radius)) return true;
    return this.waterGap(point, true) >= reach;
  }

  // How far the point stands from the nearest water (negative inside it), the water's edge at its farthest wobble out when
  // `widest`; Infinity on a map without water.
  waterGap(point: Point, widest = false) {
    let gap = Infinity;
    for (const water of this.waters) gap = Math.min(gap, toPolyline(point, water.points) - water.half * (widest ? 1 + water.wobble : 1));
    if (this.coast > 0) gap = Math.min(gap, edgeGap(point, this.size) - this.coast * (widest ? 1 + SEA_WOBBLE : 1));
    return gap;
  }

  // Whether a way may pass the point `reach` wide: on raised land, or off every water but what it may cross.
  crossable(point: Point, reach: number) {
    if (this.lands.some((land) => distance(point, land.at) + reach <= land.radius)) return true;
    if (this.coast > 0 && edgeGap(point, this.size) < this.coast * (1 + SEA_WOBBLE) + reach) return false;
    return this.waters.every((water) => water.crossable || toPolyline(point, water.points) >= water.half * (1 + water.wobble) + reach);
  }

  // Whether ground `reach` around the point stays clear of every plateau.
  offPlateaus(point: Point, reach: number) {
    return this.plateaus.every((plateau) => distance(point, plateau.base) >= plateau.radius + reach + PLATEAU_MARGIN);
  }

  // Whether a path keeps off every plateau, and off all water but what it crosses unless it is the way down to a beach.
  pathFits(path: Path, toShore: boolean) {
    return (
      path.points.every((point) => this.plateaus.every((plateau) => distance(point, plateau.base) >= plateau.radius + path.half * 1.2 + PLATEAU_MARGIN)) &&
      (toShore || samplesAlong(path.points, TERRAIN_CELL * 1.5).every((point) => this.crossable(point, path.half * 1.2))) &&
      this.inside(path.points, path.half + 96)
    );
  }

  // Draws a feature up to TRIES times; the first draw whose copies fit is placed. Returns its copies, or nothing.
  place(draw: () => Point[], fits: (copies: Point[]) => boolean): Point[] | undefined {
    for (let attempt = 0; attempt < TRIES; attempt += 1) {
      const copies = draw().map(roundPoint);
      if (fits(copies)) return copies;
    }
    return undefined;
  }

  addCamps(copies: Point[], tier: CampTier, item?: ItemKind, color?: CampColor) {
    this.camps.push(...copies.map((at) => ({ at, tier, ...(item ? { item } : {}), ...(color ? { color } : {}) })));
    for (const at of copies) this.reserved.push({ at, radius: 110 });
  }

  // The mines and their guards: each guard GUARD_OFFSET from its mine toward `awayFrom`, or turned from that by up to 90
  // degrees either way where that crowds another camp (every copy turned alike); a guard that fits nowhere is left out.
  addGuardedMines(mines: Point[], tier: CampTier, awayFrom: (mine: Point, index: number) => Point, item?: ItemKind, color?: CampColor) {
    this.mines.push(...mines);
    // A hall stands within about 120 of its mine on any side the AI picks (see expansionOffset): the ground stays open.
    for (const at of mines) this.reserved.push({ at, radius: 230 });
    for (const turn of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) {
      const guards = mines.map((mine, index) => roundPoint(step(mine, rotate(unit(sub(awayFrom(mine, index), mine)), turn), GUARD_OFFSET)));
      if (!this.campFits(guards, mines, START_SAFETY + CAMP_SPREAD + 10)) continue;
      this.addCamps(guards, tier, item, color);
      return;
    }
  }

  // Islands with all their copies (one, where a copy falls on another), each in a bay of its own unless the water round
  // it is drawn already; returned for their mines.
  addIslands(at: Point, bay: boolean): Point[] {
    const copies = this.copies(at).filter((copy, index, all) => all.findIndex((other) => distance(other, copy) < 1) === index);
    for (const copy of copies) {
      if (bay) this.waters.push({ points: [copy], half: ISLAND_RADIUS + ISLAND_WATER, wobble: 0.08 });
      this.islands.push({ at: copy, radius: ISLAND_RADIUS });
    }
    return copies;
  }

  // An island's mine behind a red guard, toward `toward` (or turned from it): the prize a ship reaches.
  addIslandMines(mines: Point[], toward: Point) {
    this.addGuardedMines(mines, "strong", () => toward, undefined, "red");
  }

  // A hill that is no start's: a plateau of `radius` round the point, walled by its cliff but for a ramp toward each of
  // `toward`, each with a way up kept open from inside it out to its foot, which is returned (a way joins the hill there).
  addHill(at: Point, radius: number, toward: Point[]): Point[] {
    this.clearings.push({ at, radius, wobble: 0.06, plateau: true });
    return toward.map((target) => this.addRamp(at, radius, target, 120, 90));
  }

  // A ramp `rampRadius` wide up the hill round `at` toward `target`, its way `half` wide kept open from inside the hill out
  // to its foot, which is returned.
  addRamp(at: Point, radius: number, target: Point, rampRadius: number, half: number): Point {
    const direction = unit(sub(target, at));
    const ramp = roundPoint(step(at, direction, radius * 0.95));
    const foot = roundPoint(step(at, direction, radius + 280));
    this.plateaus.push({ base: at, radius, ramp, rampRadius, main: false });
    this.paths.push({ points: [roundPoint(step(at, direction, radius * 0.45)), ramp, foot], half, wobble: 0.12 });
    return foot;
  }

  // Rocks or a gate at every copy of the point (one, where copies fall together), across the way running along `along`.
  addObstacles(kind: ObstacleKind, at: Point, along: Point) {
    const ahead = this.symmetry.copies(step(at, along, 100));
    this.symmetry.copies(at).forEach((copy, index) => {
      if (this.obstacles.some((other) => distance(other.at, copy) < 1)) return;
      this.obstacles.push({ kind, at: roundPoint(copy), along: unit(sub(ahead[index]!, copy)) });
    });
  }

  // A path from `from` to `to`, bowed sideways by `bend` of its length (or the other way, or straight, where that bow
  // crowds a plateau or the water; with water on the map wider bows too, round its lobes and bays), with all its copies;
  // round water in the middle where no bow keeps off it (see roundSea). Returns the first copy's points, or nothing where no
  // way fits. A way across crossable water crosses by a bridge where `bridge` is set, else by a ford.
  addPath(from: Point, to: Point, half: number, bend: number, toShore = false, bridge = false): Point[] | undefined {
    const watery = this.waters.length > 0 || this.coast > 0;
    const ways = [bend, -bend, bend / 2, 0, ...(watery ? [0.4, -0.4, 0.6, -0.6] : [])].map((bow) => curve(from, to, bow));
    const middle = { x: this.center, y: this.center };
    if (this.waters.some((water) => !water.crossable && distance(water.points[0]!, middle) < 1)) ways.push(roundSea(middle, from, to));
    for (const points of ways) {
      const copies = this.pathCopies(points, half);
      if (!copies.every((path) => this.pathFits(path, toShore))) continue;
      this.paths.push(...copies.map((path) => (bridge ? { ...path, bridge } : path)));
      return points;
    }
    return undefined;
  }

  pathCopies(points: Point[], half: number, wobble = 0.16): Path[] {
    const images = points.map((point) => this.symmetry.copies(point));
    return images[0]!.map((_, copy) => ({ points: images.map((image) => roundPoint(image[copy]!)), half, wobble }));
  }

  addClearings(copies: Point[], radius: number, wobble: number) {
    for (const at of copies) this.clearings.push({ at, radius, wobble });
  }

  // A shop at every copy of the point (one, where copies fall together), on ground kept open round it.
  addShops(at: Point) {
    const copies = this.copies(at).filter((copy, index, all) => all.findIndex((other) => distance(other, copy) < 1) === index);
    for (const copy of copies) {
      this.sites.push({ kind: "shop", at: copy });
      this.reserved.push({ at: copy, radius: 120 });
    }
  }

  // A beach for every start on the open water nearest `from` (its natural), with a way down to it: the nearest shore the way
  // reaches.
  addBeaches(from: Point, half: number, bend: number): boolean {
    for (const shore of shoresFrom(this, from)) {
      const beach = roundPoint(step(shore.at, shore.out, -BEACH_RADIUS * 0.6));
      if (!this.addPath(from, beach, half, bend, true)) continue;
      const ends = this.symmetry.copies(shore.at);
      const outs = this.symmetry.copies(step(shore.at, shore.out, 100));
      this.shores.push(...ends.map((at, copy) => ({ at: roundPoint(at), out: unit(sub(outs[copy]!, at)) })));
      this.addClearings(ends.map(roundPoint), BEACH_RADIUS, 0.1);
      for (const at of this.symmetry.copies(beach)) this.reserved.push({ at: roundPoint(at), radius: BEACH_RADIUS * 0.6 });
      return true;
    }
    return false;
  }
}

// @@@generated-symmetry - The copies of a point (one per player on a ring, one per side) and the copy a point stands
// for (for the noise that wobbles every edge, so the copies wobble alike). `orbit`, where the symmetry maps cells onto
// cells, gives every cell's images, so the grid can be made exactly the same from every start.
type Symmetry = {
  copies: (point: Point) => Point[];
  canonical: (point: Point) => Point;
  orbit?: (col: number, row: number, cells: number) => [number, number][];
};

function ringSymmetry(size: number, count: number, firstAngle: number): Symmetry {
  const center = size / 2;
  const turn = (Math.PI * 2) / count;
  const turnAround = (point: Point, angle: number): Point => {
    const offset = rotate(sub(point, { x: center, y: center }), angle);
    return { x: center + offset.x, y: center + offset.y };
  };
  const quarter = count === 4;
  const half = count === 2;
  // The first slot's wedge, between these two headings (no atan2: it rounds differently on different machines), and the
  // turn back from every slot's wedge, worked out once.
  const low = heading(firstAngle - turn / 2);
  const high = heading(firstAngle + turn / 2);
  const inFirstWedge = (x: number, y: number) => (count === 2 ? low.x * y - low.y * x >= 0 : low.x * y - low.y * x >= 0 && x * high.y - y * high.x > 0);
  const backs = Array.from({ length: count }, (_, slot) => heading(-slot * turn));
  return {
    copies: (point) => Array.from({ length: count }, (_, slot) => turnAround(point, slot * turn)),
    canonical: (point) => {
      // A quarter or half turn maps the map onto itself exactly: the copy farthest up-left stands for all.
      if (quarter) return firstOf([point, { x: size - point.y, y: point.x }, { x: size - point.x, y: size - point.y }, { x: point.y, y: size - point.x }]);
      if (half) return firstOf([point, { x: size - point.x, y: size - point.y }]);
      const ox = point.x - center;
      const oy = point.y - center;
      for (const back of backs) {
        const x = ox * back.x - oy * back.y;
        const y = ox * back.y + oy * back.x;
        if (inFirstWedge(x, y)) return { x: center + x, y: center + y };
      }
      return point;
    },
    ...(quarter
      ? {
          orbit: (col: number, row: number, cells: number): [number, number][] => [
            [col, row],
            [cells - 1 - row, col],
            [cells - 1 - col, cells - 1 - row],
            [row, cells - 1 - col],
          ],
        }
      : half
        ? { orbit: (col: number, row: number, cells: number): [number, number][] => [[col, row], [cells - 1 - col, cells - 1 - row]] }
        : {}),
  };
}

// The point farthest left (then up) of an exact symmetry's copies of one point.
function firstOf(copies: Point[]): Point {
  return copies.reduce((best, point) => (point.x < best.x || (point.x === best.x && point.y < best.y) ? point : best));
}

function mirrorSymmetry(size: number, quarter: boolean): Symmetry {
  const mirror = (point: Point): Point => (quarter ? { x: point.x, y: size - point.y } : { x: size - point.x, y: point.y });
  return {
    copies: (point) => [point, mirror(point)],
    canonical: (point) => firstOf([point, mirror(point)]),
    orbit: (col, row, cells) => [[col, row], quarter ? [col, cells - 1 - row] : [cells - 1 - col, row]],
  };
}

// @@@generated-ring - The players stand on a ring round the middle, an equal turn apart; teammates take neighbouring
// slots. One slot is drawn and turned round the middle for every player: its start `share` of the map's size out at
// `firstAngle` (no nearer the edge than its plateau and `edgeRoom`), and its main mine beside it.
type Ring = { base: Point; inward: Point; plateau: number; radius: number; turn: number; between: number; middle: Point; polar: (radius: number, angle: number) => Point };

function ringStarts(field: Field, players: PlayerId[], teams: Record<PlayerId, string>, teamOrder: string[], firstAngle: number, share: readonly [number, number], edgeRoom = 110): Ring {
  const SIZE = field.size;
  const CENTER = field.center;
  const count = Math.max(2, players.length);
  const turn = (Math.PI * 2) / count;
  field.symmetry = ringSymmetry(SIZE, count, firstAngle);
  const polar = (radius: number, angle: number): Point => ({ x: CENTER + detCos(angle) * radius, y: CENTER + detSin(angle) * radius });
  const ordered = [...players].sort((a, b) => teamOrder.indexOf(teams[a] ?? a) - teamOrder.indexOf(teams[b] ?? b));
  const plateau = field.between(500, 570);
  const reachCap = (CENTER - plateau - edgeRoom) / Math.max(Math.abs(detCos(firstAngle)), Math.abs(detSin(firstAngle)));
  const radius = Math.min(SIZE * field.between(share[0], share[1]), reachCap);
  const base = roundPoint(polar(radius, firstAngle));
  const inward = heading(firstAngle + Math.PI);
  const mineSide = field.random() < 0.5 ? -1 : 1;
  const mine = roundPoint(step(base, rotate(inward, mineSide * field.between(1.05, 1.65)), 230));
  field.copies(base).forEach((start, slot) => {
    field.bases.push(start);
    if (ordered[slot]) field.starts.set(ordered[slot]!, { base: start, mine: field.copies(mine)[slot]! });
  });
  field.mains.push(...field.copies(mine));
  for (const at of field.bases) field.reserved.push({ at, radius: 300 });
  for (const at of field.mains) field.reserved.push({ at, radius: 150 });
  return { base, inward, plateau, radius, turn, between: firstAngle + turn / 2, middle: { x: CENTER, y: CENTER }, polar };
}

// @@@generated-main - A start's main: a plateau round it (a core and three lobes, one reaching toward the ramp) walled by
// its cliff and, outside that, by forest all round but at its ramp (see Grid.skirts); the natural at the ramp's foot behind
// a medium guard, `spread` turned from `inward` either way, tucked by its own main and well away from every other start and
// natural (naturals halfway to the middle stood 900 apart, so a neighbour's army was always by one's guard and the natural
// never got taken). Returns the natural's clearing, where the ways out begin.
function standardMain(field: Field, base: Point, inward: Point, plateau: number, spread: readonly [number, number] = [0.3, 1.6]): Point | undefined {
  const own = field.copies(base);
  const natural = field.place(
    () => field.copies(step(base, rotate(inward, (field.random() < 0.5 ? -1 : 1) * field.between(spread[0], spread[1])), plateau + field.between(290, 400))),
    (mines) =>
      field.mineFits(mines, 600, NATURAL_MAIN_SPACING) &&
      apart(mines, NATURAL_SPACING) &&
      mines.every((at, copy) => field.bases.every((other) => distance(other, own[copy]!) < 1 || distance(at, other) >= NATURAL_SPACING + 100)),
  );
  if (!natural) return undefined;
  const away = unit(sub(natural[0]!, base));
  const naturalArea = roundPoint(step(natural[0]!, away, field.between(40, 110)));
  const rampDirection = rotate(unit(sub(naturalArea, base)), field.between(-0.25, 0.25));
  const lobes = plateauLobes(field, base, rampDirection, plateau);
  const ramp = step(base, rampDirection, plateau * 0.95);
  const rampHalf = field.between(85, 115);
  own.forEach((at, copy) => field.plateaus.push({ base: at, radius: plateau, ramp: field.copies(ramp)[copy]!, rampRadius: rampHalf + 48, main: true }));
  for (const lobe of lobes) for (const at of field.copies(lobe.at)) field.clearings.push({ at, radius: lobe.radius, wobble: 0.08, plateau: true });
  field.addClearings(field.copies(naturalArea), field.between(320, 400), 0.1);
  field.addGuardedMines(natural, "medium", (at, copy) => mirrorAway(at, own[copy]!));
  // The way down: from inside the plateau, over the rim at the ramp, to the natural's clearing.
  field.paths.push(...field.pathCopies([step(base, rampDirection, plateau * 0.55), ramp, naturalArea], rampHalf));
  return naturalArea;
}

// The mine contested with the next start, behind a strong guard with a minor item: `share` of the start's reach out, within
// `spread` of a turn either side of the heading between them. Returns it and its copy behind (contested with the start
// before).
function contestedMines(field: Field, ring: Ring, spread: number, share: readonly [number, number] = [0.5, 0.95]): { ahead: Point; behind: Point } | undefined {
  const contested = field.place(
    () => field.copies(ring.polar(ring.radius * field.between(share[0], share[1]), ring.between + field.between(-spread, spread) * ring.turn)),
    (mines) => field.mineFits(mines, CONTESTED_START_SPACING) && mines.every((at) => field.offPlateaus(at, 330)),
  );
  if (!contested) return undefined;
  field.addClearings(contested, field.between(280, 340), 0.12);
  field.addGuardedMines(contested, "strong", () => ring.middle, field.minorItem);
  return { ahead: contested[0]!, behind: contested[contested.length - 1]! };
}

// Easy camps in clearings beside the paths out of the natural, and a mercenary post in a clearing beside `postPath`.
function homeCampsAndPost(field: Field, paths: Point[][], postPath: Point[] | undefined) {
  for (const path of paths) {
    const easy = field.place(() => field.copies(besidePath(path, field.between(0.3, 0.6), (field.random() < 0.5 ? -1 : 1) * field.between(40, 170))), (camps) => field.campFits(camps, [], 600));
    if (!easy) continue;
    field.addClearings(easy, field.between(130, 170), 0.15);
    field.addCamps(easy, "easy");
  }
  if (!postPath) return;
  const merc = field.place(() => field.copies(besidePath(postPath, field.between(0.35, 0.8), (field.random() < 0.5 ? -1 : 1) * field.between(150, 230))), (posts) => field.mercFits(posts));
  if (!merc) return;
  field.addClearings(merc, 150, 0.12);
  field.mercs.push(...merc.map((at) => ({ at, kind: field.mercKind })));
  for (const at of merc) field.reserved.push({ at, radius: 100 });
}

// A tree line between every two neighbours, from beyond the map's edge in to `reach` from the middle.
function neighbourWalls(field: Field, ring: Ring, reach: number) {
  const edge = field.center / Math.max(Math.abs(detCos(ring.between)), Math.abs(detSin(ring.between)));
  if (edge > reach) field.walls.push(...field.pathCopies(curve(ring.polar(edge + 160, ring.between), ring.polar(reach, ring.between), field.between(-0.12, 0.12)), field.between(48, 84), 0.35));
}

const width = (field: Field) => field.between(70, 120);
const bend = (field: Field) => field.between(-0.22, 0.22);

// @@@idea-open-ring - The plain ladder map, on open ground: every start's natural, a mine contested with each neighbour,
// a tree line between them, the middle's hard camp over a mine on some maps. Drawn for seats no other idea takes.
function openRing(field: Field, players: PlayerId[], teams: Record<PlayerId, string>, teamOrder: string[]): boolean {
  const count = Math.max(2, players.length);
  const turn = (Math.PI * 2) / count;
  const offsetRoll = field.random();
  const ring = ringStarts(field, players, teams, teamOrder, offsetRoll < 0.35 ? 0 : offsetRoll < 0.7 ? turn / 2 : field.random() * turn, [0.31, 0.37]);
  const naturalArea = standardMain(field, ring.base, ring.inward, ring.plateau);
  if (!naturalArea) return false;
  const contested = contestedMines(field, ring, 0.12);
  if (!contested) return false;
  const { middle } = ring;
  field.clearings.push({ at: middle, radius: field.between(300, 480), wobble: 0.14 });
  if (field.random() < 0.5 && field.mineFits([middle], CONTESTED_START_SPACING)) field.addGuardedMines([middle], "hard", () => ring.polar(1, ring.between), field.majorItem);
  else if (field.campFits([middle], [], CONTESTED_START_SPACING)) field.addCamps([middle], "hard", field.majorItem);
  const toAhead = field.addPath(naturalArea, contested.ahead, width(field), bend(field));
  const toBehind = field.addPath(naturalArea, contested.behind, width(field), bend(field));
  if (!toAhead || !toBehind) return false;
  const roll = field.random();
  const fromNatural = roll < 0.75 ? field.addPath(naturalArea, middle, width(field), bend(field)) : undefined;
  const fromContested = roll >= 0.45 || !fromNatural ? field.addPath(contested.ahead, middle, width(field), bend(field)) : undefined;
  const toMiddle = fromNatural ?? fromContested;
  if (!toMiddle) return false;
  const route = field.place(() => field.copies(besidePath(toMiddle, field.between(0.4, 0.7), field.between(-50, 50))), (camps) => field.campFits(camps, [], CONTESTED_START_SPACING));
  if (route) field.addCamps(route, "strong");
  homeCampsAndPost(field, [toAhead, toBehind], pick(field.random, [toMiddle, toAhead]));
  neighbourWalls(field, ring, distance(contested.ahead, middle));
  return true;
}

// @@@idea-fountain-ring - Lost Temple's: a ring of mines round a temple in the middle. Four starts on the edges; between
// every two a mine (the ring), and in the corner past it a bay with an island mine only a ship reaches; in the middle a
// temple on a hill, a ramp toward every gap between neighbours, held by the hard camp with the best item, and a shop on
// the ring between the temple and every contested mine. Expand quickly, or be crushed.
function fountainRing(field: Field, players: PlayerId[], teams: Record<PlayerId, string>, teamOrder: string[]): boolean {
  const ring = ringStarts(field, players, teams, teamOrder, 0, [0.36, 0.39]);
  const { middle, polar, between } = ring;
  const SIZE = field.size;
  for (const bay of field.copies(polar(SIZE * field.between(0.57, 0.6), between))) {
    field.waters.push({ points: [bay], half: SIZE * field.between(0.12, 0.135), wobble: 0.1 });
    field.islands.push({ at: bay, radius: ISLAND_RADIUS });
  }
  if (!field.dry(ring.base, ring.plateau + 150)) return false;
  const naturalArea = standardMain(field, ring.base, ring.inward, ring.plateau);
  if (!naturalArea) return false;
  const temple = SIZE * field.between(0.055, 0.065);
  const feet = field.addHill(middle, temple, field.copies(polar(temple * 2, between)));
  field.addCamps([middle], "hard", field.majorItem);
  const contested = contestedMines(field, ring, 0.04, [0.74, 0.82]);
  if (!contested) return false;
  field.addIslandMines(field.islands.map((island) => island.at), middle);
  field.addShops(polar(SIZE * field.between(0.18, 0.2), between));
  const toAhead = field.addPath(naturalArea, contested.ahead, width(field), bend(field));
  const toBehind = field.addPath(naturalArea, contested.behind, width(field), bend(field));
  const toTemple = field.addPath(naturalArea, feet[0]!, width(field), bend(field));
  if (!toAhead || !toBehind || !toTemple) return false;
  homeCampsAndPost(field, [toAhead, toBehind], toTemple);
  return field.addBeaches(naturalArea, width(field), bend(field));
}

// @@@idea-turtle-isle - Turtle Rock's: a small map with an island in a lake in the middle, the richest mine on it behind the
// hardest camp, every start's causeway a ford across to it. The starts in the corners; the mines at the edges' middles
// (between every two neighbours) stand in rings of trees with two ways in, behind strong guards: few easy camps, and every
// expansion is hard to take.
function turtleIsle(field: Field, players: PlayerId[], teams: Record<PlayerId, string>, teamOrder: string[]): boolean {
  const ring = ringStarts(field, players, teams, teamOrder, Math.PI / 4, [0.46, 0.5]);
  const { middle, polar, between } = ring;
  const SIZE = field.size;
  const island = SIZE * field.between(0.075, 0.085);
  field.waters.push({ points: [middle], half: island + SIZE * field.between(0.07, 0.08), wobble: 0.1, crossable: true });
  field.lands.push({ at: middle, radius: island });
  if (!field.dry(ring.base, ring.plateau + 150)) return false;
  const naturalArea = standardMain(field, ring.base, ring.inward, ring.plateau);
  if (!naturalArea) return false;
  field.rich.push(middle);
  field.addGuardedMines([middle], "hard", () => polar(1, between), field.majorItem);
  const side = field.place(() => field.copies(polar(SIZE * field.between(0.36, 0.4), between)), (mines) => field.mineFits(mines, CONTESTED_START_SPACING));
  if (!side) return false;
  field.addClearings(side, 260, 0.08);
  field.addGuardedMines(side, "strong", () => middle, field.minorItem);
  for (const at of side) field.rings.push({ at, inner: 330, outer: field.between(420, 470) });
  const toAhead = field.addPath(naturalArea, side[0]!, width(field), bend(field));
  const toBehind = field.addPath(naturalArea, side[side.length - 1]!, width(field), bend(field));
  const causeway = field.addPath(naturalArea, middle, field.between(80, 100), field.between(-0.1, 0.1));
  if (!toAhead || !toBehind || !causeway) return false;
  homeCampsAndPost(field, [toAhead], undefined);
  return true;
}

// @@@idea-twisted-paths - Twisted Meadows': the ways twist between thick woods; in every corner between neighbours a small
// island with a mine only a ship reaches, highly secure once taken; the middle a race for the best item behind the hard
// camp, with a shop beside it.
function twistedPaths(field: Field, players: PlayerId[], teams: Record<PlayerId, string>, teamOrder: string[]): boolean {
  const ring = ringStarts(field, players, teams, teamOrder, field.between(0.15, 0.35), [0.33, 0.37]);
  const { middle, polar, between } = ring;
  const SIZE = field.size;
  const corner = field.center / Math.max(Math.abs(detCos(between)), Math.abs(detSin(between)));
  field.addIslands(polar(corner - ISLAND_RADIUS - 140, between), true);
  if (!field.dry(ring.base, ring.plateau + 150)) return false;
  const naturalArea = standardMain(field, ring.base, ring.inward, ring.plateau);
  if (!naturalArea) return false;
  field.addIslandMines(field.islands.map((island) => island.at), middle);
  const contested = contestedMines(field, ring, 0.18, [0.45, 0.75]);
  if (!contested) return false;
  field.clearings.push({ at: middle, radius: field.between(320, 400), wobble: 0.14 });
  field.addCamps([middle], "hard", field.majorItem);
  field.addShops(polar(SIZE * field.between(0.08, 0.1), ring.between));
  const twist = () => (field.random() < 0.5 ? -1 : 1) * field.between(0.3, 0.45);
  const narrow = () => field.between(60, 85);
  const toAhead = field.addPath(naturalArea, contested.ahead, narrow(), twist());
  const toBehind = field.addPath(naturalArea, contested.behind, narrow(), twist());
  const toMiddle = field.addPath(contested.ahead, middle, narrow(), twist());
  if (!toAhead || !toBehind || !toMiddle) return false;
  homeCampsAndPost(field, [toAhead, toBehind], toMiddle);
  return field.addBeaches(naturalArea, narrow(), twist());
}

// @@@idea-outer-sea - A sea all round the map's edge, a bay between every two neighbours with an island mine in it, so a
// fleet sails round to any start's back; the land in the middle is the open ring's.
function outerSea(field: Field, players: PlayerId[], teams: Record<PlayerId, string>, teamOrder: string[]): boolean {
  const coast = field.size * field.between(0.07, 0.09);
  const ring = ringStarts(field, players, teams, teamOrder, field.random() < 0.5 ? 0 : Math.PI / 4, [0.33, 0.38], coast * (1 + SEA_WOBBLE) + 160);
  const { middle, polar, between } = ring;
  field.coast = coast;
  const edge = field.center / Math.max(Math.abs(detCos(between)), Math.abs(detSin(between)));
  field.addIslands(polar(edge - ISLAND_RADIUS - 110, between), true);
  if (!field.dry(ring.base, ring.plateau + 150)) return false;
  const naturalArea = standardMain(field, ring.base, ring.inward, ring.plateau);
  if (!naturalArea) return false;
  field.addIslandMines(field.islands.map((island) => island.at), middle);
  const contested = contestedMines(field, ring, 0.12, [0.45, 0.75]);
  if (!contested) return false;
  field.clearings.push({ at: middle, radius: field.between(300, 420), wobble: 0.14 });
  field.addCamps([middle], "hard", field.majorItem);
  field.addShops(polar(field.size * field.between(0.07, 0.09), ring.between + ring.turn / 2));
  const toAhead = field.addPath(naturalArea, contested.ahead, width(field), bend(field));
  const toBehind = field.addPath(naturalArea, contested.behind, width(field), bend(field));
  const toMiddle = field.addPath(naturalArea, middle, width(field), bend(field));
  if (!toAhead || !toBehind || !toMiddle) return false;
  homeCampsAndPost(field, [toAhead, toBehind], toMiddle);
  return field.addBeaches(naturalArea, width(field), bend(field));
}

// @@@idea-one-market - Echo Isles': two big isles in deep water, shallow causeways between them, and the map's only shop on
// a small isle in the middle that both causeways cross to: who holds the middle holds the shop. Each start's natural is near
// and lightly held; few camps, the middle's fought over.
function oneMarket(field: Field, players: PlayerId[], teams: Record<PlayerId, string>, teamOrder: string[]): boolean {
  const SIZE = field.size;
  const coast = SIZE * field.between(0.05, 0.065);
  const ring = ringStarts(field, players, teams, teamOrder, (Math.PI * 5) / 4, [0.4, 0.46], coast * (1 + SEA_WOBBLE) + 160);
  const { middle, polar, between } = ring;
  field.coast = coast;
  const channel = polar(SIZE, between);
  field.waters.push({ points: [channel, middle, field.copies(channel)[1]!], half: SIZE * field.between(0.055, 0.07), wobble: 0.14, crossable: true });
  const isle = SIZE * field.between(0.045, 0.055);
  field.lands.push({ at: middle, radius: isle });
  if (!field.dry(ring.base, ring.plateau + 150)) return false;
  const naturalArea = standardMain(field, ring.base, ring.inward, ring.plateau, [0.3, 0.9]);
  if (!naturalArea) return false;
  field.addShops(middle);
  const own = field.place(() => field.copies(polar(SIZE * field.between(0.18, 0.26), ring.between - ring.turn / 2 + field.between(0.35, 0.55))), (mines) => field.mineFits(mines, CONTESTED_START_SPACING));
  if (!own) return false;
  field.addClearings(own, 280, 0.12);
  field.addGuardedMines(own, "strong", () => middle, field.minorItem);
  const watch = field.place(() => field.copies(polar(SIZE * field.between(0.2, 0.25), ring.between + field.between(0.45, 0.75))), (camps) => field.campFits(camps, [], CONTESTED_START_SPACING));
  if (watch) {
    field.addClearings(watch, 160, 0.12);
    field.addCamps(watch, "strong", field.minorItem);
  }
  const causeway = field.addPath(naturalArea, middle, field.between(80, 100), field.between(-0.15, 0.15));
  const toMine = field.addPath(naturalArea, own[0]!, width(field), bend(field));
  if (!causeway || !toMine) return false;
  homeCampsAndPost(field, [toMine], causeway);
  return field.addBeaches(naturalArea, width(field), bend(field));
}

// @@@idea-flooded-valley - Secret Valley's and Melting Valley's: the valley floor between the starts lies under shallow
// water, slow to wade and a bad place to be caught; the ways across are dry ridges, the mines stand on dry rises in the
// flood, and mud lies at its edges. Its creeps are the water's.
function floodedValley(field: Field, players: PlayerId[], teams: Record<PlayerId, string>, teamOrder: string[]): boolean {
  const ring = ringStarts(field, players, teams, teamOrder, -Math.PI / 2, [0.33, 0.37]);
  const { middle, polar, between } = ring;
  const SIZE = field.size;
  const naturalArea = standardMain(field, ring.base, ring.inward, ring.plateau, [0.4, 1.2]);
  if (!naturalArea) return false;
  const reach = SIZE * field.between(0.15, 0.19);
  const flood = [polar(SIZE * field.between(0.2, 0.26), between), middle, polar(SIZE * field.between(0.2, 0.26), between + Math.PI)].map(roundPoint);
  field.shoals.push({ points: flood, half: reach, wobble: 0.25 });
  for (const at of field.copies(polar(SIZE * field.between(0.24, 0.3), ring.between - ring.turn / 2 + field.between(0.5, 0.9)))) field.muds.push({ points: [at], half: field.between(180, 260), wobble: 0.3 });
  const contested = contestedMines(field, ring, 0.25, [0.25, 0.6]);
  if (!contested) return false;
  field.clearings.push({ at: middle, radius: 220, wobble: 0.1 });
  field.addCamps([middle], "hard", field.majorItem);
  const toAhead = field.addPath(naturalArea, contested.ahead, field.between(60, 90), bend(field));
  const toBehind = field.addPath(naturalArea, contested.behind, field.between(60, 90), bend(field));
  const toMiddle = field.addPath(contested.ahead, middle, field.between(60, 80), bend(field));
  if (!toAhead || !toBehind || !toMiddle) return false;
  homeCampsAndPost(field, [toAhead, toBehind], toMiddle);
  return true;
}

// @@@idea-hidden-hill - Concealed Hill's: an H. The starts at either end of the two long strips, joined by a crossbar
// through the middle; in the middle of the crossbar a hill hidden in a ring of woods, a ramp up from either end of the
// crossbar, holding a mine and a shop for whoever makes it a fortress, and a narrow back way up it from either start's
// side through the woods, shut by a stone gate. The far end of every strip holds a mine as near to one start as to the
// other.
function hiddenHill(field: Field, players: PlayerId[], teams: Record<PlayerId, string>, teamOrder: string[]): boolean {
  const ring = ringStarts(field, players, teams, teamOrder, (Math.PI * 5) / 4, [0.47, 0.5]);
  const { middle } = ring;
  const SIZE = field.size;
  const bar = SIZE * field.between(0.12, 0.14);
  const strip = SIZE * field.between(0.29, 0.32);
  for (const block of [
    [{ x: strip, y: -10 }, { x: SIZE - strip, y: -10 }, { x: SIZE - strip, y: field.center - bar }, { x: strip, y: field.center - bar }],
    [{ x: strip, y: SIZE + 10 }, { x: SIZE - strip, y: SIZE + 10 }, { x: SIZE - strip, y: field.center + bar }, { x: strip, y: field.center + bar }],
  ]) field.blocks.push(block.map(roundPoint));
  const naturalArea = standardMain(field, ring.base, { x: 0, y: 1 }, ring.plateau, [0, 0.5]);
  if (!naturalArea) return false;
  const hill = SIZE * field.between(0.06, 0.07);
  const feet = field.addHill(middle, hill, [{ x: 0, y: field.center }, { x: SIZE, y: field.center }]);
  field.rings.push({ at: middle, inner: hill + 40, outer: hill + field.between(170, 230) });
  // Its back ways: a narrow ramp up the hill's back from either forest, the way on through the forest down to the open
  // ground below the near main, shut by a gate inside the forest (see @@@generated-obstacles).
  const backs = field.copies({ x: field.center, y: 0 }).map((target) => field.addRamp(middle, hill, target, 56, 40));
  const back = field.addPath(backs[0]!, { x: strip - field.between(120, 200), y: field.center - bar - field.between(220, 360) }, 40, field.between(-0.12, 0.12));
  if (!back) return false;
  const gate = alongPath(back, 260);
  field.addObstacles("gate", gate.at, gate.along);
  // The hill's mine in its middle, a red camp at the head of either ramp, a shop to either side.
  field.mines.push(middle);
  field.reserved.push({ at: middle, radius: 200 });
  field.addCamps(field.copies({ x: middle.x - hill * 0.55, y: middle.y }), "strong", field.minorItem, "red");
  field.addShops({ x: middle.x, y: middle.y - hill * 0.6 });
  const far = field.place(() => field.copies({ x: strip * field.between(0.4, 0.6), y: SIZE * field.between(0.82, 0.88) }), (mines) => field.mineFits(mines, CONTESTED_START_SPACING));
  if (!far) return false;
  field.addClearings(far, 300, 0.12);
  field.addGuardedMines(far, "strong", () => middle, field.majorItem);
  const toHill = field.addPath(naturalArea, feet[0]!, width(field), field.between(-0.1, 0.1));
  const toFar = field.addPath(feet[0]!, far[0]!, width(field), field.between(-0.1, 0.1));
  if (!toHill || !toFar) return false;
  homeCampsAndPost(field, [toHill], toFar);
  return true;
}

// @@@idea-bridge-stand - Terenas Stand's: a small map, a river between the two starts crossed by two bridges, where the
// fights are, and by one narrow ford in the middle, shut by rocks. Every bank holds a mine by a bridge's far end, a shop by
// one bridge and a mercenary post by the other.
function bridgeStand(field: Field, players: PlayerId[], teams: Record<PlayerId, string>, teamOrder: string[]): boolean {
  const ring = ringStarts(field, players, teams, teamOrder, (Math.PI * 5) / 4, [0.39, 0.45]);
  const { middle, polar, between } = ring;
  const SIZE = field.size;
  const mouth = polar(SIZE, between);
  const river = [mouth, middle, field.copies(mouth)[1]!];
  field.waters.push({ points: river, half: field.between(110, 150), wobble: 0.2, crossable: true });
  if (!field.dry(ring.base, ring.plateau + 150)) return false;
  const naturalArea = standardMain(field, ring.base, ring.inward, ring.plateau, [0.4, 1.1]);
  if (!naturalArea) return false;
  const along = heading(between);
  const across = heading(between + Math.PI / 2);
  const crossing = step(middle, along, SIZE * field.between(0.17, 0.22));
  // Toward the other start: the first start is on the side `across` points away from.
  const far = step(crossing, across, 360);
  const near = step(crossing, across, -360);
  const mine = field.place(() => field.copies(step(step(crossing, across, field.between(560, 720)), along, field.between(-220, 220))), (mines) => field.mineFits(mines, CONTESTED_START_SPACING));
  if (!mine) return false;
  field.addClearings(mine, 280, 0.12);
  field.addGuardedMines(mine, "strong", () => crossing, field.minorItem);
  field.addShops(step(near, along, -260));
  const toBridge = field.addPath(naturalArea, near, width(field), bend(field));
  if (!toBridge || !field.addPath(near, far, field.between(70, 90), 0, false, true)) return false;
  // A third way over, straight across the middle by a narrow ford, shut by rocks in the river (see @@@generated-obstacles).
  if (!field.addPath(step(middle, across, -440), step(middle, across, 440), 26, 0)) return false;
  field.addObstacles("rocks", middle, across);
  const toMine = field.addPath(far, mine[0]!, width(field), 0);
  if (!toMine) return false;
  homeCampsAndPost(field, [toBridge], toBridge);
  return field.addBeaches(naturalArea, width(field), bend(field));
}

// @@@idea-deep-jungle - Amazonia's: a small map in a dark jungle, the ways narrow between dense trees and murky ponds, and
// in the middle a rich mine out in the open behind the hardest camp: the hardest expansion to take and to hold. Gates shut
// the straight ways in to it from the contested mines.
function deepJungle(field: Field, players: PlayerId[], teams: Record<PlayerId, string>, teamOrder: string[]): boolean {
  const ring = ringStarts(field, players, teams, teamOrder, -Math.PI / 4, [0.4, 0.46]);
  const { middle } = ring;
  const naturalArea = standardMain(field, ring.base, ring.inward, ring.plateau, [0.3, 1.2]);
  if (!naturalArea) return false;
  const heart = field.between(380, 460);
  field.clearings.push({ at: middle, radius: heart, wobble: 0.16 });
  field.rich.push(middle);
  field.addGuardedMines([middle], "hard", () => ring.polar(1, ring.between), field.majorItem);
  const contested = contestedMines(field, ring, 0.2, [0.45, 0.8]);
  if (!contested) return false;
  const narrow = () => field.between(55, 75);
  const toAhead = field.addPath(naturalArea, contested.ahead, narrow(), bend(field));
  const toBehind = field.addPath(naturalArea, contested.behind, narrow(), bend(field));
  const toMiddle = field.addPath(naturalArea, middle, narrow(), bend(field));
  if (!toAhead || !toBehind || !toMiddle) return false;
  // With no tree to cut, the jungle opens by its gates: a straight way from every contested mine to the middle, shut by a
  // gate halfway between the two clearings' edges (a draw with too little jungle between them for a gate is not kept, see
  // @@@generated-obstacles).
  const mineEdge = 340 * 1.12;
  const shortcut = field.addPath(contested.ahead, middle, 40, 0);
  if (!shortcut) return false;
  const gate = alongPath(shortcut, (mineEdge + distance(contested.ahead, middle) - heart * 1.16) / 2);
  field.addObstacles("gate", gate.at, gate.along);
  homeCampsAndPost(field, [toAhead, toBehind], toMiddle);
  return true;
}

// @@@idea-north-isles - Northern Isles': each start on a home island in a sea, with a third mine of its own on it; between
// the two homes an isle with the richest mine behind the hardest camp, joined to either home by a shallow neck an army
// wades a few abreast; out in the sea toward the other corners, islands with mines only a ship reaches.
function northIsles(field: Field, players: PlayerId[], teams: Record<PlayerId, string>, teamOrder: string[]): boolean {
  const SIZE = field.size;
  const ring = ringStarts(field, players, teams, teamOrder, (Math.PI * 5) / 4, [0.38, 0.42], 220);
  const { middle, polar, between } = ring;
  const firstAngle = between - ring.turn / 2;
  field.waters.push({ points: [middle], half: SIZE, wobble: 0, crossable: true });
  for (const at of field.copies(polar(ring.radius * field.between(0.78, 0.85), firstAngle))) field.lands.push({ at, radius: SIZE * field.between(0.23, 0.25) });
  field.lands.push({ at: middle, radius: SIZE * field.between(0.055, 0.065) });
  const corner = field.center / Math.max(Math.abs(detCos(between)), Math.abs(detSin(between)));
  field.addIslands(polar(corner * field.between(0.62, 0.7), between), true);
  if (!field.dry(ring.base, ring.plateau + 150)) return false;
  const naturalArea = standardMain(field, ring.base, ring.inward, ring.plateau, [0.3, 1.0]);
  if (!naturalArea) return false;
  field.addIslandMines(field.islands.map((island) => island.at), middle);
  field.rich.push(middle);
  field.addGuardedMines([middle], "hard", () => polar(1, between), field.majorItem);
  const third = field.place(() => field.copies(polar(ring.radius * field.between(0.5, 0.75), firstAngle + (field.random() < 0.5 ? -1 : 1) * field.between(0.45, 0.8))), (mines) => field.mineFits(mines, CONTESTED_START_SPACING));
  if (!third) return false;
  field.addClearings(third, 280, 0.12);
  field.addGuardedMines(third, "strong", () => middle, field.minorItem);
  const toThird = field.addPath(naturalArea, third[0]!, width(field), bend(field));
  const neck = field.addPath(naturalArea, middle, field.between(60, 80), field.between(-0.1, 0.1));
  if (!toThird || !neck) return false;
  homeCampsAndPost(field, [toThird], undefined);
  return field.addBeaches(naturalArea, width(field), bend(field));
}

// @@@generated-sides - Two teams of equal size face each other across the map, each along its edge, the halves mirrored.
// Every player has its main and its natural (see @@@generated-main), a tree line between teammates; half the maps turn the
// whole field a quarter, so the teams face top and bottom. What lies between the teams is the idea's:
// - open (@@@idea-open-sides): the contested mines down the middle line, one more than a side has players, the middle one
//   behind the hard camp;
// - river (@@@idea-river-valley, Gnoll Wood's): a river down the middle line, forded straight across from every natural and
//   bridged in the middle, hills on its banks with red camps on them, a shop on either bank, every player a third mine on
//   its own bank;
// - strait (@@@idea-two-shores): a strait down the middle line, forded straight across from every natural, its mines on
//   islands between the fords and at its ends, every player a third mine on its own bank.
function sidesLayout(field: Field, players: PlayerId[], teams: Record<PlayerId, string>, teamOrder: string[], middleKind: "open" | "river" | "strait"): boolean {
  const SIZE = field.size;
  const CENTER = field.center;
  const quarter = field.random() < 0.5;
  field.symmetry = mirrorSymmetry(SIZE, quarter);
  // A point of the left side before the turn, turned (and back: the turn is its own inverse).
  const place = (point: Point): Point => roundPoint(quarter ? { x: point.y, y: point.x } : point);
  const members = teamOrder.map((team) => players.filter((player) => (teams[player] ?? player) === team));
  const perSide = members[0]!.length;
  const plateau = field.between(480, 540);
  const margin = plateau + 130;
  if (middleKind === "strait") field.waters.push({ points: [place({ x: CENTER, y: -200 }), place({ x: CENTER, y: SIZE + 200 })], half: SIZE * field.between(0.04, 0.055), wobble: 0.15, crossable: true });
  if (middleKind === "river") field.waters.push({ points: [place({ x: CENTER, y: -200 }), place({ x: CENTER, y: SIZE + 200 })], half: field.between(110, 150), wobble: 0.2, crossable: true });
  // One side is drawn (the left, before any turn); the mirror gives the other.
  const own: { base: Point; area: Point }[] = [];
  for (let index = 0; index < perSide; index += 1) {
    const y = SIZE * (0.1 + ((index + 0.5) / perSide) * 0.8);
    const base = place({ x: margin, y });
    const mine = place({ x: margin - 150, y: y + (index % 2 === 0 ? -170 : 170) });
    own.push({ base, area: base });
    for (const [side, team] of members.entries()) {
      const player = team[index]!;
      field.starts.set(player, { base: side === 0 ? base : field.copies(base)[1]!, mine: side === 0 ? mine : field.copies(mine)[1]! });
    }
  }
  for (const { base } of own) {
    for (const at of field.copies(base)) {
      field.bases.push(at);
      field.reserved.push({ at, radius: 300 });
    }
  }
  for (const start of field.starts.values()) {
    field.mains.push(start.mine);
    field.reserved.push({ at: start.mine, radius: 150 });
  }
  const inward = unit(sub(place({ x: 1, y: 0 }), place({ x: 0, y: 0 })));
  for (const entry of own) {
    const area = standardMain(field, entry.base, inward, plateau, [0.2, 0.9]);
    if (!area) return false;
    entry.area = area;
  }
  const middle = { x: CENTER, y: CENTER };
  const along = (at: Point) => place({ x: CENTER, y: (quarter ? at.x : at.y) + 1 });
  // The fords straight across from every natural (on a river or a strait).
  const fords = own.map(({ area }) => place(area).y);
  const contested: Point[] = [];
  if (middleKind === "open") {
    const lines = Array.from({ length: perSide + 1 }, (_, index) => SIZE * (0.12 + ((index + 0.5) / (perSide + 1)) * 0.76));
    const middleLine = lines[Math.floor(lines.length / 2)]!;
    lines.forEach((y, index) => {
      const mine = place({ x: CENTER, y });
      if (!field.mineFits([mine], CONTESTED_START_SPACING)) return;
      contested.push(mine);
      field.clearings.push({ at: mine, radius: field.between(320, 400), wobble: 0.12 });
      field.addGuardedMines([mine], y === middleLine ? "hard" : "strong", along, y === middleLine ? field.majorItem : index === 0 ? field.minorItem : undefined);
    });
  }
  if (middleKind === "strait") {
    const lines = [ISLAND_RADIUS + 110, ...fords.slice(1).map((y, index) => (fords[index]! + y) / 2), SIZE - ISLAND_RADIUS - 110].filter((y) => fords.every((ford) => Math.abs(ford - y) >= 720));
    const middleLine = lines.reduce((best, y) => (Math.abs(y - CENTER) < Math.abs(best - CENTER) ? y : best), lines[0]!);
    for (const y of lines) {
      const mine = place({ x: CENTER, y });
      field.addIslands(mine, true);
      if (!field.mineFits([mine], CONTESTED_START_SPACING)) {
        field.islands.pop();
        field.waters.pop();
        continue;
      }
      field.addGuardedMines([mine], y === middleLine ? "hard" : "strong", along, y === middleLine ? field.majorItem : undefined, "red");
    }
  }
  if (middleKind === "river") {
    // Hills on either bank above and below the bridge, a ramp down toward their own side, a red camp on each.
    const hill = SIZE * field.between(0.04, 0.05);
    const off = SIZE * field.between(0.13, 0.16);
    for (const dy of [-1, 1]) {
      for (const at of field.copies(place({ x: CENTER - off, y: CENTER + dy * SIZE * field.between(0.12, 0.14) }))) {
        const bank = place({ x: CENTER, y: quarter ? at.x : at.y });
        field.addHill(at, hill, [mirrorAway(at, bank)]);
        field.addCamps([at], "hard", field.minorItem);
      }
    }
    field.addShops(place({ x: CENTER - SIZE * 0.24, y: CENTER }));
  }
  if (middleKind !== "open") {
    for (const { area } of own) {
      const from = place(area);
      const third = field.place(() => field.copies(place({ x: from.x + field.between(420, 640), y: from.y + field.between(-420, 420) })), (mines) => field.mineFits(mines, CONTESTED_START_SPACING));
      if (!third) return false;
      contested.push(third[0]!);
      field.addClearings(third, field.between(280, 340), 0.12);
      field.addGuardedMines(third, "strong", (at, copy) => mirrorAway(at, field.copies(area)[copy]!), field.minorItem);
    }
  }
  if (contested.length === 0) return false;
  // Every natural reaches the two mines nearest it (across water, its third and a ford straight across to the other bank;
  // a river is bridged in the middle too); neighbours on a side reach each other.
  const leads: Point[][] = [];
  for (const { area } of own) {
    const ford = place({ x: CENTER, y: place(area).y });
    const targets = middleKind === "open" ? [...contested].sort((a, b) => distance(a, area) - distance(b, area)).slice(0, 2) : [[...contested].sort((a, b) => distance(a, area) - distance(b, area))[0]!, ford];
    for (const [index, target] of targets.entries()) {
      const path = field.addPath(area, target, width(field), middleKind === "open" ? field.between(-0.2, 0.2) : 0);
      if (!path) return false;
      if (index === 0) leads.push(path);
    }
  }
  if (middleKind === "river" && !field.addPath(place({ x: CENTER - SIZE * 0.2, y: CENTER }), middle, field.between(80, 100), 0, false, true)) return false;
  for (let index = 1; index < own.length; index += 1) field.addPath(own[index - 1]!.area, own[index]!.area, width(field), field.between(-0.2, 0.2));
  for (const path of leads) {
    const easy = field.place(() => field.copies(besidePath(path, field.between(0.3, 0.6), (field.random() < 0.5 ? -1 : 1) * field.between(60, 170))), (camps) => field.campFits(camps, [], 600));
    if (!easy) continue;
    field.addClearings(easy, field.between(130, 170), 0.15);
    field.addCamps(easy, "easy");
  }
  const merc = field.place(() => field.copies(place({ x: SIZE * field.between(0.3, 0.4), y: SIZE * field.between(0.2, 0.8) })), (posts) => field.mercFits(posts));
  if (merc) {
    field.addClearings(merc, 170, 0.12);
    const landMines = contested.flatMap((mine) => field.copies(mine));
    for (const at of merc) {
      const target = [...landMines].sort((a, b) => distance(a, at) - distance(b, at))[0]!;
      field.paths.push({ points: curve(at, target, 0), half: 90, wobble: 0.16 });
    }
    field.mercs.push(...merc.map((at) => ({ at, kind: field.mercKind })));
    for (const at of merc) field.reserved.push({ at, radius: 100 });
  }
  if (middleKind !== "open" && !own.every(({ area }) => field.addBeaches(area, width(field), field.between(-0.2, 0.2)))) return false;
  // A tree line between every two teammates, from beyond the map's edge in to their plateaus' fronts.
  for (let index = 1; index < own.length; index += 1) {
    const y = (place(own[index - 1]!.base).y + place(own[index]!.base).y) / 2;
    field.walls.push(...field.pathCopies(curve(place({ x: -160, y }), place({ x: margin + plateau * 0.9, y }), field.between(-0.1, 0.1)), field.between(48, 84), 0.35));
  }
  return true;
}

// The shores nearest a point (one by each of 32 headings, out to 1800): where the water's edge is first met, nearest first,
// with a beach behind it off every plateau.
function shoresFrom(field: Field, from: Point): Shore[] {
  const found: (Shore & { reach: number })[] = [];
  for (let spoke = 0; spoke < 32; spoke += 1) {
    const out = heading((spoke / 32) * Math.PI * 2);
    for (let reach = 64; reach <= 1_800; reach += 32) {
      const at = step(from, out, reach);
      if (field.waterGap(at) > 0 || field.lands.some((land) => distance(at, land.at) <= land.radius)) continue;
      const beach = step(at, out, -BEACH_RADIUS * 0.6);
      if (field.offPlateaus(beach, BEACH_RADIUS * 0.6) && field.inside([beach], 200)) found.push({ at: roundPoint(at), out, reach });
      break;
    }
  }
  return found.sort((a, b) => a.reach - b.reach).map(({ at, out }) => ({ at, out }));
}

// @@@generated-terrain - The grid is drawn from the layout on open ground: every clearing and path is kept open, the water
// sunk, land raised in it, fords and bridges laid where a way crosses, islands raised, shallows flooded and what blocks the
// land (see @@@generated-open) set round the kept ground; mud laid last; the grid is made symmetric, each plateau's rim
// becomes a cliff but for its ramps, stray pockets and specks are filled or cleared, the water's rim becomes shallows, and the
// map is kept only if every start reaches everything, no island is walked to, and every shore takes a shipyard on open
// water.
function carveTerrain(field: Field, plain: boolean): Terrain | undefined {
  const cells = Math.round(field.size / TERRAIN_CELL);
  const grid = new Grid(cells, field);
  for (const clearing of field.clearings) grid.keep(clearing.at, clearing.radius, clearing.wobble, clearing.plateau === true);
  for (const path of field.paths) grid.keepPath(path);
  for (const plateau of field.plateaus) grid.markRamp(plateau.ramp, plateau.rampRadius);
  for (const reserved of field.reserved) grid.keep(reserved.at, reserved.radius, 0, false);
  for (const water of field.waters) grid.sink(water);
  if (field.coast > 0) grid.sinkCoast(field.coast);
  for (const land of field.lands) grid.raise(land.at, land.radius, false);
  grid.cross();
  for (const island of field.islands) grid.raise(island.at, island.radius, true);
  for (const shoal of field.shoals) grid.flood(shoal);
  grid.border();
  grid.skirts();
  for (const wall of field.walls) grid.wall(wall);
  for (const block of field.blocks) grid.polygon(block);
  for (const ring of field.rings) grid.ring(ring.at, ring.inner, ring.outer);
  if (!grid.keepReachable(field.bases[0]!)) return undefined;
  if (!plain) {
    placeMasses(field, grid);
    placeCopses(field, grid);
  }
  for (const mud of field.muds) grid.mire(mud);
  grid.symmetrize();
  grid.raiseCliffs();
  grid.frame();
  if (!grid.keepReachable(field.bases[0]!)) return undefined;
  grid.clearSpecks();
  grid.shoal();
  const required = [...field.bases, ...field.mains, ...field.mines, ...field.camps.map((camp) => camp.at), ...field.mercs.map((merc) => merc.at), ...field.sites.map((site) => site.at)];
  if (!required.every((point) => grid.walkableAt(point))) return undefined;
  if (!grid.obstaclesFit(field.bases[0]!)) return undefined;
  if (!field.bases.every((base) => grid.roomAround(base, 450) >= 0.55)) return undefined;
  if (!field.mines.every((mine) => grid.hallFits(mine))) return undefined;
  if (grid.islandWalked(field.bases[0]!)) return undefined;
  const terrain = grid.terrain();
  if (!harbours(field, terrain)) return undefined;
  return terrain;
}

// Whether every shore takes a shipyard (see @@@shore-footprint) on water of OPEN_WATER deep cells or more, and every
// island's mine is reached from one of those shipyards' water.
function harbours(field: Field, terrain: Terrain) {
  const map = { terrain, width: field.size, height: field.size };
  const yards = field.shores.map((shore) => shipyardWater(map, shore));
  if (yards.some((yard) => yard < 0)) return false;
  const seas = yards.map((yard) => seaCells(terrain, yard));
  if (seas.some((sea) => sea.deep < OPEN_WATER)) return false;
  return field.islands.every((island) => {
    const at = walkableGoal(map, island.at.x, island.at.y, "sea");
    const index = cellIndexAt(terrain, at.x, at.y);
    return index >= 0 && seas.some((sea) => sea.reached[index] === 1);
  });
}

// The cell of water a shipyard on the beach at this shore puts its ships out on: a spot out from the shore, or along it
// either way, within a beach's width; -1 where none fits.
function shipyardWater(map: { terrain: Terrain; width: number; height: number }, shore: Shore) {
  const along = { x: -shore.out.y, y: shore.out.x };
  for (let reach = -BEACH_RADIUS / 2; reach <= BEACH_RADIUS; reach += TERRAIN_CELL / 2) {
    for (const side of [0, 1, -1, 2, -2, 3, -3]) {
      const at = step(step(shore.at, shore.out, reach), along, side * TERRAIN_CELL);
      if (!isShoreFootprint(map, at.x, at.y, BUILDING_DEFS.shipyard.radius)) continue;
      const water = walkableGoal(map, at.x, at.y, "sea");
      return cellIndexAt(map.terrain, water.x, water.y);
    }
  }
  return -1;
}

// The water a ship sails from the cell (four ways, deep or shallow): 1 for each cell, and how many of them are deep.
function seaCells(terrain: Terrain, start: number) {
  const reached = new Uint8Array(terrain.cols * terrain.rows);
  const wet = (index: number) => terrain.cells[index] === "~" || terrain.cells[index] === ",";
  let deep = 0;
  if (start < 0 || !wet(start)) return { reached, deep };
  const queue = [start];
  reached[start] = 1;
  for (let head = 0; head < queue.length; head += 1) {
    const index = queue[head]!;
    if (terrain.cells[index] === "~") deep += 1;
    const col = index % terrain.cols;
    const row = (index - col) / terrain.cols;
    for (const [c, r] of [[col + 1, row], [col - 1, row], [col, row + 1], [col, row - 1]] as const) {
      if (c < 0 || r < 0 || c >= terrain.cols || r >= terrain.rows) continue;
      const next = r * terrain.cols + c;
      if (reached[next] || !wet(next)) continue;
      reached[next] = 1;
      queue.push(next);
    }
  }
  return { reached, deep };
}

// The blocker a mass of the map's theme is made of (see @@@generated-open): where the idea has open water of its own, its
// lakes are groves.
function massKind(field: Field): Blocker {
  const { forest, rock, water } = field.theme;
  const roll = field.random() * (forest + rock + water);
  if (roll < forest) return 1;
  if (roll < forest + rock) return 2;
  return field.waters.length > 0 || field.coast > 0 ? 1 : 3;
}

// @@@generated-masses - Groves, ridges, outcrops and lakes: each a chain of one to four disks, every one beside the last,
// turned from its heading and smaller, set with all its copies on open land off the ways, until the open share of the land
// is down to the map's share (or the draws run out). A mass that would cut any open ground off from the starts is taken
// back: the land between the ways stays one whole, so the share drawn is the share played on.
function placeMasses(field: Field, grid: Grid) {
  grid.countOpen();
  for (let attempt = 0; attempt < 240 && grid.openShare() > field.walkShare; attempt += 1) {
    const kind = massKind(field);
    const disks: Disk[] = [];
    let at = { x: field.between(0, field.size), y: field.between(0, field.size) };
    let radius = field.between(MASS_RADIUS[0], MASS_RADIUS[1]);
    let toward = field.between(0, Math.PI * 2);
    for (let link = Math.floor(field.between(1, 5)); link > 0; link -= 1) {
      disks.push({ at, radius });
      toward += field.between(-1, 1);
      at = step(at, heading(toward), radius * field.between(0.6, 1));
      radius *= field.between(0.6, 0.95);
    }
    const images = disks.map((disk) => field.copies(disk.at));
    if (!images[0]!.every((point) => grid.massFits(point, disks[0]!.radius))) continue;
    const closed: number[] = [];
    images[0]!.forEach((_, copy) => disks.forEach((disk, index) => grid.block(images[index]![copy]!, disk.radius, 0.4, kind, closed)));
    if (!grid.whole(field.bases[0]!)) grid.reopen(closed);
  }
}

// Copses here and there on open land, a little apart from the ways, for the eye.
function placeCopses(field: Field, grid: Grid) {
  const copies = field.symmetry.copies({ x: 0, y: 0 }).length;
  const wanted = Math.round((field.size * field.size) / 1_400_000 / copies);
  let placed = 0;
  for (let attempt = 0; attempt < wanted * 8 && placed < wanted; attempt += 1) {
    const radius = field.between(36, 84);
    const at = field.copies({ x: field.between(0, field.size), y: field.between(0, field.size) });
    if (!at.every((point) => grid.copseFits(point, radius))) continue;
    const kind = field.random() < field.theme.rock ? 2 : 1;
    for (const point of at) grid.block(point, radius, 0.3, kind);
    placed += 1;
  }
}

// The terrain being drawn: which cells are open, which of them lie on a plateau or a ramp, what blocks the rest.
class Grid {
  readonly open: Uint8Array;
  // Ground no blocker covers (the ways, clearings and reserved spots), and the ways' own cells (2 where a bridge crosses).
  readonly kept: Uint8Array;
  readonly way: Uint8Array;
  readonly plateau: Uint8Array;
  readonly ramp: Uint8Array;
  // 0 none (open), 1 forest, 2 rock, 3 water.
  readonly blocker: Uint8Array;
  // The idea's water (see @@@generated-water), the part of it no way crosses, its islands, every water's shallows, the
  // bridges, and the mud.
  readonly sea: Uint8Array;
  readonly still: Uint8Array;
  readonly island: Uint8Array;
  readonly shallow: Uint8Array;
  readonly bridge: Uint8Array;
  readonly mud: Uint8Array;
  // The cells the field's rocks and gates shut, as the sim's routing has them (see @@@generated-obstacles).
  readonly shut: Uint8Array;
  readonly shutCells: number[] = [];
  readonly count: number;
  private openCount = 0;
  private landCount = 0;
  private islandCount = 0;

  constructor(
    readonly cells: number,
    readonly field: Field,
  ) {
    this.count = cells * cells;
    this.open = new Uint8Array(this.count).fill(1);
    this.kept = new Uint8Array(this.count);
    this.way = new Uint8Array(this.count);
    this.plateau = new Uint8Array(this.count);
    this.ramp = new Uint8Array(this.count);
    this.blocker = new Uint8Array(this.count);
    this.sea = new Uint8Array(this.count);
    this.still = new Uint8Array(this.count);
    this.island = new Uint8Array(this.count);
    this.shallow = new Uint8Array(this.count);
    this.bridge = new Uint8Array(this.count);
    this.mud = new Uint8Array(this.count);
    this.shut = new Uint8Array(this.count);
    for (const obstacle of field.obstacles) {
      const reach = OBSTACLE_DEFS[obstacle.kind].radius + BODY_MARGIN;
      this.around(obstacle.at, reach, (index, gap) => {
        if (gap >= reach || this.shut[index]) return;
        this.shut[index] = 1;
        this.shutCells.push(index);
      });
    }
  }

  center(index: number): Point {
    const col = index % this.cells;
    const row = (index - col) / this.cells;
    return { x: (col + 0.5) * TERRAIN_CELL, y: (row + 0.5) * TERRAIN_CELL };
  }

  indexAt(point: Point) {
    const col = Math.floor(point.x / TERRAIN_CELL);
    const row = Math.floor(point.y / TERRAIN_CELL);
    if (col < 0 || row < 0 || col >= this.cells || row >= this.cells) return -1;
    return row * this.cells + col;
  }

  walkableAt(point: Point) {
    const index = this.indexAt(point);
    return index >= 0 && this.open[index] === 1;
  }

  // Cells whose centers lie within `reach` of the point, visited once each.
  around(at: Point, reach: number, visit: (index: number, gap: number) => void) {
    const low = { col: Math.max(0, Math.floor((at.x - reach) / TERRAIN_CELL)), row: Math.max(0, Math.floor((at.y - reach) / TERRAIN_CELL)) };
    const high = { col: Math.min(this.cells - 1, Math.floor((at.x + reach) / TERRAIN_CELL)), row: Math.min(this.cells - 1, Math.floor((at.y + reach) / TERRAIN_CELL)) };
    for (let row = low.row; row <= high.row; row += 1) {
      for (let col = low.col; col <= high.col; col += 1) {
        const index = row * this.cells + col;
        const center = this.center(index);
        const gap = distance(center, at);
        if (gap <= reach) visit(index, gap);
      }
    }
  }

  wobble(point: Point) {
    return edgeNoise(this.field.noiseSeed, this.field.symmetry.canonical(point));
  }

  // Cells within a wobbling disk, the wobble the same for every copy.
  disk(at: Point, radius: number, wobble: number, visit: (index: number) => void) {
    this.around(at, radius * (1 + wobble), (index, gap) => {
      if (gap <= radius * (1 + wobble * this.wobble(this.center(index)))) visit(index);
    });
  }

  // Cells within a wobbling band along the points (one point: a disk).
  band(band: Water, visit: (index: number) => void) {
    alongEvery(band.points, 24, (at) => this.disk(at, band.half, band.wobble, visit));
  }

  keep(at: Point, radius: number, wobble: number, plateau: boolean) {
    this.disk(at, radius, wobble, (index) => {
      this.kept[index] = 1;
      if (plateau) this.plateau[index] = 1;
    });
  }

  keepPath(path: Path) {
    this.band(path, (index) => {
      this.kept[index] = 1;
      this.way[index] = Math.max(this.way[index]!, path.bridge ? 2 : 1);
    });
  }

  markRamp(at: Point, radius: number) {
    this.around(at, radius, (index) => {
      this.ramp[index] = 1;
    });
  }

  private drown(index: number, still: boolean) {
    this.open[index] = 0;
    this.blocker[index] = 3;
    this.sea[index] = 1;
    if (still) this.still[index] = 1;
  }

  // Deep water over everything within the water's wobbling edge.
  sink(water: Water) {
    this.band(water, (index) => this.drown(index, !water.crossable));
  }

  // The sea along the map's edge, `depth` deep, its shore wobbling.
  sinkCoast(depth: number) {
    for (let index = 0; index < this.count; index += 1) {
      const at = this.center(index);
      if (edgeGap(at, this.field.size) <= depth * (1 + SEA_WOBBLE * this.wobble(at))) this.drown(index, true);
    }
  }

  // Ground raised out of the water: land a walk joins (a home island, a lake's island crossed to), or an island no walk
  // from a start reaches, which is kept clear of blockers.
  raise(at: Point, radius: number, island: boolean) {
    this.disk(at, radius, 0.08, (index) => {
      this.open[index] = 1;
      this.blocker[index] = 0;
      this.sea[index] = 0;
      this.still[index] = 0;
      if (!island) return;
      this.kept[index] = 1;
      this.island[index] = 1;
    });
  }

  // A way across crossable water is a ford of shallows, walked and sailed both, or a bridge, walked and sailed under by no
  // ship.
  cross() {
    for (let index = 0; index < this.count; index += 1) {
      if (!this.way[index] || !this.sea[index] || this.still[index]) continue;
      this.open[index] = 1;
      this.blocker[index] = 0;
      if (this.way[index] === 2) this.bridge[index] = 1;
      else this.shallow[index] = 1;
    }
  }

  // Shallow water over the open land within the shoal, but its ways and clearings, which stay dry.
  flood(shoal: Water) {
    this.band(shoal, (index) => {
      if (!this.open[index] || this.kept[index] || this.plateau[index] || this.ramp[index] || this.sea[index]) return;
      this.shallow[index] = 1;
    });
  }

  // Mud over the open ground within the patch (its ways too), but plateaus, ramps, water and bridges.
  mire(patch: Water) {
    this.band(patch, (index) => {
      if (!this.open[index] || this.plateau[index] || this.ramp[index] || this.shallow[index] || this.bridge[index] || this.sea[index]) return;
      this.mud[index] = 1;
    });
  }

  // What blocks the cell where the land is filled (the edge, a skirt, a tree line, a pocket): forest, or rock where the
  // theme's patches run high.
  fillKind(index: number): Blocker {
    return patchNoise(this.field.noiseSeed + 17, this.field.symmetry.canonical(this.center(index)), 520) > this.field.theme.rockFill ? 2 : 1;
  }

  // Whether a blocker may stand on the cell: open land off the kept ground, the plateaus and their ramps.
  blockable(index: number) {
    return this.open[index] === 1 && !this.kept[index] && !this.plateau[index] && !this.ramp[index] && !this.shallow[index] && !this.bridge[index];
  }

  close(index: number, code: Blocker) {
    if (this.open[index]) this.openCount -= 1;
    this.open[index] = 0;
    this.blocker[index] = code;
  }

  // Blocks the open land in a wobbling disk; the cells it closes are listed into `closed` when given.
  block(at: Point, radius: number, wobble: number, code: Blocker, closed?: number[]) {
    this.disk(at, radius, wobble, (index) => {
      if (!this.blockable(index)) return;
      this.close(index, code);
      closed?.push(index);
    });
  }

  reopen(cells: number[]) {
    for (const index of cells) {
      this.open[index] = 1;
      this.blocker[index] = 0;
      this.openCount += 1;
    }
  }

  // Whether every open cell but an island's is reached from the start, with the rocks and gates standing.
  whole(from: Point) {
    const reached: number[] = [];
    this.flood4(this.indexAt(from), (index) => this.open[index] === 1 && !this.shut[index], reached);
    const shutOpen = this.shutCells.filter((index) => this.open[index] && !this.island[index]).length;
    return reached.length === this.openCount - this.islandCount - shutOpen;
  }

  // @@@generated-obstacles - Rocks and gates stand across shortcuts only: each on open ground, the land whole with all of
  // them standing (so nothing lies behind one but a shorter way), and each shutting its way: the walk round it, from a
  // step beyond its reach on one side to a step beyond on the other, at least SHORTCUT times the step across.
  obstaclesFit(from: Point) {
    if (this.field.obstacles.length === 0) return true;
    this.countOpen();
    if (!this.field.obstacles.every((obstacle) => this.walkableAt(obstacle.at)) || !this.whole(from)) return false;
    const passes = (index: number) => index >= 0 && this.open[index] === 1 && !this.shut[index];
    return this.field.obstacles.every((obstacle) => {
      const beyond = OBSTACLE_DEFS[obstacle.kind].radius + BODY_MARGIN + TERRAIN_CELL;
      const ends = [step(obstacle.at, obstacle.along, beyond), step(obstacle.at, obstacle.along, -beyond)].map((at) => this.indexAt(at));
      if (!ends.every(passes)) return false;
      return this.steps(ends[0]!, ends[1]!, passes) >= (SHORTCUT * 2 * beyond) / TERRAIN_CELL;
    });
  }

  // The fewest eight-way steps from one cell to another over the cells that pass (Infinity where none reach).
  steps(from: number, to: number, passes: (index: number) => boolean) {
    const depth = new Int32Array(this.count).fill(-1);
    const queue = [from];
    depth[from] = 0;
    for (let head = 0; head < queue.length; head += 1) {
      const index = queue[head]!;
      if (index === to) return depth[index]!;
      for (const next of this.neighbours(index)) {
        if (depth[next] !== -1 || !passes(next)) continue;
        depth[next] = depth[index]! + 1;
        queue.push(next);
      }
    }
    return Infinity;
  }

  fill(index: number) {
    if (this.blockable(index)) this.close(index, this.fillKind(index));
  }

  // The map's edge, BORDER_CELLS deep by patches (see @@@generated-open).
  border() {
    const [low, high] = BORDER_CELLS;
    for (let index = 0; index < this.count; index += 1) {
      const col = index % this.cells;
      const row = (index - col) / this.cells;
      const depth = Math.min(col, row, this.cells - 1 - col, this.cells - 1 - row);
      if (depth >= high) continue;
      if (depth < low + (high - low) * patchNoise(this.field.noiseSeed + 43, this.field.symmetry.canonical(this.center(index)), 640)) this.fill(index);
    }
  }

  // The land round every main's plateau, SKIRT beyond its radius by patches, all round: only its ways out (the ramp's,
  // kept) stay open, so a main has the one way in.
  skirts() {
    for (const plateau of this.field.plateaus) {
      if (!plateau.main) continue;
      this.around(plateau.base, plateau.radius + SKIRT[1], (index, gap) => {
        if (gap <= plateau.radius + SKIRT[0] + (SKIRT[1] - SKIRT[0]) * patchNoise(this.field.noiseSeed + 59, this.field.symmetry.canonical(this.center(index)), 300)) this.fill(index);
      });
    }
  }

  // A tree line along its points.
  wall(wall: Path) {
    this.band(wall, (index) => this.fill(index));
  }

  // The land inside a polygon (points round it in order).
  polygon(points: Point[]) {
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const low = this.indexAt({ x: Math.max(0, Math.min(...xs)), y: Math.max(0, Math.min(...ys)) });
    const high = this.indexAt({ x: Math.min(this.field.size - 1, Math.max(...xs)), y: Math.min(this.field.size - 1, Math.max(...ys)) });
    if (low < 0 || high < 0) return;
    for (let row = Math.floor(low / this.cells); row <= Math.floor(high / this.cells); row += 1) {
      for (let col = low % this.cells; col <= high % this.cells; col += 1) {
        const index = row * this.cells + col;
        if (insidePolygon(this.center(index), points)) this.fill(index);
      }
    }
  }

  // The land in a ring round the point, between `inner` and a wobbling `outer`.
  ring(at: Point, inner: number, outer: number) {
    this.around(at, outer * 1.2, (index, gap) => {
      if (gap >= inner && gap <= outer * (1 + 0.15 * this.wobble(this.center(index)))) this.fill(index);
    });
  }

  countOpen() {
    this.openCount = 0;
    this.landCount = 0;
    this.islandCount = 0;
    for (let index = 0; index < this.count; index += 1) {
      this.openCount += this.open[index]!;
      if (!this.sea[index]) this.landCount += 1;
      if (this.open[index] && this.island[index]) this.islandCount += 1;
    }
  }

  // The open share of the land (the map but its water).
  openShare() {
    return this.landCount === 0 ? 0 : this.openCount / this.landCount;
  }

  // Whether a mass may stand here: on open land off the ways, clear of every reserved spot and plateau by half its size.
  massFits(at: Point, radius: number) {
    const index = this.indexAt(at);
    if (index < 0 || !this.blockable(index)) return false;
    if (this.field.reserved.some((spot) => distance(spot.at, at) < spot.radius + radius * 0.5)) return false;
    return this.field.plateaus.every((plateau) => distance(plateau.base, at) >= plateau.radius + radius * 0.5 + 64);
  }

  // Whether a copse may stand here: its ground and two cells round it open land off the ways.
  copseFits(at: Point, radius: number) {
    let clear = this.indexAt(at) >= 0;
    this.around(at, radius + TERRAIN_CELL * 2, (index) => {
      if (!this.blockable(index)) clear = false;
    });
    return clear;
  }

  // Every cell takes the value of the first cell of its orbit, so the grid is the same from every start.
  symmetrize() {
    const orbit = this.field.symmetry.orbit;
    if (!orbit) return;
    const layers = [this.open, this.kept, this.way, this.plateau, this.ramp, this.blocker, this.sea, this.still, this.island, this.shallow, this.bridge, this.mud];
    const done = new Uint8Array(this.count);
    for (let row = 0; row < this.cells; row += 1) {
      for (let col = 0; col < this.cells; col += 1) {
        const index = row * this.cells + col;
        if (done[index]) continue;
        for (const [c, r] of orbit(col, row, this.cells)) {
          const image = r * this.cells + c;
          done[image] = 1;
          if (image === index) continue;
          for (const layer of layers) layer[image] = layer[index]!;
        }
      }
    }
  }

  // @@@generated-cliffs - A plateau's rim becomes rock (the cliff it stands on) all round, but on its ramps: open cells of
  // the plateau beside anything that is not open plateau.
  raiseCliffs() {
    const cliffs: number[] = [];
    for (let index = 0; index < this.count; index += 1) {
      if (!this.open[index] || !this.plateau[index] || this.ramp[index]) continue;
      if (this.neighbours(index).some((next) => !this.open[next] || !this.plateau[next])) cliffs.push(index);
    }
    for (const index of cliffs) {
      this.open[index] = 0;
      this.mud[index] = 0;
      this.blocker[index] = 2;
    }
  }

  // The map's outermost ring of cells is blocked, so the ground ends in forest or rock and never at the map's edge.
  frame() {
    for (let index = 0; index < this.count; index += 1) {
      const col = index % this.cells;
      const row = (index - col) / this.cells;
      if (col > 1 && row > 1 && col < this.cells - 2 && row < this.cells - 2) continue;
      if (!this.open[index] || this.sea[index]) continue;
      this.open[index] = 0;
      this.shallow[index] = 0;
      this.mud[index] = 0;
      this.blocker[index] = this.fillKind(index);
    }
  }

  // Open ground that the first start cannot reach is filled (but an island's); false when the start itself is not open.
  keepReachable(from: Point) {
    const start = this.indexAt(from);
    if (start < 0 || !this.open[start]) return false;
    const reached = this.flood4(start, (index) => this.open[index] === 1);
    for (let index = 0; index < this.count; index += 1) {
      if (!this.open[index] || reached[index] || this.island[index]) continue;
      this.open[index] = 0;
      this.shallow[index] = 0;
      this.bridge[index] = 0;
      this.mud[index] = 0;
      this.blocker[index] = this.plateau[index] ? 2 : this.sea[index] ? 3 : this.fillKind(index);
    }
    return true;
  }

  // Blocked specks of a few cells in the open are cleared: a unit would catch on them for nothing.
  clearSpecks() {
    const seen = new Uint8Array(this.count);
    for (let index = 0; index < this.count; index += 1) {
      if (this.open[index] || seen[index]) continue;
      const patch: number[] = [];
      let framed = false;
      this.flood4(index, (cell) => this.open[cell] === 0, patch);
      for (const cell of patch) {
        seen[cell] = 1;
        const col = cell % this.cells;
        const row = (cell - col) / this.cells;
        if (col < 2 || row < 2 || col >= this.cells - 2 || row >= this.cells - 2) framed = true;
      }
      if (framed || patch.length >= 5 || patch.some((cell) => this.plateau[cell] && this.blocker[cell] === 2)) continue;
      for (const cell of patch) {
        this.open[cell] = 1;
        this.blocker[cell] = 0;
      }
    }
  }

  // Water beside open ground becomes shallows, walked and sailed both; but beside a bridge, so no ship sails round it.
  shoal() {
    const rim: number[] = [];
    for (let index = 0; index < this.count; index += 1) {
      if (this.open[index] || this.blocker[index] !== 3) continue;
      if (this.neighbours(index).some((next) => this.open[next] === 1 && !this.bridge[next])) rim.push(index);
    }
    for (const index of rim) {
      this.open[index] = 1;
      this.shallow[index] = 1;
      this.blocker[index] = 0;
    }
  }

  // Whether a walk from the start reaches any island (its shallows touching the land's).
  islandWalked(from: Point) {
    const reached = this.flood4(this.indexAt(from), (index) => this.open[index] === 1);
    for (let index = 0; index < this.count; index += 1) if (reached[index] && this.island[index]) return true;
    return false;
  }

  // Four-way flood from a cell over the cells that pass; the cells reached (listed into `into` when given).
  flood4(start: number, passes: (index: number) => boolean, into?: number[]) {
    const reached = new Uint8Array(this.count);
    const queue = [start];
    reached[start] = 1;
    for (let head = 0; head < queue.length; head += 1) {
      const index = queue[head]!;
      into?.push(index);
      const col = index % this.cells;
      const row = (index - col) / this.cells;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const c = col + dx;
        const r = row + dy;
        if (c < 0 || r < 0 || c >= this.cells || r >= this.cells) continue;
        const next = r * this.cells + c;
        if (reached[next] || !passes(next)) continue;
        reached[next] = 1;
        queue.push(next);
      }
    }
    return reached;
  }

  neighbours(index: number) {
    const col = index % this.cells;
    const row = (index - col) / this.cells;
    const found: number[] = [];
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const c = col + dx;
        const r = row + dy;
        if (c >= 0 && r >= 0 && c < this.cells && r < this.cells) found.push(r * this.cells + c);
      }
    }
    return found;
  }

  // The share of the ground within `reach` of the point that is open.
  roomAround(at: Point, reach: number) {
    let open = 0;
    let all = 0;
    this.around(at, reach, (index) => {
      all += 1;
      open += this.open[index]!;
    });
    return all === 0 ? 0 : open / all;
  }

  // Whether a hall fits somewhere beside the mine (within 170 of it, its whole footprint open and off every ramp, see
  // @@@ramp-unbuildable).
  hallFits(mine: Point) {
    for (const reach of [110, 140, 170]) {
      for (let spoke = 0; spoke < 16; spoke += 1) {
        const at = step(mine, heading((spoke / 16) * Math.PI * 2), reach);
        let clear = true;
        this.around(at, 56, (index) => {
          if (!this.open[index] || this.ramp[index]) clear = false;
        });
        if (clear) return true;
      }
    }
    return false;
  }

  terrain(): Terrain {
    let cells = "";
    let levels = "";
    for (let index = 0; index < this.count; index += 1) {
      cells += this.bridge[index] && this.open[index]
        ? KIND_CHAR.bridge
        : this.shallow[index]
          ? KIND_CHAR.shallow
          : this.open[index]
            ? this.mud[index]
              ? KIND_CHAR.mud
              : KIND_CHAR.ground
            : this.blocker[index] === 2
              ? KIND_CHAR.rock
              : this.blocker[index] === 3
                ? KIND_CHAR.water
                : KIND_CHAR.forest;
      levels += this.open[index] && this.ramp[index] ? "2" : this.plateau[index] ? "1" : "0";
    }
    return { cell: TERRAIN_CELL, cols: this.cells, rows: this.cells, cells, levels };
  }
}

function assemble(kind: GeneratedLayoutKind, idea: MapIdea, field: Field, players: PlayerId[], terrain: Terrain): GeneratedMap {
  const starts: GeneratedMap["starts"] = {};
  const buildings: Building[] = [];
  const units: Unit[] = [];
  const resources: ResourceNode[] = [];
  for (const player of players) {
    const start = field.starts.get(player);
    if (!start) throw new Error(`No start for ${player}`);
    const base = clampPoint(start.base, field.size);
    const mine = clampPoint(start.mine, field.size);
    starts[player] = { baseX: base.x, baseY: base.y, mineX: mine.x, mineY: mine.y };
    buildings.push(createBuilding(`building-${player}-townhall`, player, "townHall", base.x, base.y, true));
    units.push(
      createUnit(`unit-${player}-worker-1`, player, "worker", base.x - 55, base.y + 10),
      createUnit(`unit-${player}-worker-2`, player, "worker", base.x - 10, base.y + 65),
      createUnit(`unit-${player}-worker-3`, player, "worker", base.x + 55, base.y + 40),
    );
    resources.push({ id: `gold-${player}-main`, kind: "goldMine", x: mine.x, y: mine.y, amount: MINE_GOLD });
  }
  field.mines.forEach((mine, index) => {
    const at = clampPoint(mine, field.size);
    resources.push({ id: `gold-gen-${index + 1}`, kind: "goldMine", x: at.x, y: at.y, amount: field.rich.some((rich) => distance(rich, mine) < 1) ? RICH_GOLD : MINE_GOLD });
  });
  const items: WorldItem[] = [];
  const camps: GeneratedMap["camps"] = [];
  field.camps.forEach((camp, index) => {
    const at = clampPoint(camp.at, field.size);
    const kinds = campKinds(field, camp.tier);
    const creeps = kinds.map((unitKind, member) => {
      const spread = (member / kinds.length) * Math.PI * 2 + 0.3;
      return createUnit(`wildling-gen-${index + 1}-${member + 1}`, "neutral", unitKind, Math.round(at.x + detCos(spread) * CAMP_SPREAD), Math.round(at.y + detSin(spread) * CAMP_SPREAD));
    });
    units.push(...creeps);
    if (camp.item) items.push({ id: `treasure-gen-${index + 1}`, kind: camp.item, x: 0, y: 0, carrierId: creeps[0]!.id, cooldownRemaining: 0 });
    camps.push({ x: at.x, y: at.y, tier: camp.color ?? TIER_COLOR[camp.tier], habitat: habitatAt(terrain, at), ...(camp.item ? { drop: MAJOR_ITEMS.includes(camp.item) ? ("major" as const) : ("minor" as const) } : {}) });
  });
  const mercenaryCamps: MercenaryCamp[] = field.mercs.map((merc, index) => {
    const at = clampPoint(merc.at, field.size);
    return { id: `merc-gen-${index + 1}`, x: at.x, y: at.y, radius: 50, hireKind: merc.kind, cost: UNIT_DEFS[merc.kind].cost, stock: 3, cooldown: seconds(16), cooldownRemaining: 0 };
  });
  const landmarks: TerrainLandmark[] = [
    ...roads(field),
    ...resources.map((mine) => ({ id: `gen-scar-${mine.id}`, kind: "mineScar" as const, x: mine.x, y: mine.y, size: 200, rotation: 0.3 })),
    ...field.camps.map((camp, index) => ({ id: `gen-camp-${index + 1}`, kind: "campMark" as const, ...clampPoint(camp.at, field.size), size: 200, rotation: 0.2 })),
    ...field.mercs.map((merc, index) => ({ id: `gen-stone-${index + 1}`, kind: "bannerStone" as const, x: merc.at.x + 70, y: merc.at.y - 50, size: 140, rotation: 0.2 })),
  ];
  const sites = field.sites.map((site) => ({ kind: site.kind, ...clampPoint(site.at, field.size) }));
  const obstacles = field.obstacles.map((obstacle, index) => {
    const at = clampPoint(obstacle.at, field.size);
    const along = { x: Math.round(obstacle.along.x * 1000) / 1000, y: Math.round(obstacle.along.y * 1000) / 1000 };
    return createObstacle(`obstacle-gen-${index + 1}`, obstacle.kind, at.x, at.y, along);
  });
  return { kind, idea, size: field.size, starts, buildings, units, resources, mercenaryCamps, items, landmarks: [...landmarks, ...decorate(field, terrain)], terrain, camps, sites, obstacles };
}

// @@@generated-decor - What a map is dressed in, for the eye only (no unit is stopped by it, see TerrainLandmark): about
// DECOR_PER_CELL of every map's open cells dressed by what lies round them (flowers, bushes and pebbles on open ground;
// mushrooms, stumps and logs by the woods; pebbles and bones by rock; reeds on a shore; lilies out on the shallows), then a
// campfire by every camp, a signpost by every shop, pillars round every hill and a wreck on every beach.
const DECOR_PER_CELL = 1 / 220;
function decorate(field: Field, terrain: Terrain): TerrainLandmark[] {
  const marks: TerrainLandmark[] = [];
  const add = (kind: TerrainLandmark["kind"], at: Point, size: number) =>
    marks.push({ id: `gen-decor-${marks.length + 1}`, kind, ...clampPoint(at, field.size), size: Math.round(size), rotation: Math.round(field.between(0, Math.PI * 2) * 100) / 100 });
  const charAt = (at: Point) => {
    const index = cellIndexAt(terrain, at.x, at.y);
    return index < 0 ? "" : terrain.cells[index]!;
  };
  const near = (at: Point, chars: string) => [0, 1, 2, 3, 4, 5, 6, 7].some((spoke) => chars.includes(charAt(step(at, heading((spoke / 8) * Math.PI * 2), 70))));
  const open = [...terrain.cells].filter((char) => char === "." || char === ",").length;
  const wanted = Math.round(open * DECOR_PER_CELL);
  let placed = 0;
  for (let attempt = 0; attempt < wanted * 6 && placed < wanted; attempt += 1) {
    const at = { x: field.between(64, field.size - 64), y: field.between(64, field.size - 64) };
    const here = charAt(at);
    let kind: TerrainLandmark["kind"] | undefined;
    if (here === ",") kind = near(at, ".") ? "reeds" : "lilies";
    else if (here === ".") kind = near(at, "T") ? pick(field.random, ["mushrooms", "stump", "log"] as const) : near(at, "#") ? pick(field.random, ["pebbles", "bones"] as const) : near(at, "~,") ? "reeds" : pick(field.random, ["flowers", "flowers", "bush", "pebbles", "stump"] as const);
    if (!kind) continue;
    add(kind, at, field.between(50, 90));
    placed += 1;
  }
  for (const camp of field.camps) add("campfire", step(camp.at, heading(field.between(0, Math.PI * 2)), 95), 64);
  for (const site of field.sites) add("signpost", step(site.at, heading(field.between(0, Math.PI * 2)), 80), 70);
  // A hill has a plateau entry for every ramp: its pillars once.
  const hills = field.plateaus.filter((plateau, index, all) => !plateau.main && all.findIndex((other) => distance(other.base, plateau.base) < 1) === index);
  for (const hill of hills) {
    for (let corner = 0; corner < 4; corner += 1) add("pillar", step(hill.base, heading((corner / 4) * Math.PI * 2 + Math.PI / 4), hill.radius * 0.72), 80);
  }
  for (const shore of field.shores) add("wreck", step(step(shore.at, shore.out, -40), { x: -shore.out.y, y: shore.out.x }, 150), 110);
  return marks;
}

// What lies round a camp (within six cells): water where any of it is wet, a hill where it stands on a plateau or by rock,
// a forest where a quarter of it is trees, open ground otherwise.
function habitatAt(terrain: Terrain, at: Point): CampHabitat {
  const col = Math.floor(at.x / terrain.cell);
  const row = Math.floor(at.y / terrain.cell);
  let wet = 0;
  let rock = 0;
  let trees = 0;
  let all = 0;
  for (let r = row - 6; r <= row + 6; r += 1) {
    for (let c = col - 6; c <= col + 6; c += 1) {
      if (c < 0 || r < 0 || c >= terrain.cols || r >= terrain.rows || (c - col) ** 2 + (r - row) ** 2 > 36) continue;
      const char = terrain.cells[r * terrain.cols + c];
      all += 1;
      if (char === "~" || char === ",") wet += 1;
      if (char === "#") rock += 1;
      if (char === "T") trees += 1;
    }
  }
  if (wet > 0) return "water";
  if (terrain.levels?.[row * terrain.cols + col] === "1" || rock > all * 0.1) return "hill";
  if (trees > all * 0.25) return "forest";
  return "open";
}

// A plateau's shape: a core round the start and three lobes (one toward the ramp, two drawn), every part within `plateau`
// of the start, so no two plateaus look alike and the ramp stands on the rim.
function plateauLobes(field: Field, base: Point, rampDirection: Point, plateau: number): Disk[] {
  const lobes = [{ at: base, radius: plateau * field.between(0.72, 0.8) }, { at: step(base, rampDirection, plateau * 0.4), radius: plateau * 0.55 }];
  for (let lobe = 0; lobe < 2; lobe += 1) {
    const reach = field.between(0.25, 0.4);
    lobes.push({ at: step(base, rotate(rampDirection, field.between(0.9, Math.PI * 2 - 0.9)), plateau * reach), radius: plateau * (0.92 - reach) });
  }
  return lobes.map((lobe) => ({ at: roundPoint(lobe.at), radius: lobe.radius }));
}

// Worn tracks along the paths, for the eye.
function roads(field: Field): TerrainLandmark[] {
  const marks: TerrainLandmark[] = [];
  for (const path of field.paths) {
    for (let index = 1; index < path.points.length; index += 1) {
      const a = path.points[index - 1]!;
      const b = path.points[index]!;
      const length = distance(a, b);
      if (length < 40) continue;
      const at = roundPoint(lerp(a, b, 0.5));
      marks.push({ id: `gen-road-${marks.length + 1}`, kind: "road", ...at, size: Math.round(length + 40), rotation: Math.round(Math.atan2(b.y - a.y, b.x - a.x) * 100) / 100 });
    }
  }
  return marks;
}

function campKinds(field: Field, tier: CampTier) {
  if (tier === "easy") return field.easyKinds;
  if (tier === "medium") return field.mediumKinds;
  if (tier === "strong") return field.strongKinds;
  return field.hardKinds;
}

// A path's points round water in the middle from `from` to `to`: along the arc between them about the center, its distance
// from the center going evenly from the one end's to the other's, every 180 or so along it (by the half turn's middle, for
// ends on opposite sides).
function roundSea(center: Point, from: Point, to: Point): Point[] {
  const a = unit(sub(from, center));
  const b = unit(sub(to, center));
  if (a.x * b.x + a.y * b.y < -0.9) {
    const middle = step(center, { x: -a.y, y: a.x }, (distance(from, center) + distance(to, center)) / 2);
    return [...roundSea(center, from, middle), ...roundSea(center, middle, to).slice(1)];
  }
  const near = distance(from, center);
  const far = distance(to, center);
  // Pieces by the chord (no acos: it rounds differently on different machines), a little more for the bend.
  const pieces = Math.max(2, Math.ceil((distance(from, to) * 1.2) / 180));
  return Array.from({ length: pieces + 1 }, (_, index) => {
    const t = index / pieces;
    return roundPoint(step(center, unit(lerp(a, b, t)), near + (far - near) * t));
  });
}

// A path's points: a bow from `from` to `to`, its middle pushed sideways by `bend` of its length, every 180 or so.
function curve(from: Point, to: Point, bend: number): Point[] {
  const length = distance(from, to);
  const pieces = Math.max(2, Math.ceil(length / 180));
  const normal = { x: -(to.y - from.y) / (length || 1), y: (to.x - from.x) / (length || 1) };
  const control = { x: (from.x + to.x) / 2 + normal.x * bend * length, y: (from.y + to.y) / 2 + normal.y * bend * length };
  return Array.from({ length: pieces + 1 }, (_, index) => {
    const t = index / pieces;
    const u = 1 - t;
    return roundPoint({ x: u * u * from.x + 2 * u * t * control.x + t * t * to.x, y: u * u * from.y + 2 * u * t * control.y + t * t * to.y });
  });
}

// The point `share` of the way along a path's points, pushed `offset` to one side of it there.
function besidePath(points: Point[], share: number, offset: number): Point {
  const lengths = points.slice(1).map((point, index) => distance(points[index]!, point));
  let left = lengths.reduce((total, length) => total + length, 0) * share;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index]!;
    if (left > length && index < lengths.length - 1) {
      left -= length;
      continue;
    }
    const from = points[index]!;
    const to = points[index + 1]!;
    const along = lerp(from, to, length === 0 ? 0 : Math.min(1, left / length));
    const size = length || 1;
    return { x: along.x - ((to.y - from.y) / size) * offset, y: along.y + ((to.x - from.x) / size) * offset };
  }
  return points[0]!;
}

// The point `length` along a path's points (past its end, its end) and the path's direction there.
function alongPath(points: Point[], length: number): { at: Point; along: Point } {
  let left = length;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!;
    const to = points[index]!;
    const piece = distance(from, to);
    if (left <= piece || index === points.length - 1) return { at: roundPoint(lerp(from, to, piece === 0 ? 0 : Math.min(1, left / piece))), along: unit(sub(to, from)) };
    left -= piece;
  }
  return { at: points[0]!, along: { x: 1, y: 0 } };
}

// Every point along a path's points at most `every` apart, its ends included (one point: itself).
function alongEvery(points: Point[], every: number, visit: (at: Point) => void) {
  if (points.length === 1) visit(points[0]!);
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!;
    const to = points[index]!;
    const pieces = Math.max(1, Math.ceil(distance(from, to) / every));
    for (let piece = index === 1 ? 0 : 1; piece <= pieces; piece += 1) visit(lerp(from, to, piece / pieces));
  }
}

function samplesAlong(points: Point[], every: number): Point[] {
  const found: Point[] = [];
  alongEvery(points, every, (at) => found.push(at));
  return found;
}

// The distance from a point to a path's points (one point: to it).
function toPolyline(point: Point, points: Point[]) {
  if (points.length === 1) return distance(point, points[0]!);
  let best = Infinity;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
    best = Math.min(best, distance(point, { x: a.x + dx * t, y: a.y + dy * t }));
  }
  return best;
}

// Whether the point lies inside the polygon (even-odd crossings of a ray to the right).
function insidePolygon(point: Point, polygon: Point[]) {
  let inside = false;
  for (let index = 0, last = polygon.length - 1; index < polygon.length; last = index, index += 1) {
    const a = polygon[index]!;
    const b = polygon[last]!;
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// How far the point stands in from the map's nearest edge.
function edgeGap(point: Point, size: number) {
  return Math.min(point.x, point.y, size - point.x, size - point.y);
}

// @@@generated-noise - Value noise on a hashed lattice, smoothed: integer hashing and + - * / only, the same everywhere.
function latticeNoise(seed: number, x: number, y: number) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash01(seed, x0, y0);
  const b = hash01(seed, x0 + 1, y0);
  const c = hash01(seed, x0, y0 + 1);
  const d = hash01(seed, x0 + 1, y0 + 1);
  const top = a + (b - a) * sx;
  const bottom = c + (d - c) * sx;
  return top + (bottom - top) * sy;
}

function hash01(seed: number, x: number, y: number) {
  let hash = seed ^ Math.imul(x, 374_761_393) ^ Math.imul(y, 668_265_263);
  hash = Math.imul(hash ^ (hash >>> 13), 1_274_126_177);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4_294_967_296;
}

// Between -1 and 1: how far an edge at the point bulges out (or in).
function edgeNoise(seed: number, point: Point) {
  const coarse = latticeNoise(seed, point.x / 300, point.y / 300);
  const fine = latticeNoise(seed + 101, point.x / 110, point.y / 110);
  return (coarse * 0.65 + fine * 0.35) * 2 - 1;
}

// Between 0 and 1: a patch's strength at the point.
function patchNoise(seed: number, point: Point, scale: number) {
  return latticeNoise(seed, point.x / scale, point.y / scale) * 0.75 + latticeNoise(seed + 7, point.x / (scale / 3), point.y / (scale / 3)) * 0.25;
}

// The point beyond `mine` on the far side from `from` (a guard stands between its mine and the open map).
function mirrorAway(mine: Point, from: Point): Point {
  return { x: mine.x * 2 - from.x, y: mine.y * 2 - from.y };
}

function heading(angle: number): Point {
  return { x: detCos(angle), y: detSin(angle) };
}

function rotate(vector: Point, angle: number): Point {
  const cos = detCos(angle);
  const sin = detSin(angle);
  return { x: vector.x * cos - vector.y * sin, y: vector.x * sin + vector.y * cos };
}

function step(from: Point, direction: Point, length: number): Point {
  return { x: from.x + direction.x * length, y: from.y + direction.y * length };
}

function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function unit(vector: Point): Point {
  const length = Math.sqrt(vector.x * vector.x + vector.y * vector.y) || 1;
  return { x: vector.x / length, y: vector.y / length };
}

function distance(a: Point, b: Point) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function nearest(point: Point, others: Point[]) {
  return others.reduce((best, other) => Math.min(best, distance(point, other)), Infinity);
}

function apart(points: Point[], spacing: number) {
  return points.every((point, index) => points.every((other, otherIndex) => otherIndex <= index || distance(point, other) >= spacing));
}

function roundPoint(point: Point): Point {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}

function clampPoint(point: Point, size: number): Point {
  return { x: Math.round(Math.max(EDGE, Math.min(size - EDGE, point.x))), y: Math.round(Math.max(EDGE, Math.min(size - EDGE, point.y))) };
}

function pick<T>(random: () => number, choices: readonly T[]): T {
  return choices[Math.floor(random() * choices.length)]!;
}

// Mulberry32 over the seed's FNV-1a hash: integer arithmetic only, the same draws on every platform.
function seededRandom(seed: string): () => number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  let state = hash >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
