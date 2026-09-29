import { UNIT_DEFS } from "./catalog";
import { detCos, detSin } from "./det-math";
import { createBuilding, createUnit, STANDARD_MAP_SIZE } from "./map";
import { seconds } from "./time";
import type { Building, GeneratedLayoutKind, GeneratedLayoutOptions, ItemKind, MercenaryCamp, MercenaryUnitKind, PlayerId, ResourceNode, TerrainLandmark, Unit, UnitKind, WorldItem } from "./types";

// @@@generated-map - A seeded layout for a game of any size, drawn fresh for every seed instead of one authored map
// stretched per map id. The authored rich maps put every player on one of two edges and hold five expansion mines, so four
// players on them shared three contested mines and one side's natural. A generated layout is built the way a ladder map
// is: every player has a main mine and a natural of its own behind a medium guard, easy camps near home to creep first,
// contested mines between players behind stronger guards that carry an item, a hard camp with the best item in the
// middle, mercenary posts, and the same of all of it for every player:
// - ring: the players stand on a ring around the center, an equal turn apart (on the edges, in the corners or anywhere
//   between), and the map is the same seen from every start (turned by that turn);
// - sides: two teams face each other across the map (left and right, or top and bottom); every player has its natural and
//   its easy camps, and whatever is shared is mirrored between the two halves.
// Every feature is drawn with all its symmetric copies at once and kept only if every copy keeps its distances (mines
// apart, camps apart and off the mines they do not guard, contested ground away from the starts), so no two camps grow
// into one and no camp stands where the economy would wait on it. Nothing in a layout names a player's version or role:
// the AIs read it as they read any map.

export type GeneratedMap = {
  kind: GeneratedLayoutKind;
  starts: Record<PlayerId, { baseX: number; baseY: number; mineX: number; mineY: number }>;
  buildings: Building[];
  units: Unit[];
  resources: ResourceNode[];
  mercenaryCamps: MercenaryCamp[];
  items: WorldItem[];
  landmarks: TerrainLandmark[];
};

type Point = { x: number; y: number };
// Ladder-map camp tiers: easy near home, medium at a natural, strong at contested mines and on routes, hard in the middle.
type CampTier = "easy" | "medium" | "strong" | "hard";
type Camp = { at: Point; tier: CampTier; item?: ItemKind };

const SIZE = STANDARD_MAP_SIZE;
const CENTER = SIZE / 2;
const EDGE = 90;
const INNER = 260;
const MINE_GOLD = 6_000;
// No creep stands this near a start or its main mine (see @@@start-safety).
const START_SAFETY = 440;
// A camp's creeps stand this far around its center.
const CAMP_SPREAD = 55;
// Mines stand this far apart (a natural this far from its own start's main mine); camps this far apart (the AI reads
// creeps within 320 of one another as one camp).
const MINE_SPACING = 700;
const NATURAL_MAIN_SPACING = 450;
const CAMP_SPACING = 480;
// A camp this near a mine is its guard (the AI waits for creeps within 350 of a mine before expanding there): guards stand
// GUARD_OFFSET from their mine and every other camp at least CAMP_MINE_SPACING from every mine.
const GUARD_OFFSET = 200;
const CAMP_MINE_SPACING = 520;
// Contested ground (mines between players, route camps, mercenary posts) keeps this far from every start.
const CONTESTED_START_SPACING = 900;
const MERC_SPACING = 380;
const TRIES = 120;

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

export function generateMap(options: GeneratedLayoutOptions, players: PlayerId[], teams: Record<PlayerId, string>): GeneratedMap {
  const random = seededRandom(options.seed);
  const teamOrder = [...new Set(players.map((player) => teams[player] ?? player))];
  const kind = options.kind ?? (teamOrder.length === 2 && random() < 1 / 3 ? "sides" : "ring");
  if (kind === "sides" && teamOrder.length !== 2) throw new Error(`A sides layout needs two teams, not ${teamOrder.length}`);
  const field = new Field(random);
  if (kind === "sides") sidesLayout(field, players, teams, teamOrder);
  else ringLayout(field, players, teams, teamOrder);
  return assemble(kind, field, players);
}

// Everything placed so far, and whether a feature with all its copies keeps its distances from it.
class Field {
  readonly starts = new Map<PlayerId, { base: Point; mine: Point }>();
  readonly bases: Point[] = [];
  readonly mains: Point[] = [];
  readonly mines: Point[] = [];
  readonly camps: Camp[] = [];
  readonly mercs: { at: Point; kind: MercenaryUnitKind }[] = [];
  readonly scenery: TerrainLandmark[] = [];
  // The draws a map makes once for every copy of a feature.
  readonly easyKinds: UnitKind[];
  readonly mediumKinds: UnitKind[];
  readonly strongKinds: UnitKind[];
  readonly hardKinds: UnitKind[];
  readonly minorItem: ItemKind;
  readonly majorItem: ItemKind;
  readonly mercKind: MercenaryUnitKind;

