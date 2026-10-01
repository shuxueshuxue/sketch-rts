import { BUILDING_DEFS, UNIT_DEFS } from "./catalog";
import { detCos, detSin } from "./det-math";
import { createBuilding, createUnit, STANDARD_MAP_SIZE } from "./map";
import { cellIndexAt, isShoreFootprint, walkableGoal, type Terrain } from "./terrain";
import { seconds } from "./time";
import type { Building, GeneratedLayoutKind, GeneratedLayoutOptions, ItemKind, MapSite, MercenaryCamp, MercenaryUnitKind, PlayerId, ResourceNode, SeaForm, TerrainLandmark, Unit, UnitKind, WorldItem } from "./types";

// @@@generated-map - A seeded ladder map for a game of any size, drawn fresh for every seed, built the way a Warcraft III
// ladder map is: open ground to fight over, shaped by what stands on it (see @@@terrain).
// - Every player's main sits on a plateau walled by its cliff but for a single ramp, its main mine inside; its natural lies
//   at the foot of the ramp behind a medium guard; ways wind from the natural to the mines contested with each neighbour
//   (strong guards, a minor item) and on to the middle (a hard camp with the best item, over a mine on some maps); easy
//   camps stand in clearings beside the ways near home, a mercenary post in a clearing out on the contested ground.
// - The ground is open but for what a ladder map puts on it (see @@@generated-open): forest along the map's edge and round
//   the back of every main, a tree line between every two neighbours, and groves, outcrops and lakes in the ground between
//   the ways until the open share of the land comes down to the share drawn for the map. The ways and clearings themselves
//   stay open, so what stands beside them narrows them into chokes and never closes them.
// - A sea map's water takes one of several forms, with island mines only a ship reaches (see @@@generated-sea).
// - ring: the players stand on a ring around the center, an equal turn apart (on the edges, in the corners or anywhere
//   between), and the map is the same seen from every start; sides: two teams of equal size face each other across the
//   map, mirrored.
// Every feature is drawn with all its symmetric copies at once and kept only if every copy keeps its distances, and the
// grid itself is made exactly symmetric wherever the symmetry maps cells onto cells (two or four players on a ring, the
// mirror of two sides). A drawn map is kept only if every start, mine, camp and post is on one walkable whole, every
// main has room to build and every expansion room for a hall; otherwise the next draw is tried. Nothing in a layout names
// a player's version or role: the AIs read it as they read any map.

export type GeneratedMap = {
  kind: GeneratedLayoutKind;
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
  // Spots set aside for the game's posts: a shop's (see @@@shop), made by createGame.
  sites?: MapSite[];
};

type Point = { x: number; y: number };
// Ladder-map camp tiers: easy near home, medium at a natural, strong at contested mines and on routes, hard in the middle.
type CampTier = "easy" | "medium" | "strong" | "hard";
type Camp = { at: Point; tier: CampTier; item?: ItemKind };
// Blocker codes on the grid: 1 forest, 2 rock, 3 water.
type Blocker = 1 | 2 | 3;

// Terrain cells are this many units square.
export const TERRAIN_CELL = 32;
const MINE_GOLD = 6_000;
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
// Every path keeps this far outside every main's plateau (a main's own way down is carved apart, see ringLayout).
const PLATEAU_MARGIN = 96;
// @@@generated-open - What blocks a map's land, on open ground: forest (or rock, by patches) BORDER_CELLS deep along the
// map's edge; a skirt round the back of every main SKIRT beyond its plateau (the side toward its ramp stays open); a tree
// line between every two neighbours; then masses of MASS_RADIUS (a grove, an outcrop or a lake, in the shares of the map's
// theme) in the ground between the ways until the open share of the land is down to the map's share of WALK_SHARE (the
// old maps, carved out of forest, kept 18 to 28 per cent open); last, copses here and there for the eye.
const WALK_SHARE = [0.56, 0.68] as const;
const BORDER_CELLS = [2, 7] as const;
const SKIRT = [90, 240] as const;
const MASS_RADIUS = [110, 280] as const;
// @@@generated-sea - A sea map's water, drawn first, which every mine, camp, post and plateau keeps off (see Field.dry):
// - inland: a sea in the middle, SEA_SHARE of the map's size round its center, an island in it;
// - isles: a smaller sea in the middle with an island, and a lobe toward every gap between neighbours, an island in each;
// - strait (two players): a strait across the map between them, an island in a lagoon at its middle;
// - rivers: a river from the map's edge between every two neighbours, winding in to a lagoon with an island in the middle;
// - coast (two or four players, or two teams: no other ring stands alike on a square's edges): a sea all along the map's
//   edge, COAST_SHARE of its size deep, an island in a bay between every two neighbours.
// Every island holds a mine behind a guard (the middle's with the hard camp and the best item) that only a ship reaches:
// ISLAND_WATER of water round it keeps its shallows off the land's. A way may cross a river or a strait, where its ground
// becomes a ford of shallows (walked and sailed both), never a sea, a lagoon or a bay. Every start has a beach on the water
// nearest its natural, with a way down to it, and the rim of all water is a strip of shallows, where soldiers wade out to
// strike a ship (see @@@terrain-movers). A draw is kept only if every beach takes a shipyard on one water, the water every
// island's mine is reached from.
const SEA_SHARE = { duel: [0.12, 0.14], more: [0.15, 0.18] } as const;
const SEA_WOBBLE = 0.12;
const COAST_SHARE = [0.07, 0.09] as const;
const ISLAND_RADIUS = 300;
const ISLAND_WATER = 200;
const BEACH_RADIUS = 190;

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
const MINOR_ITEMS: ItemKind[] = ["experienceBook", "guardianScroll"];
const MAJOR_ITEMS: ItemKind[] = ["lightningRod", "flameCloak", "stormStaff", "breachCharge"];
const MERC_KINDS: MercenaryUnitKind[] = ["mercenary", "contractArcher", "fieldMedic"];
// A map's look: the shares of its masses that are groves, outcrops and lakes (a sea map's lakes are groves: its water is
// the sea's), and where its edges and tree lines turn to rock (where a patch noise runs over `rockFill`).
const THEMES: { forest: number; rock: number; water: number; rockFill: number }[] = [
  { forest: 0.65, rock: 0.2, water: 0.15, rockFill: 0.72 },
  { forest: 0.25, rock: 0.6, water: 0.15, rockFill: 0.56 },
  { forest: 0.4, rock: 0.15, water: 0.45, rockFill: 0.74 },
  { forest: 0.45, rock: 0.35, water: 0.2, rockFill: 0.64 },
];
const KIND_CHAR = { ground: ".", shallow: ",", forest: "T", rock: "#", water: "~" } as const;

