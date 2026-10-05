import { CAST } from "../campaigns/ashen-march/cast";
import { SCENERY } from "../campaigns/ashen-march/scenery";
import { UNIT_DEFS, resolveVariant } from "../shared/catalog";
import { createGame, issuePlayerCommand, snapshotGame, spawnVariantUnit, stepGame, type Game } from "../shared/sim";
import type { Terrain } from "../shared/terrain";
import { SIM_TICKS_PER_SECOND } from "../shared/time";
import type { GameCommand, GameSnapshot, PlayerId, RaceId, ResourceNode, ScenarioBuildingSeed, ScenarioUnitSeed, UnitKind } from "../shared/types";
import { enlist, modelBook, type PropPainter } from "../story/cast";
import type { PropView, StageView } from "../story/stage";
import { INK, WOOD, ellipse, line, polygon, type Brush } from "./art/kit";
import { UnitFacingTracker } from "./unit-facing";
import { UnitMotionSmoother } from "./unit-motion";
import { drawWorld, trackUnitFacing, type WorldLabels } from "./world-renderer";

// @@@menu-scenes - The home screen's backdrop: small worlds set up by hand and played live by the real simulation, drawn
// by the battlefield's own renderer with the campaign's cast and scenery and a few pieces of their own (a statue,
// runestones), under drifting mist, shafts of light and motes (embers, fireflies, glints on the water). A capital
// goes about its day, two hosts meet in a forest glade, a fleet sails past a lighthouse. One is drawn at random for each
// visit until the player picks one with the switch; the world is stepped at the game's tick rate and painted at most
// thirty times a second, and only while the menus are up.

type Point = { x: number; y: number };
type Text = { zh: string; en: string };
type Air = {
  // How far the day has gone: a wash of dark over the world, under the lights.
  dusk: number;
  // Mist: its colour as "r, g, b" and how thick it lies.
  mist: string;
  mistAlpha: number;
  // Shafts of light falling from the top edge, at this angle from straight down, in this colour ("r, g, b").
  rays: string;
  rayAngle: number;
  motes: "embers" | "fireflies" | "glints";
};
type Run = {
  game: Game;
  props: PropView[];
  // The world point the camera frames, right of the menu's buttons.
  focus: Point;
  zoom: number;
  // The scene's script, after every tick; `second` is the scene's age.
  script: (game: Game, second: number) => void;
  // Seconds after which the scene fades out and begins again; absent, it runs on.
  length?: number;
  // Where embers rise or runes glow, in world points.
  embers: Point[];
  glows: Point[];
  air: Air;
};
export type MenuScene = { id: string; name: Text; create: () => Run };

const CELL = 32;
const TICK_MS = 1000 / SIM_TICKS_PER_SECOND;
const FRAME_MS = 1000 / 30;
const FADE = 1.4;

// ---------------------------------------------------------------- building blocks

function terrainOf(width: number, height: number, kindAt: (x: number, y: number) => string): Terrain {
  const cols = Math.ceil(width / CELL);
  const rows = Math.ceil(height / CELL);
  let cells = "";
  for (let row = 0; row < rows; row += 1) for (let col = 0; col < cols; col += 1) cells += kindAt(col * CELL + CELL / 2, row * CELL + CELL / 2);
  return { cell: CELL, cols, rows, cells };
}