  constructor(readonly random: () => number) {
    this.easyKinds = pick(random, CAMP_KINDS.easy);
    this.mediumKinds = pick(random, CAMP_KINDS.medium);
    this.strongKinds = pick(random, CAMP_KINDS.strong);
    this.hardKinds = pick(random, CAMP_KINDS.hard);
    this.minorItem = pick(random, MINOR_ITEMS);
    this.majorItem = pick(random, MAJOR_ITEMS);
    this.mercKind = pick(random, MERC_KINDS);
  }

  between(low: number, high: number) {
    return low + this.random() * (high - low);
  }

  inside(points: Point[], margin = INNER) {
    return points.every((point) => point.x >= margin && point.y >= margin && point.x <= SIZE - margin && point.y <= SIZE - margin);
  }

  // A mine's copies: apart from every mine and from one another, at least `fromMains` from every main mine and
  // `fromStarts` from every start.
  mineFits(copies: Point[], fromStarts: number, fromMains = MINE_SPACING) {
    return this.inside(copies) && apart(copies, MINE_SPACING) && copies.every((mine) => nearest(mine, this.mines) >= MINE_SPACING && nearest(mine, this.mains) >= fromMains && nearest(mine, this.bases) >= fromStarts);
  }

  // A camp's copies: apart from every camp and from one another, off every mine but the one it guards, clear of the starts.
  campFits(copies: Point[], guarded: Point[], fromStarts: number) {
    return (
      this.inside(copies, EDGE + CAMP_SPREAD) &&
      apart(copies, CAMP_SPACING) &&
      copies.every((camp) => nearest(camp, this.camps.map((other) => other.at)) >= CAMP_SPACING && nearest(camp, this.bases) >= fromStarts && nearest(camp, this.mercs.map((merc) => merc.at)) >= MERC_SPACING) &&
      copies.every((camp) => [...this.mains, ...this.mines].every((mine) => guarded.some((own) => own === mine) || distance(camp, mine) >= CAMP_MINE_SPACING))
    );
  }

