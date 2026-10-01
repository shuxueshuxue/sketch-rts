import { BUILDING_DEFS, UNIT_DEFS } from "./catalog";
import { detCos, detSin } from "./det-math";
import { createBuilding, createUnit, STANDARD_MAP_SIZE } from "./map";
import { cellIndexAt, isShoreFootprint, walkableGoal, type Terrain } from "./terrain";
import { seconds } from "./time";
import type { Building, GeneratedLayoutKind, GeneratedLayoutOptions, ItemKind, MapSite, MercenaryCamp, MercenaryUnitKind, PlayerId, ResourceNode, TerrainLandmark, Unit, UnitKind, WorldItem } from "./types";

// @@@generated-map - A seeded ladder map for a game of any size, drawn fresh for every seed, built the way a Warcraft III
// ladder map is: the ground a unit can walk is carved out of forest, rock and water (see @@@terrain), and everything else
// is shaped around it.
// - Every player's main sits on a plateau with a single ramp down, its main mine inside; its natural lies at the foot of
//   the ramp behind a medium guard; paths wind from the natural to the mines contested with each neighbour (strong guards,
//   a minor item) and on to the middle (a hard camp with the best item, over a mine on some maps); easy camps stand in
//   clearings beside the paths near home, a mercenary post in a clearing out on the contested ground.
// - Open ground is broken up by copses, outcrops and ponds wherever it is wide enough to keep a way round them.
// - What is not walked is filled with forest, rock or deep water, by patches, so no two maps look alike and no map is a
//   square of open ground.
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
type Blocker = "forest" | "rock" | "water";

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
// A copse, outcrop or pond stands only where the ground around it stays this many cells wide.
const OBSTACLE_PASSAGE = 3;
// @@@generated-sea - A sea map (the layout option sea, on a ring) has a sea in its middle, drawn first: deep water within
// SEA_SHARE of the map's size of the center (less between two players, whose ring of land round it is shorter and must
// still hold every path), its edge wobbling by SEA_WOBBLE of that, which every mine, camp, post and
// path keeps off (see Field.dry). An island in its middle holds the mine, the hard camp and the best item a land map keeps
// there, so only a ship reaches them. Every start has a beach on the sea toward it, with a path down from its natural, and
// the rim of the sea and of the island is a strip of shallows, where soldiers wade out to strike a ship (see
// @@@terrain-movers). A draw is kept only if every beach takes a shipyard on the one sea.
const SEA_SHARE = { duel: [0.12, 0.14], more: [0.15, 0.18] } as const;
const SEA_WOBBLE = 0.12;
const ISLAND_RADIUS = 300;
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
// What fills the ground no one walks: mostly forest; rock and water by patches, in shares that make each map's look.
const THEMES: { rock: number; water: number }[] = [
  { rock: 0.68, water: 0.76 },
  { rock: 0.62, water: 0.72 },
  { rock: 0.54, water: 0.8 },
  { rock: 0.72, water: 0.64 },
];
const KIND_CHAR: Record<Blocker | "ground" | "shallow", string> = { ground: ".", shallow: ",", forest: "T", rock: "#", water: "~" };

export function generateMap(options: GeneratedLayoutOptions, players: PlayerId[], teams: Record<PlayerId, string>): GeneratedMap {
  const random = seededRandom(options.seed);
  const teamOrder = [...new Set(players.map((player) => teams[player] ?? player))];
  const teamSizes = teamOrder.map((team) => players.filter((player) => (teams[player] ?? player) === team).length);
  const evenTeams = teamOrder.length === 2 && teamSizes[0] === teamSizes[1] && teamSizes[0]! >= 2;
  if (options.sea && options.kind === "sides") throw new Error("A sea is drawn in the middle of a ring layout, not on sides");
  const kind = options.sea ? "ring" : (options.kind ?? (evenTeams && random() < 1 / 3 ? "sides" : "ring"));
  if (kind === "sides" && !evenTeams) throw new Error(`A sides layout needs two teams of the same size (two or more), not ${teamSizes.join(" and ")}`);
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    // The last draws leave the open ground whole: no copse, outcrop or pond can cost a map its connection.
    const plain = attempt >= ATTEMPTS - 5;
    const field = new Field(random, options.size ?? pick(random, sizesFor(kind, players.length, options.sea === true)), kind, players.length, options.sea === true);
    const drawn = kind === "sides" ? sidesLayout(field, players, teams, teamOrder) : ringLayout(field, players, teams, teamOrder);
    if (!drawn) continue;
    const terrain = carveTerrain(field, plain);
    if (!terrain) continue;
    return assemble(kind, field, players, terrain);
  }
  throw new Error(`No ladder map fits the seed ${options.seed} for ${players.length} players`);
}