// Smooth value noise in [0, 1): the wobble of a forest's edge or a shore.
function noise(x: number, y: number, scale: number, seed: number) {
  const gx = x / scale;
  const gy = y / scale;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0, seed);
  const b = hash(x0 + 1, y0, seed);
  const c = hash(x0, y0 + 1, seed);
  const d = hash(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function hash(x: number, y: number, seed: number) {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Cast = { units: ScenarioUnitSeed[]; buildings: ScenarioBuildingSeed[]; resources: ResourceNode[]; props: PropView[] };

function cast(): Cast & {
  unit: (owner: PlayerId | "neutral", kind: UnitKind, x: number, y: number) => string;
  building: (owner: PlayerId, kind: ScenarioBuildingSeed["kind"], x: number, y: number) => string;
  prop: (kind: string, x: number, y: number, scale?: number, state?: string, flip?: boolean) => PropView;
} {
  const units: ScenarioUnitSeed[] = [];
  const buildings: ScenarioBuildingSeed[] = [];
  const props: PropView[] = [];
  let serial = 0;
  return {
    units,
    buildings,
    resources: [],
    props,
    unit(owner, kind, x, y) {
      const id = `menu-${kind}-${(serial += 1)}`;
      units.push({ id, owner, kind, x: Math.round(x), y: Math.round(y) });
      return id;
    },
    building(owner, kind, x, y) {
      const id = `menu-${kind}-${(serial += 1)}`;
      buildings.push({ id, owner, kind, x: Math.round(x), y: Math.round(y), complete: true });
      return id;
    },
    prop(kind, x, y, scale = 1, state, flip = false) {
      const view: PropView = { id: (serial += 1), kind, x, y, scale, flip, since: 0, ...(state ? { state } : {}) };
      props.push(view);
      return view;
    },
  };
}

function stage(width: number, height: number, terrain: Terrain, seats: [PlayerId, RaceId][], pieces: Cast): Game {
  const game = createGame("bareDuel", {
    players: seats.map(([id]) => id),
    aiPlayers: [],
    teams: Object.fromEntries(seats.map(([id]) => [id, id])),
    races: Object.fromEntries(seats),
    scenario: {
      replaceDefaultUnits: true,
      replaceDefaultBuildings: true,
      replaceDefaultResources: true,
      replaceDefaultMercenaryCamps: true,
      replaceDefaultLandmarks: true,
      addUnits: pieces.units,
      addBuildings: pieces.buildings,
      addResources: pieces.resources,
    },
  });
  game.map = { ...game.map, width, height, landmarks: [], terrain };
  game.items = [];
  game.scriptedVictory = true;
  enlist(game, CAST);
  return game;
}

function order(game: Game, owner: PlayerId, command: GameCommand) {
  issuePlayerCommand(game, owner, command);
}

function alive(game: Game, ids: string[]) {
  return ids.filter((id) => game.units.some((unit) => unit.id === id && unit.hp > 0));
}

function idle(game: Game, ids: string[]) {
  return ids.filter((id) => game.units.find((unit) => unit.id === id)?.order.type === "idle");
}

// ---------------------------------------------------------------- the scenes' own pieces

// A knight in stone on a plinth, sword raised.
function statue(b: Brush) {
  ellipse(b, 2, 24, 30, 8, "#30483630");
  polygon(b, [[-20, 24], [-18, 6], [18, 6], [20, 24]], "#b3ad96", INK, 1.2);
  polygon(b, [[-23, 6], [-17, -1], [17, -1], [23, 6]], "#cbc5ac", INK, 1.1);
  line(b, [[-14, 14], [14, 14]], "#8f8a75", 0.9);
  polygon(b, [[-9, -1], [-7, -32], [7, -32], [9, -1]], "#aaa58f", INK, 1.1);
  polygon(b, [[-13, -28], [-18, -10], [-9, -8]], "#9d9882", INK, 1);
  ellipse(b, 0, -38, 6.5, 6.5, "#b6b19b", INK);
  line(b, [[6, -28], [15, -48]], "#aaa58f", 3.4);
  line(b, [[15, -48], [19, -76]], "#dad6c2", 2.6);
  line(b, [[11, -50], [19, -46]], INK, 1.5);
}

// A standing stone cut with runes; its glow is the air's (see drawGlows).
function runestone(b: Brush) {
  ellipse(b, 2, 18, 18, 5, "#30483630");
  polygon(b, [[-10, 18], [-11, -26], [-3, -36], [8, -30], [11, 18]], "#8e8c7c", INK, 1.2);
  for (const [x1, y1, x2, y2] of [[-4, -24, 3, -18], [3, -18, -2, -10], [-3, -4, 4, 2], [0, 6, 0, 12]] as const) line(b, [[x1, y1], [x2, y2]], "#7fd6c8", 1.6);
}

const PROPS: Record<string, PropPainter> = { statue, runestone };

// ---------------------------------------------------------------- the capital

// Owners chosen for their ink (see ownerInk): the crown's gold, the grove's green, the ember host's red.
const CROWN = "lion";
const GROVE = "court";
const EMBERS = "cinder";

function capital(): Run {
  const width = 3600;
  const height = 2400;
  const c = { x: 1900, y: 1200 };
  const wall = { x: 470, y: 330, thick: 40 };
  const terrain = terrainOf(width, height, (x, y) => {
    const dx = x - c.x;
    const dy = y - c.y;
    const onWall = (Math.abs(dx) > wall.x - wall.thick && Math.abs(dx) <= wall.x && Math.abs(dy) <= wall.y) || (Math.abs(dy) > wall.y - wall.thick && Math.abs(dy) <= wall.y && Math.abs(dx) <= wall.x);
    const gate = (dy > 0 && Math.abs(dx) < 80) || (dx > 0 && Math.abs(dy) < 70);
    if (onWall && !gate) return "#";
    const reach = (dx / 1150) ** 2 + (dy / 760) ** 2 + (noise(x, y, 220, 3) - 0.5) * 0.5;
    if (reach > 1) return "T";
    const pond = Math.hypot(x - (c.x + 640), y - (c.y + 400)) + (noise(x, y, 90, 5) - 0.5) * 70;
    if (pond < 120) return "~";
    if (pond < 150) return ",";
    return ".";
  });
  const at = (dx: number, dy: number): [number, number] => [c.x + dx, c.y + dy];
  const p = cast();
  p.resources.push({ id: "menu-mine", kind: "goldMine", x: c.x + 760, y: c.y - 60, amount: 1_000_000 });
  p.building(CROWN, "townHall", ...at(0, -50));
  p.building(CROWN, "barracks", ...at(-280, -175));
  p.building(CROWN, "stables", ...at(275, -190));
  p.building(CROWN, "sanctum", ...at(-300, 150));
  p.building(CROWN, "workshop", ...at(-360, -20));
  for (let i = 0; i < 3; i += 1) p.building(CROWN, "farm", ...at(-130 + i * 62, -250));
  p.building(CROWN, "moonWell", ...at(190, 110));
  p.building(CROWN, "defenseTower", ...at(-130, 262));
  p.building(CROWN, "defenseTower", ...at(130, 262));
  const workers = [0, 1, 2, 3, 4].map((i) => p.unit(CROWN, "worker", ...at(80 + i * 22, 20)));
  const gate = [0, 1, 2].map((i) => p.unit(CROWN, "lancer", ...at(-40 + i * 40, 250)));
  const patrol = [p.unit(CROWN, "footman", ...at(-400, 250)), p.unit(CROWN, "footman", ...at(-370, 250))];
  const riders = [p.unit(CROWN, "knight", ...at(-30, 520)), p.unit(CROWN, "knight", ...at(30, 550)), p.unit(CROWN, "priest", ...at(0, 600))];
  for (const [dx, dy] of [[-wall.x, -wall.y], [wall.x, -wall.y], [-wall.x, wall.y], [wall.x, wall.y]] as const) p.prop("watchtower", ...at(dx, dy - 16), 1.4);
  for (const side of [-1, 1]) {
    p.prop("banner", ...at(side * 100, wall.y + 26), 1.5, undefined, side < 0);
    p.prop("banner", ...at(side * 66, 22), 1.3, undefined, side < 0);
    p.prop("campfire", ...at(side * 66, 262), 1.1, "lit");
  }
  p.prop("statue", ...at(0, 140), 1.5);
  for (let i = 0; i < 3; i += 1) p.prop("tent", ...at(150 + i * 64, 210 + (i % 2) * 12), 1.05, undefined, i % 2 === 1);
  p.prop("well", ...at(60, 205), 1.15);
  p.prop("cart", ...at(360, 250), 1.05);
  p.prop("crate", ...at(395, 215), 0.95);
  p.prop("crate", ...at(120, 280), 0.95);
  for (const [dx, dy] of [[-120, 150], [120, 175], [-420, 190], [400, -60]] as const) p.prop("tree", ...at(dx, dy), 1.15);
  p.prop("beacon", ...at(wall.x - 20, -110), 1.35, "lit");
  p.prop("reeds", ...at(640 - 100, 400 + 90), 1.2);
  p.prop("cairn", ...at(620, 160), 1.05);
  const game = stage(width, height, terrain, [[CROWN, "grove"]], p);
  const du = spawnVariantUnit(game, CROWN, CAST.du.id, ...at(-80, 70)).id;
  const tess = spawnVariantUnit(game, CROWN, CAST.tess.id, ...at(230, 160)).id;
  const folk = [
    ...[[-20, 190], [250, 190], [100, 300], [-200, 40], [330, 90], [-60, -190]].map(([dx, dy], i) => spawnVariantUnit(game, CROWN, i % 2 ? CAST.villagerWoman.id : CAST.villager.id, ...at(dx!, dy!)).id),
    du,
    tess,
  ];
  const stops: [number, number][] = [[60, 195], [175, 190], [280, 200], [-100, 110], [-80, -180], [230, 140], [-40, 230], [330, 260], [-220, 60], [100, -170]];
  const corners: [number, number][] = [[-400, 260], [-400, -260], [400, -260], [400, 260]];
  const random = seeded(7);
  return {
    game,
    props: p.props,
    focus: { x: c.x - 110, y: c.y + 30 },
    zoom: 1.25,
    embers: [at(-66, 262), at(66, 262), at(wall.x - 20, -130)].map(([x, y]) => ({ x, y })),
    glows: [],
    air: { dusk: 0.18, mist: "255, 230, 190", mistAlpha: 0.2, rays: "255, 210, 130", rayAngle: -0.42, motes: "embers" },
    script(g, second) {
      const tick = g.tick;
      if (tick === 1) {
        order(g, CROWN, { type: "mine", unitIds: workers, resourceId: "menu-mine" });
        order(g, CROWN, { type: "setStance", unitIds: gate, stance: "brace" });
        order(g, CROWN, { type: "holdPosition", unitIds: gate });
      }
      // Townsfolk stroll between the stalls, the well, the hall and the farms.
      if (tick % (SIM_TICKS_PER_SECOND * 3) === 0) {
        for (const id of idle(g, folk)) {
          if (random() < 0.4) continue;
          const [dx, dy] = stops[Math.floor(random() * stops.length)]!;
          order(g, CROWN, { type: "move", unitIds: [id], x: c.x + dx + (random() - 0.5) * 50, y: c.y + dy + (random() - 0.5) * 30 });
        }
      }
      // The watch walks the inside of the wall.
      if (tick % (SIM_TICKS_PER_SECOND * 8) === 2) {
        const [dx, dy] = corners[Math.floor(tick / (SIM_TICKS_PER_SECOND * 8)) % corners.length]!;
        order(g, CROWN, { type: "move", unitIds: alive(g, patrol), x: c.x + dx, y: c.y + dy });
      }
      // Riders come in at the gate, wait by the statue, and ride out again.
      const cycle = second % 36;
      if (tick % SIM_TICKS_PER_SECOND === 0 && Math.floor(cycle) === 1) order(g, CROWN, { type: "move", unitIds: alive(g, riders), x: c.x, y: c.y + 200 });
      if (tick % SIM_TICKS_PER_SECOND === 0 && Math.floor(cycle) === 20) order(g, CROWN, { type: "move", unitIds: alive(g, riders), x: c.x + 20, y: c.y + 640 });
    },
  };
}

// ---------------------------------------------------------------- the forest battle

function woods(): Run {
  const width = 3600;
  const height = 2400;
  const mid = (x: number) => 1220 + Math.sin(x / 520) * 110;
  const ring = { x: 2470, y: 800, r: 170 };
  const terrain = terrainOf(width, height, (x, y) => {
    const half = 270 + (noise(x, y, 200, 11) - 0.5) * 180;
    const inGlade = Math.abs(y - mid(x)) < half && x > 900 + noise(x, y, 120, 2) * 120 && x < 3000 - noise(x, y, 120, 4) * 120;
    const inRing = Math.hypot(x - ring.x, (y - ring.y) * 1.3) < ring.r + (noise(x, y, 80, 8) - 0.5) * 50;
    if (!inGlade && !inRing) return "T";
    const brook = Math.abs(x - (2120 - (y - 1220) * 0.3)) + (noise(x, y, 70, 9) - 0.5) * 50;
    if (brook < 42) return ",";
    return ".";
  });
  const p = cast();
  const grove: string[] = [];
  const embers: string[] = [];
  const ranks = (owner: string, kind: UnitKind, x: number, y: number, count: number, perRank: number, spacing = 40, into = grove) => {
    for (let i = 0; i < count; i += 1) into.push(p.unit(owner, kind, x - Math.floor(i / perRank) * spacing * (owner === GROVE ? 1 : -1), y + ((i % perRank) - (perRank - 1) / 2) * spacing));
  };
  const y = mid(1820);
  ranks(GROVE, "lancer", 1820, y, 8, 4);
  const lancers = [...grove];
  ranks(GROVE, "archer", 1680, y, 6, 3);
  const archers = grove.slice(lancers.length);
  ranks(GROVE, "priest", 1590, y - 60, 2, 2, 60);
  ranks(GROVE, "summoner", 1590, y + 80, 1, 1);
  const knights: string[] = [];
  ranks(GROVE, "knight", 1740, y - 220, 3, 3, 46, knights);
  const ey = mid(2480);
  ranks(EMBERS, "emberRavager", 2480, ey, 6, 3, 42, embers);
  const ravagers = [...embers];
  ranks(EMBERS, "cinderRunner", 2560, ey - 160, 5, 5, 40, embers);
  ranks(EMBERS, "ashHexer", 2660, ey + 40, 3, 3, 50, embers);
  // An ancient stag keeps a ring of standing stones above the glade.
  p.unit("neutral", "ancientStag", ring.x, ring.y);
  for (let i = 0; i < 7; i += 1) {
    const angle = (i / 7) * Math.PI * 2 + 0.3;
    p.prop(i % 3 === 0 ? "runestone" : "stone", ring.x + Math.cos(angle) * 125, ring.y + Math.sin(angle) * 82, 1.25);
  }
  for (const [x, dy, kind, scale] of [[1560, -230, "deadTree", 1.4], [1620, -190, "grave", 1.1], [1640, 230, "cairn", 1.2], [2300, 220, "ashPile", 1.2], [1980, -240, "tree", 1.3], [2200, 250, "tree", 1.2], [2060, 190, "deadTree", 1.2], [1500, 200, "statue", 1.3]] as const) {
    p.prop(kind, x, mid(x) + dy, scale);
  }
  p.prop("pyre", 2760, mid(2760) - 120, 1.4, "lit");
  p.prop("banner", 1560, y + 150, 1.5);
  p.prop("banner", 2720, ey + 180, 1.5, "ember", true);
  const game = stage(width, height, terrain, [[GROVE, "grove"], [EMBERS, "ember"]], p);
  grove.push(spawnVariantUnit(game, GROVE, CAST.treant.id, 1790, y + 220).id, spawnVariantUnit(game, GROVE, CAST.lynn.id, 1660, y - 110).id);
  embers.push(
    spawnVariantUnit(game, EMBERS, CAST.kharn.id, 2620, ey - 30).id,
    spawnVariantUnit(game, EMBERS, CAST.pyremancer.id, 2740, ey + 110).id,
    ...[0, 1, 2].map((i) => spawnVariantUnit(game, EMBERS, CAST.cinderHound.id, 2400, ey + 140 + i * 36).id),
  );
  return {
    game,
    props: p.props,
    focus: { x: 2150, y: mid(2150) - 60 },
    zoom: 1.15,
    length: 50,
    embers: [{ x: 2760, y: mid(2760) - 150 }],
    glows: p.props.filter((prop) => prop.kind === "runestone").map((prop) => ({ x: prop.x, y: prop.y - 10 })),
    air: { dusk: 0.34, mist: "205, 222, 208", mistAlpha: 0.24, rays: "246, 232, 178", rayAngle: 0.38, motes: "fireflies" },
    script(g) {
      const tick = g.tick;
      if (tick === 1) {
        order(g, GROVE, { type: "setStance", unitIds: lancers, stance: "brace" });
        order(g, GROVE, { type: "holdPosition", unitIds: [...lancers, ...archers] });
        order(g, EMBERS, { type: "setStance", unitIds: ravagers, stance: "shock" });
      }
      if (tick === SIM_TICKS_PER_SECOND * 2) order(g, EMBERS, { type: "attackMove", unitIds: alive(g, embers), x: 1500, y: mid(1500) });
      if (tick === SIM_TICKS_PER_SECOND * 7) order(g, GROVE, { type: "attackMove", unitIds: alive(g, knights), x: 2600, y: mid(2600) });
      if (tick === SIM_TICKS_PER_SECOND * 14) order(g, GROVE, { type: "attackMove", unitIds: alive(g, [...grove, ...knights]), x: 2700, y: mid(2700) });
    },
  };
}

// ---------------------------------------------------------------- the fleet

function fleet(): Run {
  const width = 3600;
  const height = 2400;
  const isle = { x: 2380, y: 780, r: 250 };
  const coast = (x: number) => 1880 - x * 0.2 + (noise(x, 0, 160, 6) - 0.5) * 120;
  const terrain = terrainOf(width, height, (x, y) => {
    const fromIsle = Math.hypot(x - isle.x, (y - isle.y) * 1.2) + (noise(x, y, 90, 12) - 0.5) * 110;
    const shore = y - coast(x);
    if (fromIsle < isle.r * 0.55 || shore > 110) return noise(x, y, 110, 13) > 0.55 ? "T" : ".";
    if (fromIsle < isle.r * 0.72 || shore > 55) return noise(x, y, 60, 14) > 0.62 ? "#" : ".";
    if (fromIsle < isle.r * 0.95 || shore > 0) return ",";
    // Drowned stones out on the water, far from the islands and the shore.
    if (noise(x, y, 70, 15) > 0.87 && fromIsle > isle.r * 1.5 && shore < -240) return "#";
    return "~";
  });
  const p = cast();
  p.prop("beacon", isle.x + 20, isle.y - 60, 1.9, "lit");
  p.prop("watchtower", isle.x - 90, isle.y - 10, 1.3);
  p.prop("runestone", isle.x + 110, isle.y + 30, 1.2);
  p.prop("dock", 2150, coast(2150) + 10, 1.5);
  p.prop("boat", 2070, coast(2070) - 4, 1.2);
  p.prop("boat", 2240, coast(2240) + 4, 1.1, undefined, true);
  p.prop("hut", 2000, coast(2000) + 110, 1.3);
  p.prop("crate", 2280, coast(2280) + 50, 1);
  p.prop("reeds", 2520, coast(2520) + 25, 1.3);
  const game = stage(width, height, terrain, [[CROWN, "grove"]], p);
  // The fleet: warships and transports in line, sailing east past the lighthouse at a third of a ship's speed, a slow
  // pass rather than a race (its own variants of the two ships, drawn as they are).
  for (const kind of ["warship", "transport"] as const) game.variants![`menu/${kind}`] = resolveVariant({ base: kind, speed: UNIT_DEFS[kind].speed / 3 });
  const lanes = [1110, 1170, 1230, 1050, 1290];
  const ships = lanes.map((y, index) => spawnVariantUnit(game, CROWN, index % 2 ? "menu/transport" : "menu/warship", 2050 - Math.abs(index - 2) * 130 - (index % 2) * 40, y).id);
  return {
    game,
    props: p.props,
    focus: { x: 2000, y: 1110 },
    zoom: 1.25,
    embers: [{ x: isle.x + 20, y: isle.y - 150 }],
    glows: [{ x: isle.x + 110, y: isle.y + 20 }],
    air: { dusk: 0.26, mist: "222, 230, 236", mistAlpha: 0.26, rays: "236, 240, 228", rayAngle: -0.2, motes: "glints" },
    script(g) {
      // East at an easy sail; a ship past the frame's right edge comes round again from the left, under the menu.
      ships.forEach((id, index) => {
        const ship = g.units.find((unit) => unit.id === id);
        if (!ship) return;
        if (ship.x > 3050) {
          ship.x = 1150;
          ship.y = lanes[index]!;
        }
        if (ship.order.type === "idle") order(g, CROWN, { type: "move", unitIds: [id], x: 3200, y: lanes[index]! });
      });
    },
  };
}

export const MENU_SCENES: MenuScene[] = [
  { id: "capital", name: { zh: "王城", en: "The Capital" }, create: capital },
  { id: "woods", name: { zh: "林间血战", en: "Battle in the Woods" }, create: woods },
  { id: "fleet", name: { zh: "海上船队", en: "The Fleet" }, create: fleet },
];

// ---------------------------------------------------------------- the backdrop

type Mote = { x: number; y: number; vx: number; vy: number; life: number; age: number; phase: number };

export class MenuBackdrop {
  private run: Run | undefined;
  private snapshot: GameSnapshot | undefined;
  private facing = new UnitFacingTracker();
  private motion = new UnitMotionSmoother();
  private models = modelBook(CAST);
  private started = 0;
  private clock: number | undefined;
  private carry = 0;
  private lastPaint = -Infinity;
  private motes: Mote[] = [];
  private random = seeded(Date.now());

  constructor(private readonly labels: WorldLabels, private index: number) {}

  get scene() {
    return MENU_SCENES[this.index]!;
  }

  next() {
    this.index = (this.index + 1) % MENU_SCENES.length;
    this.run = undefined;
    return this.scene;
  }

  /** Steps the scene to `now` and paints it, at most thirty times a second; the canvas keeps the last picture between. */
  draw(ctx: CanvasRenderingContext2D, width: number, height: number, now: number) {
    if (now - this.lastPaint < FRAME_MS) return;
    this.lastPaint = now;
    if (!this.run) this.begin(now);
    const run = this.run!;
    const elapsed = Math.min(250, now - (this.clock ?? now));
    this.clock = now;
    this.carry += elapsed;
    let stepped = false;
    while (this.carry >= TICK_MS) {
      this.carry -= TICK_MS;
      run.script(run.game, run.game.tick / SIM_TICKS_PER_SECOND);
      stepGame(run.game);
      stepped = true;
    }
    if (stepped || !this.snapshot) {
      this.snapshot = snapshotGame(run.game);
      trackUnitFacing(this.facing, this.snapshot);
    }
    const age = (now - this.started) / 1000;
    const zoom = run.zoom * Math.max(0.85, Math.min(1.4, height / 900));
    const view = { width: width / zoom, height: height / zoom };
    const map = run.game.map;
    const camera = {
      x: clamp(run.focus.x - view.width * 0.64 + Math.sin(age * 0.05) * 50, 0, map.width - view.width),
      y: clamp(run.focus.y - view.height * 0.5 + Math.cos(age * 0.04) * 30, 0, map.height - view.height),
    };
    ctx.save();
    drawWorld({
      ctx,
      snapshot: this.snapshot,
      view: { ...camera, width, height, zoom },
      now,
      facing: this.facing,
      motion: this.motion,
      labels: this.labels,
      still: true,
      models: this.models,
      props: (kind) => PROPS[kind] ?? SCENERY[kind],
      story: stageView(run),
    });
    const toScreen = (point: Point) => ({ x: (point.x - camera.x) * zoom, y: (point.y - camera.y) * zoom });
    const waterAt = (point: Point) => {
      const terrain = map.terrain;
      if (!terrain) return false;
      const col = Math.floor((point.x / zoom + camera.x) / terrain.cell);
      const row = Math.floor((point.y / zoom + camera.y) / terrain.cell);
      return terrain.cells[row * terrain.cols + col] === "~";
    };
    drawAir(ctx, width, height, age, run.air);
    drawGlows(ctx, run.glows.map(toScreen), age, zoom);
    this.drawMotes(ctx, run, width, height, elapsed / 1000, age, toScreen, waterAt, zoom);
    // The scene fades in, and a scene with an end fades out before it begins again.
    const fade = Math.max(0, 1 - age / FADE, run.length ? 1 - (run.length - age) / FADE : 0);
    if (fade > 0) {
      ctx.fillStyle = `rgba(12, 7, 3, ${Math.min(1, fade)})`;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.restore();
    if (run.length && age >= run.length) this.run = undefined;
  }

  private begin(now: number) {
    this.run = this.scene.create();
    this.snapshot = undefined;
    this.facing = new UnitFacingTracker();
    this.motion = new UnitMotionSmoother();
    this.started = now;
    this.clock = now;
    this.carry = 0;
    this.motes = [];
  }

  private drawMotes(ctx: CanvasRenderingContext2D, run: Run, width: number, height: number, dt: number, age: number, toScreen: (point: Point) => Point, waterAt: (point: Point) => boolean, zoom: number) {
    const random = this.random;
    const kind = run.air.motes;
    const target = kind === "embers" ? 70 : kind === "fireflies" ? 46 : 26;
    const sources = run.embers.map(toScreen);
    while (this.motes.length < target) {
      if (kind === "embers" || (kind === "glints" && sources.length > 0 && random() < 0.25)) {
        const from = sources[Math.floor(random() * sources.length)];
        if (!from) break;
        this.motes.push({ x: from.x + (random() - 0.5) * 18 * zoom, y: from.y - 10 * zoom, vx: (random() - 0.5) * 14, vy: -(24 + random() * 30), life: 1.6 + random() * 2.4, age: 0, phase: random() * 6 });
      } else if (kind === "fireflies") {
        this.motes.push({ x: width * (0.3 + random() * 0.7), y: height * (0.15 + random() * 0.8), vx: 0, vy: 0, life: 6 + random() * 8, age: 0, phase: random() * 6 });
      } else {
        // A glint is only where the sun can catch the water.
        const point = { x: width * (0.25 + random() * 0.75), y: height * random() };
        if (!waterAt(point)) continue;
        this.motes.push({ ...point, vx: 0, vy: 0, life: 0.6 + random() * 1.2, age: 0, phase: random() * 6 });
      }
    }
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const mote of this.motes) {
      mote.age += dt;
      const t = mote.age / mote.life;
      if (kind === "fireflies") {
        mote.vx += (Math.sin(age * 0.9 + mote.phase * 3) * 12 - mote.vx) * dt;
        mote.vy += (Math.cos(age * 0.7 + mote.phase * 2) * 10 - mote.vy) * dt;
      } else if (kind === "embers" || mote.vy !== 0) {
        mote.vx += Math.sin(age * 2 + mote.phase) * 8 * dt;
      }
      mote.x += mote.vx * dt;
      mote.y += mote.vy * dt;
      const fadeInOut = Math.sin(Math.PI * Math.min(1, t));
      if (kind === "fireflies") {
        const blink = 0.35 + 0.65 * Math.max(0, Math.sin(age * 2.2 + mote.phase * 5));
        glow(ctx, mote.x, mote.y, 7, `rgba(214, 240, 140, ${0.55 * blink * fadeInOut})`);
      } else if (kind === "embers" || mote.vy !== 0) {
        glow(ctx, mote.x, mote.y, 4 + 3 * (1 - t), `rgba(255, ${150 + Math.round(70 * (1 - t))}, 70, ${0.8 * fadeInOut})`);
      } else {
        const a = 0.7 * fadeInOut;
        ctx.strokeStyle = `rgba(255, 240, 200, ${a})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(mote.x - 4, mote.y);
        ctx.lineTo(mote.x + 4, mote.y);
        ctx.moveTo(mote.x, mote.y - 3);
        ctx.lineTo(mote.x, mote.y + 3);
        ctx.stroke();
      }
    }
    ctx.restore();
    this.motes = this.motes.filter((mote) => mote.age < mote.life && mote.y > -20);
    if (kind === "glints") drawGulls(ctx, width, height, age);
  }
}

function stageView(run: Run): StageView {
  return {
    tick: run.game.tick,
    lines: [],
    objectives: [],
    letterbox: { on: false, since: 0 },
    fade: { from: 0, to: 0, start: 0, end: 0 },
    markers: [],
    props: run.props,
    floaters: [],
    notices: [],
    nameplates: {},
    camera: { mode: "auto" },
  };
}

// Mist banks drifting slowly across, and shafts of light falling from above.
function drawAir(ctx: CanvasRenderingContext2D, width: number, height: number, age: number, air: Air) {
  ctx.save();
  ctx.fillStyle = `rgba(22, 12, 5, ${air.dusk})`;
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < 7; i += 1) {
    const radius = height * (0.28 + ((i * 37) % 10) / 40);
    const span = width + radius * 2;
    const x = ((((i * 0.37) % 1) * span + age * (9 + i * 3)) % span) - radius;
    const y = height * (0.35 + ((i * 53) % 10) / 15);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(${air.mist}, ${air.mistAlpha})`);
    gradient.addColorStop(1, `rgba(${air.mist}, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 5; i += 1) {
    const x = width * (0.42 + i * 0.13);
    const beam = 70 + ((i * 47) % 110);
    const strength = 0.16 * (0.55 + 0.45 * Math.sin(age * 0.35 + i * 1.7));
    ctx.save();
    ctx.translate(x, -40);
    ctx.rotate(air.rayAngle);
    const gradient = ctx.createLinearGradient(0, 0, 0, height * 1.3);
    gradient.addColorStop(0, `rgba(${air.rays}, ${strength})`);
    gradient.addColorStop(1, `rgba(${air.rays}, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(-beam / 2, 0, beam, height * 1.3);
    ctx.restore();
  }
  ctx.restore();
}

// Runes breathing a cold light.
function drawGlows(ctx: CanvasRenderingContext2D, points: Point[], age: number, zoom: number) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  points.forEach((point, index) => {
    const pulse = 0.5 + 0.5 * Math.sin(age * 1.3 + index * 1.9);
    glow(ctx, point.x, point.y, (26 + 12 * pulse) * zoom, `rgba(120, 230, 210, ${0.18 + 0.2 * pulse})`);
  });
  ctx.restore();
}

// Gulls wheeling over the water.
function drawGulls(ctx: CanvasRenderingContext2D, width: number, height: number, age: number) {
  ctx.save();
  ctx.strokeStyle = "rgba(40, 46, 50, 0.7)";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 5; i += 1) {
    const angle = age * (0.18 + i * 0.03) + i * 1.3;
    const x = width * (0.62 + 0.08 * (i % 3)) + Math.cos(angle) * (90 + i * 25);
    const y = height * (0.22 + 0.05 * i) + Math.sin(angle) * (40 + i * 10);
    const flap = 4 + 3 * Math.sin(age * 6 + i);
    ctx.beginPath();
    ctx.moveTo(x - 9, y - flap);
    ctx.quadraticCurveTo(x - 4, y - 2, x, y);
    ctx.quadraticCurveTo(x + 4, y - 2, x + 9, y - flap);
    ctx.stroke();
  }
  ctx.restore();
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, color.replace(/[\d.]+\)$/, "0)"));
  ctx.fillStyle = gradient;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(Math.max(low, high), value));
}