  mercFits(copies: Point[]) {
    return (
      this.inside(copies) &&
      apart(copies, MERC_SPACING) &&
      copies.every((merc) => nearest(merc, [...this.mains, ...this.mines]) >= MERC_SPACING && nearest(merc, this.camps.map((camp) => camp.at)) >= MERC_SPACING && nearest(merc, this.bases) >= CONTESTED_START_SPACING)
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

  // The mines and their guards: each guard GUARD_OFFSET from its mine toward `awayFrom`, or turned from that by up to 90
  // degrees either way where that crowds another camp (every copy turned alike); a guard that fits nowhere is left out.
  addGuardedMines(mines: Point[], tier: CampTier, awayFrom: (mine: Point, index: number) => Point, item?: ItemKind) {
    this.mines.push(...mines);
    for (const turn of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) {
      const guards = mines.map((mine, index) => roundPoint(step(mine, rotate(unit(sub(awayFrom(mine, index), mine)), turn), GUARD_OFFSET)));
      if (!this.campFits(guards, mines, START_SAFETY + CAMP_SPREAD + 10)) continue;
      this.camps.push(...guards.map((at) => ({ at, tier, ...(item ? { item } : {}) })));
      return;
    }
  }
}

// @@@generated-ring - One slot is drawn and turned around the center for every player; teammates take neighbouring slots.
function ringLayout(field: Field, players: PlayerId[], teams: Record<PlayerId, string>, teamOrder: string[]) {
  const count = Math.max(2, players.length);
  const turn = (Math.PI * 2) / count;
  const offsetRoll = field.random();
  const firstAngle = offsetRoll < 0.35 ? 0 : offsetRoll < 0.7 ? turn / 2 : field.random() * turn;
  // The start stays a tenth of the map from every border whatever its angle.
  const radius = Math.min(SIZE * field.between(0.32, 0.4), (0.4 * SIZE) / Math.max(Math.abs(detCos(firstAngle)), Math.abs(detSin(firstAngle))));
  const copies = (point: Point) => Array.from({ length: count }, (_, slot) => turnAround(point, slot * turn));
  const inward = heading(firstAngle + Math.PI);
  const ordered = [...players].sort((a, b) => teamOrder.indexOf(teams[a] ?? a) - teamOrder.indexOf(teams[b] ?? b));

  const base = polar(radius, firstAngle);
  const mine = step(base, rotate(inward, (field.random() < 0.5 ? -1 : 1) * field.between(1.05, 1.65)), 230);
  copies(base).forEach((at, slot) => {
    field.bases.push(roundPoint(at));
    if (ordered[slot]) field.starts.set(ordered[slot]!, { base: roundPoint(at), mine: roundPoint(turnAround(mine, slot * turn)) });
  });
  field.mains.push(...copies(mine).map(roundPoint));

  // Every start's natural (near it, well away from every other start) and the contested mine between it and the next
  // start are drawn together, so neither takes the other's room; the natural stands behind a medium guard, the contested
  // mine behind a strong one with a minor item.
  const pair = field.place(
    () => [...copies(step(base, rotate(inward, field.between(-1, 1)), field.between(600, 950))), ...copies(polar(radius * field.between(0.3, 1), firstAngle + turn / 2 + field.between(-0.2, 0.2) * turn))],
    (mines) => {
      const naturals = mines.slice(0, count);
      const contested = mines.slice(count);
      return (
        field.mineFits(naturals, 600, NATURAL_MAIN_SPACING) &&
        naturals.every((at, slot) => field.bases.every((other, index) => index === slot || distance(at, other) >= 1_100)) &&
        field.mineFits(contested, CONTESTED_START_SPACING) &&
        contested.every((at) => nearest(at, naturals) >= MINE_SPACING)
      );
    },
  );
  const naturalFits = (naturals: Point[]) =>
    field.mineFits(naturals, 600, NATURAL_MAIN_SPACING) && naturals.every((at, slot) => field.bases.every((other, index) => index === slot || distance(at, other) >= 1_100));
  // Where no pair fits (a ring turned so its starts crowd one another), the natural is placed first and the contested
  // mine wherever it still fits.
  const naturals = pair ? pair.slice(0, count) : field.place(() => copies(step(base, rotate(inward, field.between(-1, 1)), field.between(600, 950))), naturalFits);
  if (naturals) field.addGuardedMines(naturals, "medium", (mine, slot) => mirrorAway(mine, field.bases[slot]!));
  const contested = pair ? pair.slice(count) : field.place(() => copies(polar(radius * field.between(0.25, 1.1), firstAngle + turn / 2 + field.between(-0.3, 0.3) * turn)), (mines) => field.mineFits(mines, CONTESTED_START_SPACING));
  if (contested) field.addGuardedMines(contested, "strong", () => ({ x: CENTER, y: CENTER }), field.minorItem);

  // The middle: a hard camp with the best item, over a mine on some maps.
  const middleMine = field.random() < 0.55 && field.mineFits([{ x: CENTER, y: CENTER }], CONTESTED_START_SPACING);
  if (middleMine) field.addGuardedMines([{ x: CENTER, y: CENTER }], "hard", () => polar(1, firstAngle + turn / 2), field.majorItem);
  else if (field.campFits([{ x: CENTER, y: CENTER }], [], CONTESTED_START_SPACING)) field.camps.push({ at: { x: CENTER, y: CENTER }, tier: "hard", item: field.majorItem });

  // The rest is drawn anywhere in the start's wedge of the map (its share of the ring, out to the edge) and kept by its
  // distance from the start.
  const inWedge = (low: number, high: number) => copies(polar(radius * field.between(low, high), firstAngle + field.between(-0.5, 0.5) * turn));
  const fromStart = (point: Point, low: number, high: number) => distance(point, base) >= low && distance(point, base) <= high;
  // A mercenary post for every start, out on the contested ground.
  const merc = field.place(() => inWedge(0.3, 1.2), (posts) => fromStart(posts[0]!, CONTESTED_START_SPACING, 1_800) && field.mercFits(posts));
  if (merc) field.mercs.push(...merc.map((at) => ({ at, kind: field.mercKind })));

  // Two easy camps near every start, to creep first.
  for (let camp = 0; camp < 2; camp += 1) {
    const easy = field.place(() => inWedge(0.4, 1.35), (camps) => fromStart(camps[0]!, 600, 1_250) && field.campFits(camps, [], 600));
    if (easy) field.camps.push(...easy.map((at) => ({ at, tier: "easy" as const })));
  }
  // A strong camp on each route between starts and the middle.
  const route = field.place(() => inWedge(0.2, 1), (camps) => fromStart(camps[0]!, CONTESTED_START_SPACING, 1_800) && field.campFits(camps, [], CONTESTED_START_SPACING));
  if (route) field.camps.push(...route.map((at) => ({ at, tier: "strong" as const })));
  // Scenery (it does not stand in anyone's way): a road from every start toward the middle, groves and ridges around it.
  copies(base).forEach((at, slot) => {
    const angle = firstAngle + slot * turn;
    const grove = turnAround(polar(radius * 0.72, firstAngle - turn * 0.3), slot * turn);
    const ridge = turnAround(polar(radius * 0.55, firstAngle + turn * 0.3), slot * turn);
    field.scenery.push(
      { id: `gen-road-${slot}`, kind: "road", ...roundPoint({ x: (at.x + CENTER) / 2, y: (at.y + CENTER) / 2 }), size: 520, rotation: angle },
      { id: `gen-grove-${slot}`, kind: "grove", ...roundPoint(grove), size: 360, rotation: angle * 0.7 },
      { id: `gen-ridge-${slot}`, kind: "ridge", ...roundPoint(ridge), size: 420, rotation: angle + 0.4 },
    );
  });
}

// @@@generated-sides - The two teams face each other across the map, each on its edge, spread along it. Every player has
// its natural straight in from its start (with its guard) and its easy camps; whatever is shared (the contested mines
// down the middle, the route camps, the mercenary posts, the hard camp) is mirrored onto the other half. Half the maps
// turn the whole field a quarter, so the teams face each other top and bottom.
function sidesLayout(field: Field, players: PlayerId[], teams: Record<PlayerId, string>, teamOrder: string[]) {
  const margin = SIZE * field.between(0.1, 0.13);
  // The natural stays clear of the contested mines down the middle line.
  // Straight in from the start, the natural keeps NATURAL_MAIN_SPACING from its main mine (210 in from the start).
  const naturalGap = Math.min(field.between(700, 900), CENTER - margin - (MINE_SPACING + 60));
  const naturalDrift = field.between(-180, 180);
  const quarter = field.random() < 0.5;
  const place = (point: Point): Point => roundPoint(quarter ? { x: point.y, y: point.x } : point);
  const mirror = (point: Point): Point => ({ x: SIZE - point.x, y: point.y });
  const both = (point: Point) => [place(point), place(mirror(point))];

  const members = teamOrder.map((team) => players.filter((player) => (teams[player] ?? player) === team));
  const own: { player: PlayerId; base: Point; inward: number }[] = [];
  members.forEach((team, side) => {
    const inward = side === 0 ? 1 : -1;
    const x = side === 0 ? margin : SIZE - margin;
    team.forEach((player, index) => {
      const y = SIZE * (0.08 + ((index + 1) / (team.length + 1)) * 0.84);
      const base = { x, y };
      const mine = { x: x + inward * 210, y: y + (index % 2 === 0 ? -90 : 90) };
      field.starts.set(player, { base: place(base), mine: place(mine) });
      field.bases.push(place(base));
      field.mains.push(place(mine));
      own.push({ player, base, inward });
    });
  });
  // Every player's natural, straight in from its start, and its guard beyond it.
  for (const { base, inward } of own) {
    const natural = place({ x: base.x + inward * naturalGap, y: base.y + naturalDrift });
    const start = place(base);
    if (field.mineFits([natural], 600, NATURAL_MAIN_SPACING)) field.addGuardedMines([natural], "medium", (mine) => mirrorAway(mine, start));
  }
  // Two easy camps near every player.
  for (const { base, inward } of own) {
    for (let camp = 0; camp < 2; camp += 1) {
      const easy = field.place(() => [place({ x: base.x + inward * field.between(350, 900), y: base.y + field.between(-800, 800) })], (camps) => field.campFits(camps, [], 600));
      if (easy) field.camps.push({ at: easy[0]!, tier: "easy" });
    }
  }
  // The contested mines down the middle line, one more than the larger team has players, behind strong guards (the
  // middle one behind the hard camp with the best item); every guard stands on the middle line, so the halves mirror.
  const larger = Math.max(...members.map((team) => team.length));
  const middle = Math.floor((larger + 1) / 2);
  for (let index = 0; index <= larger; index += 1) {
    const y = SIZE * (0.12 + ((index + 0.5) / (larger + 1)) * 0.76);
    const mine = place({ x: CENTER, y });
    const along = (at: Point) => place({ x: CENTER, y: (quarter ? at.x : at.y) + 1 });
    if (field.mineFits([mine], CONTESTED_START_SPACING)) field.addGuardedMines([mine], index === middle ? "hard" : "strong", along, index === middle ? field.majorItem : index === 0 ? field.minorItem : undefined);
  }
  // Route camps and mercenary posts, mirrored between the halves.
  for (let camp = 0; camp < 2; camp += 1) {
    const route = field.place(() => both({ x: SIZE * field.between(0.28, 0.44), y: SIZE * field.between(0.12, 0.88) }), (camps) => field.campFits(camps, [], CONTESTED_START_SPACING));
    if (route) field.camps.push(...route.map((at) => ({ at, tier: "strong" as const })));
  }
  const merc = field.place(() => both({ x: SIZE * field.between(0.3, 0.44), y: SIZE * field.between(0.15, 0.85) }), (posts) => field.mercFits(posts));
  if (merc) field.mercs.push(...merc.map((at) => ({ at, kind: field.mercKind })));
  field.scenery.push(
    { id: "gen-road-middle", kind: "road", x: CENTER, y: CENTER, size: 700, rotation: quarter ? 0 : Math.PI / 2 },
    { id: "gen-ridge-a", kind: "ridge", ...place({ x: SIZE * 0.3, y: SIZE * 0.5 }), size: 420, rotation: 0.3 },
    { id: "gen-ridge-b", kind: "ridge", ...place({ x: SIZE * 0.7, y: SIZE * 0.5 }), size: 420, rotation: -0.3 },
  );
}

function assemble(kind: GeneratedLayoutKind, field: Field, players: PlayerId[]): GeneratedMap {
  const starts: GeneratedMap["starts"] = {};
  const buildings: Building[] = [];
  const units: Unit[] = [];
  const resources: ResourceNode[] = [];
  for (const player of players) {
    const start = field.starts.get(player);
    if (!start) throw new Error(`No start for ${player}`);
    const base = clampPoint(start.base);
    const mine = clampPoint(start.mine);
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
    .map(clampPoint)
    .forEach((mine, index) => resources.push({ id: `gold-gen-${index + 1}`, kind: "goldMine", x: mine.x, y: mine.y, amount: MINE_GOLD }));
  const items: WorldItem[] = [];
  field.camps.forEach((camp, index) => {
    const at = clampPoint(camp.at);
    const kinds = campKinds(field, camp.tier);
    const creeps = kinds.map((unitKind, member) => {
      const spread = (member / kinds.length) * Math.PI * 2 + 0.3;
      return createUnit(`wildling-gen-${index + 1}-${member + 1}`, "neutral", unitKind, Math.round(at.x + detCos(spread) * CAMP_SPREAD), Math.round(at.y + detSin(spread) * CAMP_SPREAD));
    });
    units.push(...creeps);
    if (camp.item) items.push({ id: `treasure-gen-${index + 1}`, kind: camp.item, x: 0, y: 0, carrierId: creeps[0]!.id, cooldownRemaining: 0 });
  });
  const mercenaryCamps: MercenaryCamp[] = field.mercs.map((merc, index) => {
    const at = clampPoint(merc.at);
    return { id: `merc-gen-${index + 1}`, x: at.x, y: at.y, radius: 50, hireKind: merc.kind, cost: UNIT_DEFS[merc.kind].cost, stock: 3, cooldown: seconds(16), cooldownRemaining: 0 };
  });
  const landmarks: TerrainLandmark[] = [
    ...resources.map((mine) => ({ id: `gen-scar-${mine.id}`, kind: "mineScar" as const, x: mine.x, y: mine.y, size: 200, rotation: 0.3 })),
    ...field.camps.map((camp, index) => ({ id: `gen-camp-${index + 1}`, kind: "campMark" as const, ...clampPoint(camp.at), size: 200, rotation: 0.2 })),
    ...field.scenery,
  ];
  return { kind, starts, buildings, units, resources, mercenaryCamps, items, landmarks };
}

function campKinds(field: Field, tier: CampTier) {
  if (tier === "easy") return field.easyKinds;
  if (tier === "medium") return field.mediumKinds;
  if (tier === "strong") return field.strongKinds;
  return field.hardKinds;
}

// A point turned around the map's center.
function turnAround(point: Point, angle: number): Point {
  const offset = rotate(sub(point, { x: CENTER, y: CENTER }), angle);
  return { x: CENTER + offset.x, y: CENTER + offset.y };
}

// The point beyond `mine` on the far side from `from` (a guard stands between its mine and the open map).
function mirrorAway(mine: Point, from: Point): Point {
  return { x: mine.x * 2 - from.x, y: mine.y * 2 - from.y };
}

function polar(radius: number, angle: number): Point {
  return { x: CENTER + detCos(angle) * radius, y: CENTER + detSin(angle) * radius };
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

function clampPoint(point: Point): Point {
  return { x: Math.round(Math.max(EDGE, Math.min(SIZE - EDGE, point.x))), y: Math.round(Math.max(EDGE, Math.min(SIZE - EDGE, point.y))) };
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