// A sea map is a size up from a land map for as many players: the sea takes its middle.
function sizesFor(kind: GeneratedLayoutKind, count: number, sea = false): number[] {
  if (sea) return sizesFor(kind, count).map((size) => size + 512);
  if (kind === "sides") return count <= 4 ? [STANDARD_MAP_SIZE + 512, STANDARD_MAP_SIZE + 1_024] : [STANDARD_MAP_SIZE + 1_536, STANDARD_MAP_SIZE + 2_048];
  if (count <= 2) return [STANDARD_MAP_SIZE, STANDARD_MAP_SIZE + 512];
  if (count <= 4) return [STANDARD_MAP_SIZE + 512, STANDARD_MAP_SIZE + 1_024];
  // More players stand on a longer ring: the map grows with the square root of their number.
  const grown = Math.ceil((STANDARD_MAP_SIZE + 768) * Math.sqrt(count / 4) / 512) * 512;
  return [grown, grown + 512];
}

// A disk of ground carved out (a clearing, a plateau), its edge wobbling by `wobble` of its radius.
type Clearing = { at: Point; radius: number; wobble: number; plateau?: boolean };
// A path carved along its points, `half` wide either side.
type Path = { points: Point[]; half: number; wobble: number };
type Obstacle = { at: Point; radius: number; kind: Blocker };

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
  // Every main's plateau and the foot of its way down, by start.
  readonly plateaus: { base: Point; radius: number; ramp: Point; rampRadius: number }[] = [];
  // Ground that stays open whatever is drawn on it (a start, a mine and its hall, a camp, a post).
  readonly reserved: { at: Point; radius: number }[] = [];
  // The draws a map makes once for every copy of a feature.
  readonly easyKinds: UnitKind[];
  readonly mediumKinds: UnitKind[];
  readonly strongKinds: UnitKind[];
  readonly hardKinds: UnitKind[];
  readonly minorItem: ItemKind;
  readonly majorItem: ItemKind;
  readonly mercKind: MercenaryUnitKind;
  readonly theme: { rock: number; water: number };
  readonly noiseSeed: number;
  readonly center: number;
  // A sea map's sea (see @@@generated-sea): its radius round the center, the islands in it, and every player's shore.
  seaRadius = 0;
  readonly islands: { at: Point; radius: number }[] = [];
  readonly shores: Point[] = [];
  // All the copies of a point under the map's symmetry, and the one copy a point stands for (see Symmetry).
  symmetry: Symmetry = { copies: (point) => [point], canonical: (point) => point };

  constructor(
    readonly random: () => number,
    readonly size: number,
    readonly kind: GeneratedLayoutKind,
    readonly count: number,
    readonly sea: boolean,
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

  // Whether ground `reach` round the point stays off the sea, or on an island in it (always, on a map without a sea).
  dry(point: Point, reach: number) {
    if (this.seaRadius === 0) return true;
    if (distance(point, { x: this.center, y: this.center }) >= this.seaRadius * (1 + SEA_WOBBLE) + reach) return true;
    return this.islands.some((island) => distance(point, island.at) + reach <= island.radius);
  }

  // Whether ground `reach` around the point stays clear of every plateau.
  offPlateaus(point: Point, reach: number) {
    return this.plateaus.every((plateau) => distance(point, plateau.base) >= plateau.radius + reach + PLATEAU_MARGIN);
  }

  // Whether a path keeps off every plateau, and off the sea unless it is the way down to a beach.
  pathFits(path: Path, toShore: boolean) {
    return (
      path.points.every((point) => this.plateaus.every((plateau) => distance(point, plateau.base) >= plateau.radius + path.half * 1.2 + PLATEAU_MARGIN) && (toShore || this.dry(point, path.half * 1.2))) &&
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

  // A path from `from` to `to`, bowed sideways by `bend` of its length (or the other way, or straight, where that bow
  // crowds a plateau), with all its copies; on a sea map, where no bow keeps off the sea, round it (see roundSea). Returns
  // the first copy's points, or nothing where no way fits.
  addPath(from: Point, to: Point, half: number, bend: number, toShore = false): Point[] | undefined {
    const ways = [bend, -bend, bend / 2, 0].map((bow) => curve(from, to, bow));
    if (this.seaRadius > 0) ways.push(roundSea({ x: this.center, y: this.center }, from, to));
    for (const points of ways) {
      const copies = this.pathCopies(points, half);
      if (!copies.every((path) => this.pathFits(path, toShore))) continue;
      this.paths.push(...copies);
      return points;
    }
    return undefined;
  }

  pathCopies(points: Point[], half: number): Path[] {
    const images = points.map((point) => this.symmetry.copies(point));
    return images[0]!.map((_, copy) => ({ points: images.map((image) => image[copy]!), half, wobble: 0.16 }));
  }

  addClearings(copies: Point[], radius: number, wobble: number) {
    for (const at of copies) this.clearings.push({ at, radius, wobble });
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
  const exact = quarter || half;
  return {
    copies: (point) => Array.from({ length: count }, (_, slot) => turnAround(point, slot * turn)),
    // Where the grid is made exactly symmetric (see orbit) any copy stands for itself.
    canonical: (point) => {
      if (exact) return point;
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

function mirrorSymmetry(size: number, quarter: boolean): Symmetry {
  const mirror = (point: Point): Point => (quarter ? { x: point.x, y: size - point.y } : { x: size - point.x, y: point.y });
  return {
    copies: (point) => [point, mirror(point)],
    // The grid is made exactly symmetric (see orbit): any copy stands for itself.
    canonical: (point) => point,
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

  // The main: a plateau round the start with the main mine inside, a tenth of the map or more from every border.
  const plateau = field.between(500, 570);
  const reachCap = (CENTER - plateau - 110) / Math.max(Math.abs(detCos(firstAngle)), Math.abs(detSin(firstAngle)));
  // On a sea map the starts stand a little farther out, round the sea (see @@@generated-sea).
  const radius = Math.min(SIZE * field.between(field.sea ? 0.35 : 0.31, field.sea ? 0.4 : 0.37), reachCap);
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
  // A sea map's sea is drawn first (see @@@generated-sea), and every main stands well clear of it.
  if (field.sea) {
    const [low, high] = count <= 2 ? SEA_SHARE.duel : SEA_SHARE.more;
    field.seaRadius = SIZE * field.between(low, high);
    if (radius - plateau < field.seaRadius * (1 + SEA_WOBBLE) + 150) return false;
  }

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
  field.addClearings(copies(naturalArea), field.between(320, 400), 0.1);
  field.addGuardedMines(natural, "medium", (at, slot) => mirrorAway(at, field.bases[slot]!));
  // The way down: from inside the plateau, over the rim at the ramp, to the natural's clearing.
  field.paths.push(...field.pathCopies([step(base, rampDirection, plateau * 0.55), ramp, naturalArea], rampHalf));

  // The mine contested with the next start, behind a strong guard with a minor item.
  const contested = field.place(
    () => copies(polar(radius * field.between(0.5, 0.95), firstAngle + turn / 2 + field.between(-0.12, 0.12) * turn)),
    (mines) => field.mineFits(mines, CONTESTED_START_SPACING) && mines.every((at) => field.offPlateaus(at, 330)),
  );
  if (!contested) return false;
  field.addClearings(contested, field.between(280, 340), 0.12);
  field.addGuardedMines(contested, "strong", () => ({ x: CENTER, y: CENTER }), field.minorItem);
  const ahead = contested[0]!;
  const behind = roundPoint(copies(ahead)[count - 1]!);

  // The middle: a hard camp with the best item, over a mine on some maps; on a sea map, an island with all three, which
  // only a ship reaches.
  const middle = { x: CENTER, y: CENTER };
  if (field.sea) {
    field.islands.push({ at: middle, radius: ISLAND_RADIUS });
    field.addGuardedMines([middle], "hard", () => polar(1, firstAngle + turn / 2), field.majorItem);
  } else {
    field.clearings.push({ at: middle, radius: field.between(300, 480), wobble: 0.14 });
    const middleMine = field.random() < 0.5 && field.mineFits([middle], CONTESTED_START_SPACING);
    if (middleMine) field.addGuardedMines([middle], "hard", () => polar(1, firstAngle + turn / 2), field.majorItem);
    else if (field.campFits([middle], [], CONTESTED_START_SPACING)) field.addCamps([middle], "hard", field.majorItem);
  }

  // Paths from the natural to both contested mines, and on to the middle from the natural or the contested mine (or both).
  const width = () => field.between(70, 120);
  const bend = () => field.between(-0.22, 0.22);
  const toAhead = field.addPath(naturalArea, ahead, width(), bend());
  const toBehind = field.addPath(naturalArea, behind, width(), bend());
  if (!toAhead || !toBehind) return false;
  // On a sea map no path leads to the middle: the sea is there, and every natural has its way down to the shore.
  let toMiddle: Point[] | undefined;
  if (!field.sea) {
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
  // A sea map's beaches: one on the sea's edge toward every start, a clearing kept clear of copses and ponds, with a path
  // down to it from the natural.
  if (field.sea) {
    const toward = unit(sub(base, middle));
    const shore = step(middle, toward, field.seaRadius);
    const beach = step(middle, toward, field.seaRadius + BEACH_RADIUS * 0.6);
    field.shores.push(...copies(shore).map(roundPoint));
    field.addClearings(copies(shore).map(roundPoint), BEACH_RADIUS, 0.1);
    for (const at of copies(beach)) field.reserved.push({ at: roundPoint(at), radius: BEACH_RADIUS * 0.6 });
    if (!field.addPath(naturalArea, beach, width(), bend(), true)) return false;
  }
  return true;
}

// @@@generated-sides - Two teams of equal size face each other across the map, each along its edge, the halves mirrored.
// Every player has its plateau, its ramp and its natural; the contested mines stand down the middle line, the hard camp
// with the best item at the middle one. Half the maps turn the whole field a quarter, so the teams face top and bottom.
function sidesLayout(field: Field, players: PlayerId[], teams: Record<PlayerId, string>, teamOrder: string[]): boolean {
  const SIZE = field.size;
  const CENTER = field.center;
  const quarter = field.random() < 0.5;
  field.symmetry = mirrorSymmetry(SIZE, quarter);
  const place = (point: Point): Point => roundPoint(quarter ? { x: point.y, y: point.x } : point);
  const members = teamOrder.map((team) => players.filter((player) => (teams[player] ?? player) === team));
  const perSide = members[0]!.length;
  const plateau = field.between(480, 540);
  const margin = plateau + 130;
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
  // The contested mines down the middle line, one more than a side has players, the middle one behind the hard camp.
  const middleIndex = Math.floor((perSide + 1) / 2);
  const contested: Point[] = [];
  for (let index = 0; index <= perSide; index += 1) {
    const y = SIZE * (0.12 + ((index + 0.5) / (perSide + 1)) * 0.76);
    const mine = place({ x: CENTER, y });
    if (!field.mineFits([mine], CONTESTED_START_SPACING)) continue;
    contested.push(mine);
    field.clearings.push({ at: mine, radius: field.between(320, 400), wobble: 0.12 });
    const along = (at: Point) => place({ x: CENTER, y: (quarter ? at.x : at.y) + 1 });
    field.addGuardedMines([mine], index === middleIndex ? "hard" : "strong", along, index === middleIndex ? field.majorItem : index === 0 ? field.minorItem : undefined);
  }
  if (contested.length === 0) return false;
  const width = () => field.between(70, 120);
  // Every natural reaches the two contested mines nearest it; neighbours on a side reach each other.
  const outward: Point[][] = [];
  for (const { area } of own) {
    const targets = [...contested].sort((a, b) => distance(a, area) - distance(b, area)).slice(0, 2);
    for (const target of targets) {
      const path = field.addPath(area, target, width(), field.between(-0.2, 0.2));
      if (!path) return false;
      outward.push(path);
    }
  }
  for (let index = 1; index < own.length; index += 1) field.addPath(own[index - 1]!.area, own[index]!.area, width(), field.between(-0.2, 0.2));
  for (let index = 0; index < own.length; index += 1) {
    const path = outward[index * 2]!;
    const easy = field.place(() => field.symmetry.copies(besidePath(path, field.between(0.3, 0.6), (field.random() < 0.5 ? -1 : 1) * field.between(60, 170))), (camps) => field.campFits(camps, [], 600));
    if (!easy) continue;
    field.addClearings(easy, field.between(130, 170), 0.15);
    field.addCamps(easy, "easy");
  }
  const merc = field.place(() => field.symmetry.copies(place({ x: SIZE * field.between(0.3, 0.42), y: SIZE * field.between(0.2, 0.8) })), (posts) => field.mercFits(posts));
  if (merc) {
    field.addClearings(merc, 170, 0.12);
    for (const at of merc) {
      const target = [...contested].sort((a, b) => distance(a, at) - distance(b, at))[0]!;
      field.paths.push({ points: curve(at, target, 0), half: 90, wobble: 0.16 });
    }
    field.mercs.push(...merc.map((at) => ({ at, kind: field.mercKind })));
    for (const at of merc) field.reserved.push({ at, radius: 100 });
  }
  return true;
}

// @@@generated-terrain - The grid is drawn from the layout: every clearing and path is carved out of the blocked ground,
// copses, outcrops and ponds are set where the open ground is wide enough, the grid is made symmetric, each main's rim
// becomes a cliff but for its ramp, stray pockets and specks are filled or cleared, and the map is kept only if every
// start reaches everything.
function carveTerrain(field: Field, plain: boolean): Terrain | undefined {
  const cells = Math.round(field.size / TERRAIN_CELL);
  const grid = new Grid(cells, field);
  for (const clearing of field.clearings) grid.carveDisk(clearing.at, clearing.radius, clearing.wobble, clearing.plateau === true);
  for (const path of field.paths) grid.carvePath(path);
  for (const plateau of field.plateaus) grid.markRamp(plateau.ramp, plateau.rampRadius);
  for (const reserved of field.reserved) grid.carveDisk(reserved.at, reserved.radius, 0, false, true);
  if (field.seaRadius > 0) grid.sink({ x: field.center, y: field.center }, field.seaRadius, SEA_WOBBLE);
  for (const island of field.islands) grid.raise(island.at, island.radius);
  if (!plain) placeObstacles(field, grid);
  grid.fillBlocked();
  grid.symmetrize();
  grid.raiseCliffs();
  grid.frame();
  if (!grid.keepReachable(field.bases[0]!)) return undefined;
  grid.clearSpecks();
  if (field.seaRadius > 0) grid.shoal();
  const required = [...field.bases, ...field.mains, ...field.mines, ...field.camps.map((camp) => camp.at), ...field.mercs.map((merc) => merc.at)];
  if (!required.every((point) => grid.walkableAt(point))) return undefined;
  if (!field.bases.every((base) => grid.roomAround(base, 450) >= 0.55)) return undefined;
  if (!field.mines.every((mine) => grid.hallFits(mine))) return undefined;
  const terrain = grid.terrain();
  if (field.seaRadius > 0) {
    const center = { x: field.center, y: field.center };
    const sea = seaCells(terrain, step(center, unit(sub(field.bases[0]!, center)), (ISLAND_RADIUS + field.seaRadius) / 2));
    if (!field.shores.every((shore) => shipyardFits(field, terrain, sea, shore))) return undefined;
  }
  return terrain;
}

// Whether a shipyard can stand on the beach at this shore (see @@@shore-footprint), on the water of the sea itself: a spot
// out from the shore, or along it either way, within a beach's width.
function shipyardFits(field: Field, terrain: Terrain, sea: Uint8Array, shore: Point) {
  const center = { x: field.center, y: field.center };
  const map = { terrain, width: field.size, height: field.size };
  const out = unit(sub(shore, center));
  const along = { x: -out.y, y: out.x };
  for (let reach = 0; reach <= BEACH_RADIUS; reach += TERRAIN_CELL / 2) {
    for (const side of [0, 1, -1, 2, -2, 3, -3]) {
      const at = step(step(shore, out, reach), along, side * TERRAIN_CELL);
      if (!isShoreFootprint(map, at.x, at.y, BUILDING_DEFS.shipyard.radius)) continue;
      const water = walkableGoal(map, at.x, at.y, "sea");
      if (sea[cellIndexAt(terrain, water.x, water.y)] === 1) return true;
    }
  }
  return false;
}

// The water a ship sails from the cell under the point (four ways, deep or shallow): 1 for each cell.
function seaCells(terrain: Terrain, at: Point) {
  const reached = new Uint8Array(terrain.cols * terrain.rows);
  const wet = (index: number) => terrain.cells[index] === "~" || terrain.cells[index] === ",";
  const start = cellIndexAt(terrain, at.x, at.y);
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

function placeObstacles(field: Field, grid: Grid) {
  const wanted = Math.round(field.between(4, 10));
  const kinds: Blocker[] = ["forest", "forest", "forest", "rock", "rock", "water"];
  let placed = 0;
  for (let attempt = 0; attempt < 60 && placed < wanted; attempt += 1) {
    const radius = field.between(50, 130);
    const at = { x: field.between(0, field.size), y: field.between(0, field.size) };
    const copies = field.symmetry.copies(at).map(roundPoint);
    const kind = pick(field.random, kinds);
    if (!copies.every((point) => grid.obstacleFits(point, radius, field.reserved))) continue;
    for (const point of copies) grid.block({ at: point, radius, kind });
    placed += 1;
  }
}

// The terrain being drawn: which cells are open, which of them lie on a plateau or a ramp, what blocks the rest.
class Grid {
  readonly open: Uint8Array;
  readonly plateau: Uint8Array;
  readonly ramp: Uint8Array;
  readonly kept: Uint8Array;
  readonly blocker: Uint8Array;
  // A sea map's island and shallows (see @@@generated-sea).
  readonly island: Uint8Array;
  readonly shallow: Uint8Array;
  readonly count: number;

  constructor(
    readonly cells: number,
    readonly field: Field,
  ) {
    this.count = cells * cells;
    this.open = new Uint8Array(this.count);
    this.plateau = new Uint8Array(this.count);
    this.ramp = new Uint8Array(this.count);
    this.kept = new Uint8Array(this.count);
    // 0 none (open or not yet filled), 1 forest, 2 rock, 3 water.
    this.blocker = new Uint8Array(this.count);
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

  carveDisk(at: Point, radius: number, wobble: number, plateau: boolean, keep = false) {
    this.around(at, radius * (1 + wobble), (index, gap) => {
      if (gap > radius * (1 + wobble * this.wobble(this.center(index)))) return;
      this.open[index] = 1;
      if (plateau) this.plateau[index] = 1;
      if (keep) this.kept[index] = 1;
    });
  }

  carvePath(path: Path) {
    for (let index = 1; index < path.points.length; index += 1) {
      const from = path.points[index - 1]!;
      const to = path.points[index]!;
      const pieces = Math.max(1, Math.ceil(distance(from, to) / 24));
      for (let piece = 0; piece <= pieces; piece += 1) this.carveDisk(lerp(from, to, piece / pieces), path.half, path.wobble, false);
    }
  }

  // The sea (see @@@generated-sea): deep water over everything within its wobbling edge.
  sink(at: Point, radius: number, wobble: number) {
    this.around(at, radius * (1 + wobble), (index, gap) => {
      if (gap > radius * (1 + wobble * this.wobble(this.center(index)))) return;
      this.open[index] = 0;
      this.blocker[index] = 3;
    });
  }

  // An island in the sea: open ground that no walk from a start need reach.
  raise(at: Point, radius: number) {
    this.carveDisk(at, radius, 0.08, false, true);
    this.around(at, radius * 1.08, (index) => {
      if (this.open[index]) this.island[index] = 1;
    });
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

  markRamp(at: Point, radius: number) {
    this.around(at, radius, (index) => {
      this.ramp[index] = 1;
    });
  }

  // Whether a copse, outcrop or pond of this radius may stand here: off every reserved spot, and with the ground round it
  // at least OBSTACLE_PASSAGE cells wide on every side.
  obstacleFits(at: Point, radius: number, reserved: { at: Point; radius: number }[]) {
    if (!this.walkableAt(at)) return false;
    if (reserved.some((spot) => distance(spot.at, at) < spot.radius + radius + 60)) return false;
    if (this.field.plateaus.some((plateau) => distance(plateau.base, at) < plateau.radius + radius + 40)) return false;
    let clear = true;
    this.around(at, radius + OBSTACLE_PASSAGE * TERRAIN_CELL * 1.5, (index) => {
      if (!this.open[index] || this.ramp[index]) clear = false;
    });
    return clear;
  }

  block(obstacle: Obstacle) {
    const code = obstacle.kind === "forest" ? 1 : obstacle.kind === "rock" ? 2 : 3;
    this.around(obstacle.at, obstacle.radius * 1.3, (index, gap) => {
      if (this.kept[index] || gap > obstacle.radius * (1 + 0.3 * this.wobble(this.center(index)))) return;
      this.open[index] = 0;
      this.blocker[index] = code;
    });
  }

  // What blocks the ground no one walks, by patches: rock where one noise runs high, water where another does, forest
  // elsewhere.
  fillBlocked() {
    const { theme, noiseSeed, symmetry } = this.field;
    for (let index = 0; index < this.count; index += 1) {
      if (this.open[index] || this.blocker[index]) continue;
      const at = symmetry.canonical(this.center(index));
      const rock = patchNoise(noiseSeed + 17, at, 520);
      const water = patchNoise(noiseSeed + 31, at, 700);
      this.blocker[index] = water > theme.water ? 3 : rock > theme.rock ? 2 : 1;
    }
  }

  // Every cell takes the value of the first cell of its orbit, so the grid is the same from every start.
  symmetrize() {
    const orbit = this.field.symmetry.orbit;
    if (!orbit) return;
    const done = new Uint8Array(this.count);
    for (let row = 0; row < this.cells; row += 1) {
      for (let col = 0; col < this.cells; col += 1) {
        const index = row * this.cells + col;
        if (done[index]) continue;
        for (const [c, r] of orbit(col, row, this.cells)) {
          const image = r * this.cells + c;
          done[image] = 1;
          if (image === index) continue;
          this.open[image] = this.open[index]!;
          this.plateau[image] = this.plateau[index]!;
          this.ramp[image] = this.ramp[index]!;
          this.kept[image] = this.kept[index]!;
          this.blocker[image] = this.blocker[index]!;
          this.island[image] = this.island[index]!;
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
      this.blocker[index] = this.blocker[index] || 1;
    }
  }

  // Open ground that the first start cannot reach is filled; false when the start itself is not open.
  keepReachable(from: Point) {
    const start = this.indexAt(from);
    if (start < 0 || !this.open[start]) return false;
    const reached = this.flood(start, (index) => this.open[index] === 1);
    for (let index = 0; index < this.count; index += 1) {
      if (!this.open[index] || reached[index] || this.island[index]) continue;
      this.open[index] = 0;
      this.blocker[index] = this.plateau[index] ? 2 : 1;
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

  // Whether a hall fits somewhere beside the mine (within 170 of it, its whole footprint open).
  hallFits(mine: Point) {
    for (const reach of [110, 140, 170]) {
      for (let spoke = 0; spoke < 16; spoke += 1) {
        const at = step(mine, heading((spoke / 16) * Math.PI * 2), reach);
        let clear = true;
        this.around(at, 56, (index) => {
          if (!this.open[index]) clear = false;
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