export function generateMap(options: GeneratedLayoutOptions, players: PlayerId[], teams: Record<PlayerId, string>): GeneratedMap {
  const random = seededRandom(options.seed);
  const teamOrder = [...new Set(players.map((player) => teams[player] ?? player))];
  const teamSizes = teamOrder.map((team) => players.filter((player) => (teams[player] ?? player) === team).length);
  const evenTeams = teamOrder.length === 2 && teamSizes[0] === teamSizes[1] && teamSizes[0]! >= 2;
  const kind = options.kind ?? (evenTeams && random() < 1 / 3 ? "sides" : "ring");
  if (kind === "sides" && !evenTeams) throw new Error(`A sides layout needs two teams of the same size (two or more), not ${teamSizes.join(" and ")}`);
  const forms = seaForms(kind, players.length);
  if (typeof options.sea === "string" && !forms.includes(options.sea)) throw new Error(`No ${options.sea} sea is drawn on a ${kind} layout for ${players.length} players`);
  const form = options.sea === true ? pick(random, forms) : options.sea || undefined;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    // The last draws leave the land between the ways open: no mass or copse can cost a map its connection.
    const plain = attempt >= ATTEMPTS - 5;
    const field = new Field(random, options.size ?? pick(random, sizesFor(kind, players.length, form !== undefined)), kind, players.length, form);
    const drawn = kind === "sides" ? sidesLayout(field, players, teams, teamOrder) : ringLayout(field, players, teams, teamOrder);
    if (!drawn) continue;
    const terrain = carveTerrain(field, plain);
    if (!terrain) continue;
    return assemble(kind, field, players, terrain);
  }
  throw new Error(`No ladder map fits the seed ${options.seed} for ${players.length} players`);
}

// The forms a layout's sea takes (see @@@generated-sea), in the order a seed picks from.
function seaForms(kind: GeneratedLayoutKind, count: number): SeaForm[] {
  if (kind === "sides") return ["strait", "coast"];
  return ["inland", "isles", ...(count === 2 ? ["strait" as const] : []), "rivers", ...(count === 2 || count === 4 ? ["coast" as const] : [])];
}

// A sea map is a size up from a land map for as many players: the sea takes its share.
function sizesFor(kind: GeneratedLayoutKind, count: number, sea = false): number[] {
  if (sea) return sizesFor(kind, count).map((size) => size + 512);
  if (kind === "sides") return count <= 4 ? [STANDARD_MAP_SIZE + 512, STANDARD_MAP_SIZE + 1_024] : [STANDARD_MAP_SIZE + 1_536, STANDARD_MAP_SIZE + 2_048];
  if (count <= 2) return [STANDARD_MAP_SIZE, STANDARD_MAP_SIZE + 512];
  if (count <= 4) return [STANDARD_MAP_SIZE + 512, STANDARD_MAP_SIZE + 1_024];
  // More players stand on a longer ring: the map grows with the square root of their number.
  const grown = Math.ceil((STANDARD_MAP_SIZE + 768) * Math.sqrt(count / 4) / 512) * 512;
  return [grown, grown + 512];
}

// A disk of ground kept open (a clearing, a plateau), its edge wobbling by `wobble` of its radius.
type Clearing = { at: Point; radius: number; wobble: number; plateau?: boolean };
// A path along its points, `half` wide either side: a way kept open, or a tree line between neighbours.
type Path = { points: Point[]; half: number; wobble: number };
// Water along its points, `half` wide either side (one point: a disk); a way fords it where it may (see @@@generated-sea).
type Water = { points: Point[]; half: number; wobble: number; ford: boolean };
type Island = { at: Point; radius: number };
// Where a beach meets the water, and the way out onto it.
type Shore = { at: Point; out: Point };

// Everything placed so far, and whether a feature with all its copies keeps its distances from it.
class Field {
  readonly starts = new Map<PlayerId, { base: Point; mine: Point }>();
  readonly bases: Point[] = [];
  readonly mains: Point[] = [];
  readonly mines: Point[] = [];
  readonly camps: Camp[] = [];
  readonly mercs: { at: Point; kind: MercenaryUnitKind }[] = [];
  readonly clearings: Clearing[] = [];
  readonly paths: Path[] = [];
  readonly walls: Path[] = [];
  // Every main's plateau and the foot of its way down, by start.
  readonly plateaus: { base: Point; radius: number; ramp: Point; rampRadius: number }[] = [];
  // Ground that stays open whatever is drawn on it (a start, a mine and its hall, a camp, a post).
  readonly reserved: { at: Point; radius: number }[] = [];
  // A sea map's water (see @@@generated-sea): rivers, straits and seas, the depth of the sea along the map's edge, the
  // islands in it, and every start's shore.
  readonly waters: Water[] = [];
  coast = 0;
  readonly islands: Island[] = [];
  readonly shores: Shore[] = [];
  // The draws a map makes once for every copy of a feature.
  readonly easyKinds: UnitKind[];
  readonly mediumKinds: UnitKind[];
  readonly strongKinds: UnitKind[];
  readonly hardKinds: UnitKind[];
  readonly minorItem: ItemKind;
  readonly majorItem: ItemKind;
  readonly mercKind: MercenaryUnitKind;
  readonly theme: (typeof THEMES)[number];
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
    readonly form: SeaForm | undefined,
  ) {
    this.center = size / 2;
    this.easyKinds = pick(random, CAMP_KINDS.easy);
    this.mediumKinds = pick(random, CAMP_KINDS.medium);
    this.strongKinds = pick(random, CAMP_KINDS.strong);
    this.hardKinds = pick(random, CAMP_KINDS.hard);
    this.minorItem = pick(random, MINOR_ITEMS);
    this.majorItem = pick(random, MAJOR_ITEMS);
    this.mercKind = pick(random, MERC_KINDS);
    this.theme = pick(random, THEMES);
    this.walkShare = this.between(WALK_SHARE[0], WALK_SHARE[1]);
    this.noiseSeed = Math.floor(random() * 2_147_483_647);
  }

  between(low: number, high: number) {
    return low + this.random() * (high - low);
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

  // Whether ground `reach` round the point stays land: on an island, or off every water at its widest.
  dry(point: Point, reach: number) {
    if (this.islands.some((island) => distance(point, island.at) + reach <= island.radius)) return true;
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

  // Whether a way may pass the point `reach` wide: off every water but a river or a strait, which it fords.
  fordable(point: Point, reach: number) {
    if (this.coast > 0 && edgeGap(point, this.size) < this.coast * (1 + SEA_WOBBLE) + reach) return false;
    return this.waters.every((water) => water.ford || toPolyline(point, water.points) >= water.half * (1 + water.wobble) + reach);
  }

  // Whether ground `reach` around the point stays clear of every plateau.
  offPlateaus(point: Point, reach: number) {
    return this.plateaus.every((plateau) => distance(point, plateau.base) >= plateau.radius + reach + PLATEAU_MARGIN);
  }

  // Whether a path keeps off every plateau, and off all water but what it fords unless it is the way down to a beach.
  pathFits(path: Path, toShore: boolean) {
    return (
      path.points.every((point) => this.plateaus.every((plateau) => distance(point, plateau.base) >= plateau.radius + path.half * 1.2 + PLATEAU_MARGIN)) &&
      (toShore || samplesAlong(path.points, TERRAIN_CELL * 1.5).every((point) => this.fordable(point, path.half * 1.2))) &&
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

  addCamps(copies: Point[], tier: CampTier, item?: ItemKind) {
    this.camps.push(...copies.map((at) => ({ at, tier, ...(item ? { item } : {}) })));
    for (const at of copies) this.reserved.push({ at, radius: 110 });
  }

  // The mines and their guards: each guard GUARD_OFFSET from its mine toward `awayFrom`, or turned from that by up to 90
  // degrees either way where that crowds another camp (every copy turned alike); a guard that fits nowhere is left out.
  addGuardedMines(mines: Point[], tier: CampTier, awayFrom: (mine: Point, index: number) => Point, item?: ItemKind) {
    this.mines.push(...mines);
    // A hall stands within about 120 of its mine on any side the AI picks (see expansionOffset): the ground stays open.
    for (const at of mines) this.reserved.push({ at, radius: 230 });
    for (const turn of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) {
      const guards = mines.map((mine, index) => roundPoint(step(mine, rotate(unit(sub(awayFrom(mine, index), mine)), turn), GUARD_OFFSET)));
      if (!this.campFits(guards, mines, START_SAFETY + CAMP_SPREAD + 10)) continue;
      this.addCamps(guards, tier, item);
      return;
    }
  }

  // An island with all its copies (one, on the mirror's line), in a bay of its own unless the water round it is drawn
  // already.
  addIslands(at: Point, bay: boolean) {
    const copies = this.symmetry.copies(at).map(roundPoint);
    for (const copy of copies.filter((copy, index) => copies.findIndex((other) => distance(other, copy) < 1) === index)) {
      if (bay) this.waters.push({ points: [copy], half: ISLAND_RADIUS + ISLAND_WATER, wobble: 0.08, ford: false });
      this.islands.push({ at: copy, radius: ISLAND_RADIUS });
    }
  }

  // A path from `from` to `to`, bowed sideways by `bend` of its length (or the other way, or straight, where that bow
  // crowds a plateau or the water; on a sea map wider bows too, round the water's lobes and bays), with all its copies;
  // round a sea in the middle where no bow keeps off it (see roundSea). Returns the first copy's points, or nothing where
  // no way fits.
  addPath(from: Point, to: Point, half: number, bend: number, toShore = false): Point[] | undefined {
    const ways = [bend, -bend, bend / 2, 0, ...(this.form ? [0.4, -0.4, 0.6, -0.6] : [])].map((bow) => curve(from, to, bow));
    const middle = { x: this.center, y: this.center };
    if (this.waters.some((water) => !water.ford && distance(water.points[0]!, middle) < 1)) ways.push(roundSea(middle, from, to));
    for (const points of ways) {
      const copies = this.pathCopies(points, half);
      if (!copies.every((path) => this.pathFits(path, toShore))) continue;
      this.paths.push(...copies);
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

  // A beach for every start on the water nearest `from` (its natural), with a way down to it: the nearest shore the way
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

// @@@generated-ring - One slot is drawn and turned around the center for every player; teammates take neighbouring slots.
function ringLayout(field: Field, players: PlayerId[], teams: Record<PlayerId, string>, teamOrder: string[]): boolean {
  const SIZE = field.size;
  const CENTER = field.center;
  const count = Math.max(2, players.length);
  const turn = (Math.PI * 2) / count;
  const offsetRoll = field.random();
  const firstAngle = offsetRoll < 0.35 ? 0 : offsetRoll < 0.7 ? turn / 2 : field.random() * turn;
  field.symmetry = ringSymmetry(SIZE, count, firstAngle);
  const copies = (point: Point) => field.symmetry.copies(point);
  const polar = (radius: number, angle: number): Point => ({ x: CENTER + detCos(angle) * radius, y: CENTER + detSin(angle) * radius });
  const ordered = [...players].sort((a, b) => teamOrder.indexOf(teams[a] ?? a) - teamOrder.indexOf(teams[b] ?? b));
  // The heading between the first start and the next, where what they contest lies.
  const between = firstAngle + turn / 2;
  const middle = { x: CENTER, y: CENTER };

  // The main: a plateau round the start with the main mine inside, a tenth of the map or more from every border (and
  // from the sea along it, on a coast).
  const plateau = field.between(500, 570);
  const coast = field.form === "coast" ? SIZE * field.between(COAST_SHARE[0], COAST_SHARE[1]) : 0;
  const reachCap = (CENTER - plateau - (coast > 0 ? coast * (1 + SEA_WOBBLE) + 160 : 110)) / Math.max(Math.abs(detCos(firstAngle)), Math.abs(detSin(firstAngle)));
  // Round a sea in the middle the starts stand a little farther out (see @@@generated-sea).
  const outward = field.form === "inland" || field.form === "isles";
  const radius = Math.min(SIZE * field.between(outward ? 0.35 : 0.31, outward ? 0.4 : 0.37), reachCap);
  const base = roundPoint(polar(radius, firstAngle));
  const inward = heading(firstAngle + Math.PI);
  const mineSide = field.random() < 0.5 ? -1 : 1;
  const mine = roundPoint(step(base, rotate(inward, mineSide * field.between(1.05, 1.65)), 230));
  copies(base).forEach((at, slot) => {
    const start = roundPoint(at);
    field.bases.push(start);
    if (ordered[slot]) field.starts.set(ordered[slot]!, { base: start, mine: roundPoint(copies(mine)[slot]!) });
  });
  field.mains.push(...copies(mine).map(roundPoint));
  for (const at of field.bases) field.reserved.push({ at, radius: 300 });
  for (const at of field.mains) field.reserved.push({ at, radius: 150 });
  if (field.form && !ringSea(field, base, plateau, between, coast)) return false;

  // The natural at the foot of the ramp, and the ramp itself on the plateau's rim toward it: tucked by its own main, well
  // away from every other start and natural (naturals halfway to the middle stood 900 apart, so a neighbour's army was
  // always by one's guard and the natural never got taken).
  const natural = field.place(
    () => copies(step(base, rotate(inward, (field.random() < 0.5 ? -1 : 1) * field.between(0.3, 1.6)), plateau + field.between(290, 400))),
    (mines) =>
      field.mineFits(mines, 600, NATURAL_MAIN_SPACING) &&
      apart(mines, NATURAL_SPACING) &&
      mines.every((at, slot) => field.bases.every((other, index) => index === slot || distance(at, other) >= NATURAL_SPACING + 100)),
  );
  if (!natural) return false;
  const away = unit(sub(natural[0]!, base));
  const naturalArea = roundPoint(step(natural[0]!, away, field.between(40, 110)));
  const rampDirection = rotate(unit(sub(naturalArea, base)), field.between(-0.25, 0.25));
  // The plateau: a core round the start and three lobes, one reaching toward the ramp; its rim is at most `plateau` out.
  const lobes = plateauLobes(field, base, rampDirection, plateau);
  const ramp = step(base, rampDirection, plateau * 0.95);
  const rampHalf = field.between(85, 115);
  copies(base).forEach((at, slot) => field.plateaus.push({ base: roundPoint(at), radius: plateau, ramp: roundPoint(copies(ramp)[slot]!), rampRadius: rampHalf + 48 }));
  for (const lobe of lobes) for (const at of copies(lobe.at)) field.clearings.push({ at: roundPoint(at), radius: lobe.radius, wobble: 0.08, plateau: true });
  field.addClearings(copies(naturalArea).map(roundPoint), field.between(320, 400), 0.1);
  field.addGuardedMines(natural, "medium", (at, slot) => mirrorAway(at, field.bases[slot]!));
  // The way down: from inside the plateau, over the rim at the ramp, to the natural's clearing.
  field.paths.push(...field.pathCopies([step(base, rampDirection, plateau * 0.55), ramp, naturalArea], rampHalf));

  // The mine contested with the next start, behind a strong guard with a minor item; where water parts neighbours (a
  // strait, a river, a sea's lobe) it stands on either bank, nearer one of them.
  const spread = field.form === "strait" || field.form === "rivers" || field.form === "isles" ? 0.3 : 0.12;
  const contested = field.place(
    () => copies(polar(radius * field.between(0.5, 0.95), between + field.between(-spread, spread) * turn)),
    (mines) => field.mineFits(mines, CONTESTED_START_SPACING) && mines.every((at) => field.offPlateaus(at, 330)),
  );
  if (!contested) return false;
  field.addClearings(contested, field.between(280, 340), 0.12);
  field.addGuardedMines(contested, "strong", () => middle, field.minorItem);
  const ahead = contested[0]!;
  const behind = roundPoint(copies(ahead)[count - 1]!);

  // The middle: a hard camp with the best item, over a mine on some maps; on an island in the middle, all three, which only
  // a ship reaches. Every other island holds a mine behind a medium guard.
  const middleIsland = field.islands.some((island) => distance(island.at, middle) < 1);
  if (middleIsland) field.addGuardedMines([middle], "hard", () => polar(1, between), field.majorItem);
  else if (field.dry(middle, 300)) {
    field.clearings.push({ at: middle, radius: field.between(300, 480), wobble: 0.14 });
    const middleMine = field.random() < 0.5 && field.mineFits([middle], CONTESTED_START_SPACING);
    if (middleMine) field.addGuardedMines([middle], "hard", () => polar(1, between), field.majorItem);
    else if (field.campFits([middle], [], CONTESTED_START_SPACING)) field.addCamps([middle], "hard", field.majorItem);
  }
  const outer = field.islands.filter((island) => distance(island.at, middle) >= 1).map((island) => island.at);
  if (outer.length > 0) field.addGuardedMines(outer, "medium", () => middle);

  // Paths from the natural to both contested mines, and on to the middle from the natural or the contested mine (or both)
  // where the middle is land.
  const width = () => field.between(70, 120);
  const bend = () => field.between(-0.22, 0.22);
  const toAhead = field.addPath(naturalArea, ahead, width(), bend());
  const toBehind = field.addPath(naturalArea, behind, width(), bend());
  if (!toAhead || !toBehind) return false;
  let toMiddle: Point[] | undefined;
  if (!middleIsland && field.dry(middle, 0)) {
    const roll = field.random();
    const fromNatural = roll < 0.75 ? field.addPath(naturalArea, middle, width(), bend()) : undefined;
    const fromContested = roll >= 0.45 || !fromNatural ? field.addPath(ahead, middle, width(), bend()) : undefined;
    toMiddle = fromNatural ?? fromContested;
    if (!toMiddle) return false;
  }

  // Easy camps in clearings beside the paths out of the natural, a strong camp on the way to the middle, a mercenary
  // post in a clearing out on the contested ground.
  for (const path of [toAhead, toBehind]) {
    const easy = field.place(() => copies(besidePath(path, field.between(0.3, 0.6), (field.random() < 0.5 ? -1 : 1) * field.between(40, 170))), (camps) => field.campFits(camps, [], 600));
    if (!easy) continue;
    field.addClearings(easy, field.between(130, 170), 0.15);
    field.addCamps(easy, "easy");
  }
  const middlePath = toMiddle;
  if (middlePath) {
    const route = field.place(() => copies(besidePath(middlePath, field.between(0.4, 0.7), field.between(-50, 50))), (camps) => field.campFits(camps, [], CONTESTED_START_SPACING));
    if (route) field.addCamps(route, "strong");
  }
  const merc = field.place(() => copies(besidePath(middlePath ? pick(field.random, [middlePath, toAhead]) : toAhead, field.between(0.35, 0.8), (field.random() < 0.5 ? -1 : 1) * field.between(150, 230))), (posts) => field.mercFits(posts));
  if (merc) {
    field.addClearings(merc, 150, 0.12);
    field.mercs.push(...merc.map((at) => ({ at, kind: field.mercKind })));
    for (const at of merc) field.reserved.push({ at, radius: 100 });
  }
  if (field.form && !field.addBeaches(naturalArea, width(), bend())) return false;

  // A tree line between every two neighbours, from beyond the map's edge in to the mine they contest, where no river or
  // strait parts them already.
  if (field.form !== "strait" && field.form !== "rivers") {
    const reach = distance(ahead, middle);
    const edge = CENTER / Math.max(Math.abs(detCos(between)), Math.abs(detSin(between)));
    if (edge > reach) field.walls.push(...field.pathCopies(curve(polar(edge + 160, between), polar(reach, between), field.between(-0.12, 0.12)), field.between(48, 84), 0.35));
  }
  return true;
}

// A ring's sea (see @@@generated-sea), drawn once the first main stands; false where it would crowd that main's plateau.
function ringSea(field: Field, base: Point, plateau: number, between: number, coast: number): boolean {
  const middle = { x: field.center, y: field.center };
  const polar = (radius: number, angle: number): Point => roundPoint({ x: field.center + detCos(angle) * radius, y: field.center + detSin(angle) * radius });
  const lagoon = () => {
    field.waters.push({ points: [middle], half: ISLAND_RADIUS + ISLAND_WATER, wobble: 0.08, ford: false });
    field.islands.push({ at: middle, radius: ISLAND_RADIUS });
  };
  if (field.form === "inland") {
    const [low, high] = field.count <= 2 ? SEA_SHARE.duel : SEA_SHARE.more;
    field.waters.push({ points: [middle], half: field.size * field.between(low, high), wobble: SEA_WOBBLE, ford: false });
    field.islands.push({ at: middle, radius: ISLAND_RADIUS });
  } else if (field.form === "isles") {
    field.waters.push({ points: [middle], half: field.size * field.between(0.11, 0.13), wobble: SEA_WOBBLE, ford: false });
    field.islands.push({ at: middle, radius: ISLAND_RADIUS });
    field.addIslands(polar(field.between(800, 900), between), true);
  } else if (field.form === "strait") {
    // Across the map between the two starts, bowed into an S through the middle (the same turned half round).
    const side = heading(between + Math.PI / 2);
    const bow = field.size * field.between(-0.08, 0.08);
    const a = polar(field.size, between);
    const b = polar(field.size, between + Math.PI);
    const points = [a, step(lerp(a, middle, 0.5), side, bow), middle, step(lerp(b, middle, 0.5), side, -bow), b].map(roundPoint);
    field.waters.push({ points, half: field.size * field.between(0.045, 0.06), wobble: 0.15, ford: true });
    lagoon();
  } else if (field.form === "rivers") {
    const half = field.between(64, 100);
    const bend = (field.random() < 0.5 ? -1 : 1) * field.between(0.08, 0.2);
    for (const mouth of field.symmetry.copies(polar(field.size * 0.75, between))) field.waters.push({ points: curve(roundPoint(mouth), middle, bend), half, wobble: 0.25, ford: true });
    lagoon();
  } else if (field.form === "coast") {
    field.coast = coast;
    const edge = field.center / Math.max(Math.abs(detCos(between)), Math.abs(detSin(between)));
    field.addIslands(polar(edge - ISLAND_RADIUS - 110, between), true);
  }
  return field.dry(base, plateau + 150);
}

// @@@generated-sides - Two teams of equal size face each other across the map, each along its edge, the halves mirrored.
// Every player has its plateau, its ramp and its natural; the contested mines stand down the middle line, the hard camp
// with the best item at the middle one. Half the maps turn the whole field a quarter, so the teams face top and bottom.
// A strait down the middle line puts the contested mines on islands in it, every player a third mine on its own bank and a
// ford straight across from its natural; a coast runs a sea round the map, with an island at either end of the middle line.
function sidesLayout(field: Field, players: PlayerId[], teams: Record<PlayerId, string>, teamOrder: string[]): boolean {
  const SIZE = field.size;
  const CENTER = field.center;
  const quarter = field.random() < 0.5;
  field.symmetry = mirrorSymmetry(SIZE, quarter);
  // A point of the left side before the turn, turned (and back: the turn is its own inverse).
  const place = (point: Point): Point => roundPoint(quarter ? { x: point.y, y: point.x } : point);
  const members = teamOrder.map((team) => players.filter((player) => (teams[player] ?? player) === team));
  const perSide = members[0]!.length;
  const plateau = field.between(480, 540);
  const coast = field.form === "coast" ? SIZE * field.between(COAST_SHARE[0], COAST_SHARE[1]) : 0;
  const margin = plateau + 130 + (coast > 0 ? coast * (1 + SEA_WOBBLE) + 50 : 0);
  field.coast = coast;
  const strait = field.form === "strait";
  if (strait) field.waters.push({ points: [place({ x: CENTER, y: -200 }), place({ x: CENTER, y: SIZE + 200 })], half: SIZE * field.between(0.04, 0.055), wobble: 0.15, ford: true });
  if (coast > 0) for (const y of [ISLAND_RADIUS + 110, SIZE - ISLAND_RADIUS - 110]) field.addIslands(place({ x: CENTER, y }), true);
  // One side is drawn (the left, before any turn); the mirror gives the other.
  const own: { base: Point; natural: Point; area: Point }[] = [];
  for (let index = 0; index < perSide; index += 1) {
    const y = SIZE * (0.1 + ((index + 0.5) / perSide) * 0.8);
    const base = place({ x: margin, y });
    const mine = place({ x: margin - 150, y: y + (index % 2 === 0 ? -170 : 170) });
    const natural = place({ x: margin + plateau + field.between(260, 380), y: y + field.between(-160, 160) });
    own.push({ base, natural, area: place({ x: margin + plateau + field.between(320, 440), y: y + field.between(-120, 120) }) });
    for (const [side, team] of members.entries()) {
      const player = team[index]!;
      const start = side === 0 ? base : field.symmetry.copies(base)[1]!;
      const main = side === 0 ? mine : field.symmetry.copies(mine)[1]!;
      field.starts.set(player, { base: roundPoint(start), mine: roundPoint(main) });
    }
  }
  if (!own.every(({ base }) => field.dry(base, plateau + 150))) return false;
  for (const { base } of own) {
    for (const at of field.symmetry.copies(base)) {
      field.bases.push(roundPoint(at));
      field.reserved.push({ at: roundPoint(at), radius: 300 });
    }
  }
  for (const start of field.starts.values()) {
    field.mains.push(start.mine);
    field.reserved.push({ at: start.mine, radius: 150 });
  }
  own.forEach(({ base, natural, area }) => {
    const copies = field.symmetry.copies(base);
    const rampDirection = unit(sub(area, base));
    const ramp = step(base, rampDirection, plateau * 0.95);
    const rampHalf = field.between(85, 115);
    const lobes = plateauLobes(field, base, rampDirection, plateau);
    copies.forEach((at, side) => field.plateaus.push({ base: roundPoint(at), radius: plateau, ramp: roundPoint(field.symmetry.copies(ramp)[side]!), rampRadius: rampHalf + 48 }));
    for (const lobe of lobes) for (const at of field.symmetry.copies(lobe.at)) field.clearings.push({ at: roundPoint(at), radius: lobe.radius, wobble: 0.08, plateau: true });
    field.addClearings(field.symmetry.copies(area).map(roundPoint), field.between(340, 420), 0.1);
    field.paths.push(...field.pathCopies([step(base, rampDirection, plateau * 0.55), ramp, area], rampHalf));
    if (field.mineFits(field.symmetry.copies(natural).map(roundPoint), 600, NATURAL_MAIN_SPACING)) {
      const naturals = field.symmetry.copies(natural).map(roundPoint);
      field.addGuardedMines(naturals, "medium", (at, copy) => mirrorAway(at, field.symmetry.copies(base)[copy]!));
    }
  });
  // The contested mines down the middle line, one more than a side has players, the middle one behind the hard camp. A
  // strait is forded straight across from every natural, and its mines stand on islands between the fords and at its ends,
  // the one nearest the middle behind the hard camp.
  const middle = { x: CENTER, y: CENTER };
  const fords = own.map(({ area }) => place(area).y);
  const lines = strait
    ? [ISLAND_RADIUS + 110, ...fords.slice(1).map((y, index) => (fords[index]! + y) / 2), SIZE - ISLAND_RADIUS - 110].filter((y) => fords.every((ford) => Math.abs(ford - y) >= 720))
    : Array.from({ length: perSide + 1 }, (_, index) => SIZE * (0.12 + ((index + 0.5) / (perSide + 1)) * 0.76));
  const middleLine = lines.reduce((best, y) => (Math.abs(y - CENTER) < Math.abs(best - CENTER) ? y : best), lines[0]!);
  const contested: Point[] = [];
  lines.forEach((y, index) => {
    const mine = place({ x: CENTER, y });
    if (strait) field.addIslands(mine, true);
    if (!field.mineFits([mine], CONTESTED_START_SPACING)) {
      if (strait) {
        field.islands.pop();
        field.waters.pop();
      }
      return;
    }
    if (!strait) {
      contested.push(mine);
      field.clearings.push({ at: mine, radius: field.between(320, 400), wobble: 0.12 });
    }
    const along = (at: Point) => place({ x: CENTER, y: (quarter ? at.x : at.y) + 1 });
    field.addGuardedMines([mine], y === middleLine ? "hard" : "strong", along, y === middleLine ? field.majorItem : index === 0 ? field.minorItem : undefined);
  });
  const ends = field.islands.filter((island) => coast > 0 && distance(island.at, middle) > CENTER * 0.6).map((island) => island.at);
  if (ends.length > 0) field.addGuardedMines(ends, "medium", () => middle);
  // On a strait, every player's third mine on its own bank, toward the strait.
  if (strait) {
    for (const { natural } of own) {
      const from = place(natural);
      const third = field.place(() => field.symmetry.copies(place({ x: from.x + field.between(420, 640), y: from.y + field.between(-420, 420) })), (mines) => field.mineFits(mines, CONTESTED_START_SPACING));
      if (!third) return false;
      contested.push(third[0]!);
      field.addClearings(third, field.between(280, 340), 0.12);
      field.addGuardedMines(third, "strong", (at, copy) => mirrorAway(at, field.symmetry.copies(natural)[copy]!), field.minorItem);
    }
  }
  if (contested.length === 0) return false;
  const width = () => field.between(70, 120);
  // Every natural reaches the two mines nearest it (on a strait, its third and a ford straight across to the other bank);
  // neighbours on a side reach each other.
  // Every natural's first way out, where its easy camp stands.
  const leads: Point[][] = [];
  for (const { area } of own) {
    const ford = place({ x: CENTER, y: place(area).y });
    const targets = strait ? [[...contested].sort((a, b) => distance(a, area) - distance(b, area))[0]!, ford] : [...contested].sort((a, b) => distance(a, area) - distance(b, area)).slice(0, 2);
    for (const [index, target] of targets.entries()) {
      const path = field.addPath(area, target, width(), strait ? 0 : field.between(-0.2, 0.2));
      if (!path) return false;
      if (index === 0) leads.push(path);
    }
  }
  for (let index = 1; index < own.length; index += 1) field.addPath(own[index - 1]!.area, own[index]!.area, width(), field.between(-0.2, 0.2));
  for (const path of leads) {
    const easy = field.place(() => field.symmetry.copies(besidePath(path, field.between(0.3, 0.6), (field.random() < 0.5 ? -1 : 1) * field.between(60, 170))), (camps) => field.campFits(camps, [], 600));
    if (!easy) continue;
    field.addClearings(easy, field.between(130, 170), 0.15);
    field.addCamps(easy, "easy");
  }
  const merc = field.place(() => field.symmetry.copies(place({ x: SIZE * field.between(0.3, 0.42), y: SIZE * field.between(0.2, 0.8) })), (posts) => field.mercFits(posts));
  if (merc) {
    field.addClearings(merc, 170, 0.12);
    const landMines = contested.flatMap((mine) => field.symmetry.copies(mine).map(roundPoint));
    for (const at of merc) {
      const target = [...landMines].sort((a, b) => distance(a, at) - distance(b, at))[0]!;
      field.paths.push({ points: curve(at, target, 0), half: 90, wobble: 0.16 });
    }
    field.mercs.push(...merc.map((at) => ({ at, kind: field.mercKind })));
    for (const at of merc) field.reserved.push({ at, radius: 100 });
  }
  if (field.form && !own.every(({ area }) => field.addBeaches(area, width(), field.between(-0.2, 0.2)))) return false;
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
      if (field.waterGap(at) > 0) continue;
      const beach = step(at, out, -BEACH_RADIUS * 0.6);
      if (field.offPlateaus(beach, BEACH_RADIUS * 0.6) && field.inside([beach], 200)) found.push({ at: roundPoint(at), out, reach });
      break;
    }
  }
  return found.sort((a, b) => a.reach - b.reach).map(({ at, out }) => ({ at, out }));
}

// @@@generated-terrain - The grid is drawn from the layout on open ground: every clearing and path is kept open, the water
// sunk (fords where a way crosses a river or a strait) and its islands raised, then what blocks the land (see
// @@@generated-open) is set round the kept ground; the grid is made symmetric, each main's rim becomes a cliff but for its
// ramp, stray pockets and specks are filled or cleared, the water's rim becomes shallows, and the map is kept only if every
// start reaches everything, no island is walked to, and every shore takes a shipyard on one water.
function carveTerrain(field: Field, plain: boolean): Terrain | undefined {
  const cells = Math.round(field.size / TERRAIN_CELL);
  const grid = new Grid(cells, field);
  for (const clearing of field.clearings) grid.keep(clearing.at, clearing.radius, clearing.wobble, clearing.plateau === true);
  for (const path of field.paths) grid.keepPath(path);
  for (const plateau of field.plateaus) grid.markRamp(plateau.ramp, plateau.rampRadius);
  for (const reserved of field.reserved) grid.keep(reserved.at, reserved.radius, 0, false);
  for (const water of field.waters) grid.sink(water);
  if (field.coast > 0) grid.sinkCoast(field.coast);
  grid.ford();
  for (const island of field.islands) grid.raise(island.at, island.radius);
  grid.border();
  grid.skirts();
  for (const wall of field.walls) grid.wall(wall);
  if (!grid.keepReachable(field.bases[0]!)) return undefined;
  if (!plain) {
    placeMasses(field, grid);
    placeCopses(field, grid);
  }
  grid.symmetrize();
  grid.raiseCliffs();
  grid.frame();
  if (!grid.keepReachable(field.bases[0]!)) return undefined;
  grid.clearSpecks();
  grid.shoal();
  const required = [...field.bases, ...field.mains, ...field.mines, ...field.camps.map((camp) => camp.at), ...field.mercs.map((merc) => merc.at)];
  if (!required.every((point) => grid.walkableAt(point))) return undefined;
  if (!field.bases.every((base) => grid.roomAround(base, 450) >= 0.55)) return undefined;
  if (!field.mines.every((mine) => grid.hallFits(mine))) return undefined;
  if (grid.islandWalked(field.bases[0]!)) return undefined;
  const terrain = grid.terrain();
  if (field.form && !oneSea(field, terrain)) return undefined;
  return terrain;
}

// Whether every shore takes a shipyard (see @@@shore-footprint) on one water, the water every island's mine is reached from.
function oneSea(field: Field, terrain: Terrain) {
  const map = { terrain, width: field.size, height: field.size };
  const yards = field.shores.map((shore) => shipyardWater(map, shore));
  if (yards.some((yard) => yard < 0)) return false;
  const sea = seaCells(terrain, yards[0]!);
  const landings = field.islands.map((island) => {
    const at = walkableGoal(map, island.at.x, island.at.y, "sea");
    return cellIndexAt(terrain, at.x, at.y);
  });
  return [...yards, ...landings].every((index) => index >= 0 && sea[index] === 1);
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

// The water a ship sails from the cell (four ways, deep or shallow): 1 for each cell.
function seaCells(terrain: Terrain, start: number) {
  const reached = new Uint8Array(terrain.cols * terrain.rows);
  const wet = (index: number) => terrain.cells[index] === "~" || terrain.cells[index] === ",";
  if (start < 0 || !wet(start)) return reached;
  const queue = [start];
  reached[start] = 1;
  for (let head = 0; head < queue.length; head += 1) {
    const index = queue[head]!;
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
  return reached;
}

// The blocker a mass of the map's theme is made of (see @@@generated-open): a sea map's lakes are groves.
function massKind(field: Field): Blocker {
  const { forest, rock, water } = field.theme;
  const roll = field.random() * (forest + rock + water);
  if (roll < forest) return 1;
  if (roll < forest + rock) return 2;
  return field.form ? 1 : 3;
}

// @@@generated-masses - Groves, ridges, outcrops and lakes: each a chain of one to four disks, every one beside the last,
// turned from its heading and smaller, set with all its copies on open land off the ways, until the open share of the land
// is down to the map's share (or the draws run out). A mass that would cut any open ground off from the starts is taken
// back: the land between the ways stays one whole, so the share drawn is the share played on.
function placeMasses(field: Field, grid: Grid) {
  grid.countOpen();
  for (let attempt = 0; attempt < 240 && grid.openShare() > field.walkShare; attempt += 1) {
    const kind = massKind(field);
    const disks: { at: Point; radius: number }[] = [];
    let at = { x: field.between(0, field.size), y: field.between(0, field.size) };
    let radius = field.between(MASS_RADIUS[0], MASS_RADIUS[1]);
    let toward = field.between(0, Math.PI * 2);
    for (let link = Math.floor(field.between(1, 5)); link > 0; link -= 1) {
      disks.push({ at, radius });
      toward += field.between(-1, 1);
      at = step(at, heading(toward), radius * field.between(0.6, 1));
      radius *= field.between(0.6, 0.95);
    }
    const images = disks.map((disk) => field.symmetry.copies(disk.at).map(roundPoint));
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
    const at = field.symmetry.copies({ x: field.between(0, field.size), y: field.between(0, field.size) }).map(roundPoint);
    if (!at.every((point) => grid.copseFits(point, radius))) continue;
    const kind = field.random() < field.theme.rock ? 2 : 1;
    for (const point of at) grid.block(point, radius, 0.3, kind);
    placed += 1;
  }
}

// The terrain being drawn: which cells are open, which of them lie on a plateau or a ramp, what blocks the rest.
class Grid {
  readonly open: Uint8Array;
  // Ground no blocker covers (the ways, clearings and reserved spots), and the ways' own cells, which ford water.
  readonly kept: Uint8Array;
  readonly way: Uint8Array;
  readonly plateau: Uint8Array;
  readonly ramp: Uint8Array;
  // 0 none (open), 1 forest, 2 rock, 3 water.
  readonly blocker: Uint8Array;
  // A sea map's water (see @@@generated-sea), the part of it no way fords, its islands and every water's shallows.
  readonly sea: Uint8Array;
  readonly still: Uint8Array;
  readonly island: Uint8Array;
  readonly shallow: Uint8Array;
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

  keep(at: Point, radius: number, wobble: number, plateau: boolean) {
    this.disk(at, radius, wobble, (index) => {
      this.kept[index] = 1;
      if (plateau) this.plateau[index] = 1;
    });
  }

  keepPath(path: Path) {
    alongEvery(path.points, 24, (at) =>
      this.disk(at, path.half, path.wobble, (index) => {
        this.kept[index] = 1;
        this.way[index] = 1;
      }),
    );
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

  // Deep water over everything along the water's points within its wobbling edge.
  sink(water: Water) {
    alongEvery(water.points, 24, (at) => this.disk(at, water.half, water.wobble, (index) => this.drown(index, !water.ford)));
  }

  // The sea along the map's edge, `depth` deep, its shore wobbling.
  sinkCoast(depth: number) {
    for (let index = 0; index < this.count; index += 1) {
      const at = this.center(index);
      if (edgeGap(at, this.field.size) <= depth * (1 + SEA_WOBBLE * this.wobble(at))) this.drown(index, true);
    }
  }

  // A way across a river or a strait is a ford: shallows, walked and sailed both.
  ford() {
    for (let index = 0; index < this.count; index += 1) {
      if (!this.way[index] || !this.sea[index] || this.still[index]) continue;
      this.open[index] = 1;
      this.blocker[index] = 0;
      this.shallow[index] = 1;
    }
  }

  // An island in the water: open ground that no walk from a start reaches.
  raise(at: Point, radius: number) {
    this.disk(at, radius, 0.08, (index) => {
      this.open[index] = 1;
      this.blocker[index] = 0;
      this.sea[index] = 0;
      this.still[index] = 0;
      this.kept[index] = 1;
      this.island[index] = 1;
    });
  }

  // What blocks the cell where the land is filled (the edge, a skirt, a tree line, a pocket): forest, or rock where the
  // theme's patches run high.
  fillKind(index: number): Blocker {
    return patchNoise(this.field.noiseSeed + 17, this.field.symmetry.canonical(this.center(index)), 520) > this.field.theme.rockFill ? 2 : 1;
  }

  // Whether a blocker may stand on the cell: open land off the kept ground, the plateaus and their ramps.
  blockable(index: number) {
    return this.open[index] === 1 && !this.kept[index] && !this.plateau[index] && !this.ramp[index] && !this.shallow[index];
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

  // Whether every open cell but an island's is reached from the start.
  whole(from: Point) {
    const reached: number[] = [];
    this.flood(this.indexAt(from), (index) => this.open[index] === 1, reached);
    return reached.length === this.openCount - this.islandCount;
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

  // The land round the back of every main, SKIRT beyond its plateau's radius by patches: all but the side toward its ramp.
  skirts() {
    for (const plateau of this.field.plateaus) {
      const toRamp = unit(sub(plateau.ramp, plateau.base));
      this.around(plateau.base, plateau.radius + SKIRT[1], (index, gap) => {
        const at = this.center(index);
        if ((at.x - plateau.base.x) * toRamp.x + (at.y - plateau.base.y) * toRamp.y > gap * 0.15) return;
        if (gap <= plateau.radius + SKIRT[0] + (SKIRT[1] - SKIRT[0]) * patchNoise(this.field.noiseSeed + 59, this.field.symmetry.canonical(at), 300)) this.fill(index);
      });
    }
  }

  // A tree line along its points.
  wall(wall: Path) {
    alongEvery(wall.points, 24, (at) => this.disk(at, wall.half, wall.wobble, (index) => this.fill(index)));
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

  // The open share of the land (the map but its sea).
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
    const layers = [this.open, this.kept, this.way, this.plateau, this.ramp, this.blocker, this.sea, this.still, this.island, this.shallow];
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

  // @@@generated-cliffs - A plateau's rim becomes rock (the cliff it stands on) all round, but on its ramp: open cells of
  // the plateau beside anything that is not open plateau.
  raiseCliffs() {
    const cliffs: number[] = [];
    for (let index = 0; index < this.count; index += 1) {
      if (!this.open[index] || !this.plateau[index] || this.ramp[index]) continue;
      if (this.neighbours(index).some((next) => !this.open[next] || !this.plateau[next])) cliffs.push(index);
    }
    for (const index of cliffs) {
      this.open[index] = 0;
      this.blocker[index] = 2;
    }
  }

  // The map's outermost ring of cells is blocked, so the ground ends in forest or rock and never at the map's edge.
  frame() {
    for (let index = 0; index < this.count; index += 1) {
      const col = index % this.cells;
      const row = (index - col) / this.cells;
      if (col > 1 && row > 1 && col < this.cells - 2 && row < this.cells - 2) continue;
      if (!this.open[index]) continue;
      this.open[index] = 0;
      this.blocker[index] = this.fillKind(index);
    }
  }

  // Open ground that the first start cannot reach is filled (but an island's); false when the start itself is not open.
  keepReachable(from: Point) {
    const start = this.indexAt(from);
    if (start < 0 || !this.open[start]) return false;
    const reached = this.flood(start, (index) => this.open[index] === 1);
    for (let index = 0; index < this.count; index += 1) {
      if (!this.open[index] || reached[index] || this.island[index]) continue;
      this.open[index] = 0;
      this.shallow[index] = 0;
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
      this.flood(index, (cell) => this.open[cell] === 0, patch);
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

  // Water beside open ground becomes shallows, walked and sailed both.
  shoal() {
    const rim: number[] = [];
    for (let index = 0; index < this.count; index += 1) {
      if (this.open[index] || this.blocker[index] !== 3) continue;
      if (this.neighbours(index).some((next) => this.open[next] === 1)) rim.push(index);
    }
    for (const index of rim) {
      this.open[index] = 1;
      this.shallow[index] = 1;
      this.blocker[index] = 0;
    }
  }

  // Whether a walk from the start reaches any island (its shallows touching the land's).
  islandWalked(from: Point) {
    const reached = this.flood(this.indexAt(from), (index) => this.open[index] === 1);
    for (let index = 0; index < this.count; index += 1) if (reached[index] && this.island[index]) return true;
    return false;
  }

  // Four-way flood from a cell over the cells that pass; the cells reached (listed into `into` when given).
  flood(start: number, passes: (index: number) => boolean, into?: number[]) {
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
      cells += this.shallow[index] ? KIND_CHAR.shallow : this.open[index] ? KIND_CHAR.ground : this.blocker[index] === 2 ? KIND_CHAR.rock : this.blocker[index] === 3 ? KIND_CHAR.water : KIND_CHAR.forest;
      levels += this.open[index] && this.ramp[index] ? "2" : this.plateau[index] ? "1" : "0";
    }
    return { cell: TERRAIN_CELL, cols: this.cells, rows: this.cells, cells, levels };
  }
}

function assemble(kind: GeneratedLayoutKind, field: Field, players: PlayerId[], terrain: Terrain): GeneratedMap {
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
  field.mines
    .map((mine) => clampPoint(mine, field.size))
    .forEach((mine, index) => resources.push({ id: `gold-gen-${index + 1}`, kind: "goldMine", x: mine.x, y: mine.y, amount: MINE_GOLD }));
  const items: WorldItem[] = [];
  field.camps.forEach((camp, index) => {
    const at = clampPoint(camp.at, field.size);
    const kinds = campKinds(field, camp.tier);
    const creeps = kinds.map((unitKind, member) => {
      const spread = (member / kinds.length) * Math.PI * 2 + 0.3;
      return createUnit(`wildling-gen-${index + 1}-${member + 1}`, "neutral", unitKind, Math.round(at.x + detCos(spread) * CAMP_SPREAD), Math.round(at.y + detSin(spread) * CAMP_SPREAD));
    });
    units.push(...creeps);
    if (camp.item) items.push({ id: `treasure-gen-${index + 1}`, kind: camp.item, x: 0, y: 0, carrierId: creeps[0]!.id, cooldownRemaining: 0 });
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
  return { kind, size: field.size, starts, buildings, units, resources, mercenaryCamps, items, landmarks, terrain };
}

// A plateau's shape: a core round the start and three lobes (one toward the ramp, two drawn), every part within `plateau`
// of the start, so no two plateaus look alike and the ramp stands on the rim.
function plateauLobes(field: Field, base: Point, rampDirection: Point, plateau: number): { at: Point; radius: number }[] {
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

// A path's points round a sea from `from` to `to`: along the arc between them about the center, its distance from the
// center going evenly from the one end's to the other's, every 180 or so along it (by the half turn's middle, for ends on opposite
// sides).
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
