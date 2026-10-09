import { CORE_SCENERY } from "./art/scenery";
import { createGame, issuePlayerCommand, snapshotGame, stepGame, type Game } from "../shared/sim";
import type { Terrain } from "../shared/terrain";
import { SIM_TICKS_PER_SECOND } from "../shared/time";
import type { GameSnapshot, PlayerId, RaceId, ResourceNode, ScenarioBuildingSeed, ScenarioUnitSeed, UnitKind } from "../shared/types";
import { type PropPainter } from "../story/cast";
import type { PropView, StageView } from "../story/stage";
import { INK, ellipse, line, polygon, type Brush } from "./art/kit";
import { paintBuildingModel } from "./art/building-models";
import { UnitFacingTracker } from "./unit-facing";
import { UnitMotionSmoother } from "./unit-motion";
import { UnitAnimationTracker } from "./unit-animation";
import { drawWorld, trackUnitFacing, type WorldLabels,type WorldFrame } from "./world-renderer";
import { boardUnit, deckPlacement, projectDeckPoint, syncDecks } from '../shared/decks';
import { localToWorld, shipProfile } from '../shared/ship-geometry';

// @@@menu-scenes - Composed small worlds running the same collision, pathfinding
// and combat as a match. Scripts issue orders; only simulation moves actors.

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
  return game;
}

// ---------------------------------------------------------------- the scenes' own pieces

// A standing stone cut with runes; its glow is the air's (see drawGlows).
function runestone(b: Brush) {
  ellipse(b, 2, 18, 18, 5, "#30483630");
  polygon(b, [[-10, 18], [-11, -26], [-3, -36], [8, -30], [11, 18]], "#8e8c7c", INK, 1.2);
  for (const [x1, y1, x2, y2] of [[-4, -24, 3, -18], [3, -18, -2, -10], [-3, -4, 4, 2], [0, 6, 0, 12]] as const) line(b, [[x1, y1], [x2, y2]], "#7fd6c8", 1.6);
}

const PROPS: Record<string, PropPainter> = {
  statue: b => paintBuildingModel(b, "statue", "#867658"),
  well: b => paintBuildingModel(b, "well", "#867658"),
  beacon: b => paintBuildingModel(b, "beacon", "#867658"), runestone,
};

// ---------------------------------------------------------------- the capital

// Owners chosen for their ink (see ownerInk): the crown's gold, the grove's green, the ember host's red.
const CROWN = "lion";
const GROVE = "court";
const EMBERS = "cinder";

/** A bounded demonstration match. Authored destinations are orders, never
 * coordinate animation. Forest encounters fade and restart before drifting away. */
function directedScene(kind: "capital" | "woods" | "fleet"): Run {
  const width = 3600, height = 2400, cx = 2100, cy = 1200;
  const p = cast();
  const terrain = terrainOf(width, height, (x, y) => {
    const dx = x - cx, dy = y - cy;
    if (kind === "fleet") {
      const shore = dy - 370 + Math.sin(dx / 230) * 60;
      return shore > 90 ? "T" : shore > 10 ? "." : shore > -45 ? "," : "~";
    }
    if (kind === "capital") {
      if (Math.abs(dx) > 790 || Math.abs(dy) > 590) return "T";
      if (dy < -290 && dy > -335 && Math.abs(dx) > 95) return "#";
      return ".";
    }
    const edge = 310 + Math.sin(dx / 260) * 75;
    return Math.abs(dy) > edge || Math.abs(dx) > 1100 ? "T" : ".";
  });
  type Track = { id: string; x: number; y: number; dx: number; dy: number; period: number; phase: number; duel?: boolean };
  const tracks: Track[] = [];
  const actor = (owner: string, unitKind: UnitKind, x: number, y: number, dx = 0, dy = 0, period = 24, phase = 0, duel = false) => {
    const id = p.unit(owner, unitKind, cx + x, cy + y);
    tracks.push({ id, x: cx + x, y: cy + y, dx, dy, period, phase, duel });
  };
  if (kind === "capital") {
    p.building(CROWN, "townHall", cx + 30, cy - 200);
    p.building(CROWN, "sanctum", cx - 260, cy - 190);
    p.building(CROWN, "barracks", cx + 285, cy - 150);
    p.building(CROWN, "stables", cx + 330, cy + 140);
    for (const side of [-1, 1]) {
      p.building(CROWN, "defenseTower", cx + side * 120, cy + 240);
      p.prop("banner", cx + side * 70, cy + 225, 1.3);
      p.prop("campfire", cx + side * 145, cy + 260, .85, "lit");
      p.building(CROWN, "farm", cx - 410, cy + side * 95);
      actor(CROWN, "lancer", side * 73, 205);
    }
    p.prop("statue", cx + 5, cy + 15, 1.45);
    p.prop("well", cx - 220, cy + 65, 1.1);
    p.prop("cart", cx + 235, cy + 180, 1);
    for (let i = 0; i < 4; i++) actor(CROWN, "footman", -150 + i * 25, 115, 260, 0, 36, i * .004);
    for (let i = 0; i < 3; i++) actor(CROWN, "worker", -310, -70 + i * 37, 175, 0, 30, i * .22);
    actor(CROWN, "knight", -25, 440, 0, -300, 45);
    actor(CROWN, "knight", 25, 485, 0, -300, 45);
  } else if (kind === "woods") {
    for (let i = 0; i < 5; i++) {
      const y = (i - 2) * 52;
      actor(GROVE, i % 2 ? "footman" : "lancer", -150, y, 0, 0, 4.5, i * .13, true);
      actor(EMBERS, "emberRavager", 150, y + 8, 0, 0, 4.5, i * .13 + .5, true);
    }
    for (let i = 0; i < 4; i++) {
      actor(GROVE, "archer", -280 - i % 2 * 40, -90 + i * 58, 0, 0, 5, i * .22, true);
      actor(EMBERS, "sparkArcher", 280 + i % 2 * 40, -82 + i * 58, 0, 0, 5, i * .22 + .4, true);
    }
    actor(GROVE, "knight", -280, -180, 410, 0, 28);
    actor(GROVE, "knight", -310, -218, 410, 0, 28);
    p.prop("deadTree", cx + 295, cy + 225, 1.6);
    p.prop("stone", cx - 310, cy + 195, 1.6);
    p.prop("banner", cx - 330, cy - 30, 1.4);
    p.prop("banner", cx + 350, cy + 65, 1.4, "ember", true);
    p.prop("campfire", cx + 330, cy + 170, 1, "lit");
  } else {
    p.building(CROWN, "shipyard", cx + 320, cy + 280);
    for (let i = 0; i < 5; i++) actor(CROWN, i % 2 ? "transport" : "warship", -650 + i * 290, -190 + i % 2 * 220, 280, 0, 30);
    p.prop("beacon", cx + 510, cy + 300, 1.6, "lit");
  }
  const game = stage(width, height, terrain, [[CROWN, "grove"], [GROVE, "grove"], [EMBERS, "ember"]], p);
  const deckPatrols: { shipId: string; crewId: string; phase: number }[] = [];
  if(kind==='fleet') {
    // This convoy sails both ways along a confined channel in a steady beam
    // wind. Its timed return legs do not request open-water upwind tacks.
    game.map.wind={direction:Math.PI/2,speed:80};
    for(const [index,ship] of game.units.filter(unit=>shipProfile(unit)).entries()) {
      const profile=shipProfile(ship)!;
      for(const [unitKind,x,y] of [['footman',-.22,.23],['archer',.15,.22],['worker',-.12,-.22]] as const) {
        const crew=game.spawnUnit(ship.owner,unitKind,ship.x,ship.y);
        if(!boardUnit(ship,crew,game.units)){game.units=game.units.filter(unit=>unit.id!==crew.id);continue;}
        const point=deckPlacement(ship,crew,game.units,{x:x*profile.length,y:y*profile.beam});
        if(point)crew.deck={shipId:ship.id,...point};
        // Armed decks may have room only for their two guards. Patrol with
        // workers who actually boarded, including the roomy transports.
        if(unitKind==='worker')deckPatrols.push({shipId:ship.id,crewId:crew.id,phase:index});
      }
    }
    syncDecks(game.units);
  }
  if (kind === "capital") {
    game.map.landmarks.push({id:"avenue",kind:"road",x:cx,y:cy+85,size:860,rotation:Math.PI/2}, {id:"cross-street",kind:"road",x:cx-50,y:cy+110,size:860,rotation:0});
  } else if (kind === "woods") {
    for(let i=0;i<13;i++) game.map.landmarks.push({id:`debris-${i}`,kind:i%3===0?"log":"pebbles",x:cx-390+(i*131)%790,y:cy+(i%2?210:-225),size:26+i%3*10,rotation:i*.7});
  }
  const fires = p.props.filter(prop => prop.state === "lit").map(prop => ({ x: prop.x, y: prop.y - 15 }));
  return {
    game, props: p.props, focus: { x: cx, y: cy }, zoom: kind === "fleet" ? 1.05 : 1.32,
    ...(kind === "woods" ? {length: 45} : {}),
    embers: fires, glows: fires,
    air: { dusk: kind === "woods" ? .22 : .1, mist: "211, 204, 185", mistAlpha: .12, rays: "248, 222, 171", rayAngle: -.45, motes: kind === "fleet" ? "glints" : "embers" },
    script(g) {
      // Only local deck orders animate the patrol; the hull carries idle guards.
      for(const patrol of deckPatrols) {
        if((g.tick+patrol.phase*SIM_TICKS_PER_SECOND)%(SIM_TICKS_PER_SECOND*8)!==1)continue;
        const ship=g.units.find(unit=>unit.id===patrol.shipId),crew=g.units.find(unit=>unit.id===patrol.crewId);
        if(!ship || crew?.deck?.shipId!==ship.id || !['idle','hold'].includes(crew.order.type))continue;
        const profile=shipProfile(ship)!,outward=Math.floor((g.tick+patrol.phase*SIM_TICKS_PER_SECOND)/(SIM_TICKS_PER_SECOND*8))%2===0;
        const point=projectDeckPoint(ship,crew,{x:(outward?.12:-.15)*profile.length,y:-.22*profile.beam},g.units);
        if(point)issuePlayerCommand(g,crew.owner,{type:'move',unitIds:[crew.id],...localToWorld(ship,point)});
      }
      for (const track of tracks) {
        const unit = g.units.find(unit => unit.id === track.id);
        if (!unit) continue;
        if (kind === "woods") {
          // Genuine targeting, damage, death and collision. Riders join later.
          if (g.tick === (unit.kind === "knight" ? 8 * SIM_TICKS_PER_SECOND : 1))
            issuePlayerCommand(g, unit.owner, {type:"attackMove", unitIds:[unit.id], x:cx+(unit.owner===GROVE?260:-260), y:cy});
          continue;
        }
        if (track.dx === 0 && track.dy === 0) {
          if (g.tick === 1) issuePlayerCommand(g,unit.owner,{type:"holdPosition",unitIds:[unit.id]});
          continue;
        }
        // Reverse destinations at low frequency; the real pathfinder routes
        // around buildings and troops. Never repair a route by teleportation.
        if (kind === 'fleet') {
          // A convoy turns as one. Individual endpoint tests made blocked rear
          // ships keep sailing into the ships already on their return leg.
          if (g.tick === 1 || g.tick % (SIM_TICKS_PER_SECOND * track.period) === 0) {
            const outward = Math.floor(g.tick / (SIM_TICKS_PER_SECOND * track.period)) % 2 === 0;
            issuePlayerCommand(g,unit.owner,{type:'move',unitIds:[unit.id],x:track.x+(outward?track.dx:0),y:track.y+(outward?track.dy:0)});
          }
        } else if (g.tick === 1 || g.tick % (SIM_TICKS_PER_SECOND * 3) === 0 && unit.order.type === "idle") {
          const atEnd = Math.hypot(unit.x-track.x-track.dx,unit.y-track.y-track.dy) < 40;
          issuePlayerCommand(g,unit.owner,{type:"move",unitIds:[unit.id],x:track.x+(atEnd?0:track.dx),y:track.y+(atEnd?0:track.dy)});
        }
      }
    },
  };
}
const capital = () => directedScene("capital");
const woods = () => directedScene("woods");
const fleet = () => directedScene("fleet");

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
  private animation = new UnitAnimationTracker();
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

  prepare(now:number){if(!this.run)this.begin(now);this.snapshot??=snapshotGame(this.run!.game);return this.snapshot;}
  get architectureKinds(){return this.run?.props.map(prop=>prop.kind).filter(kind=>['statue','well','beacon','citadel'].includes(kind))??[];}

  /** Steps the scene to `now` and paints it, at most thirty times a second; the canvas keeps the last picture between. */
  draw(ctx: CanvasRenderingContext2D, width: number, height: number, now: number, reducedMotion = false,paint:(frame:WorldFrame)=>void=drawWorld) {
    if (now - this.lastPaint < FRAME_MS) return;
    this.lastPaint = now;
    if (!this.run) this.begin(now);
    const run = this.run!;
    const elapsed = Math.min(250, now - (this.clock ?? now));
    this.clock = now;
    if (!reducedMotion) this.carry += elapsed;
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
    paint({
      ctx,
      snapshot: this.snapshot,
      view: { ...camera, width, height, zoom },
      now,
      facing: this.facing,
      motion: this.motion,
      animation: this.animation,
      reducedMotion,
      labels: this.labels,
      still: true,

      props: (kind) => PROPS[kind] ?? CORE_SCENERY[kind],
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
    this.animation = new UnitAnimationTracker();
    this.started = now;
    this.clock = now;
    this.carry = 0;
    this.motes = [];
  }

  private drawMotes(ctx: CanvasRenderingContext2D, run: Run, width: number, height: number, dt: number, age: number, toScreen: (point: Point) => Point, waterAt: (point: Point) => boolean, zoom: number) {
    const random = this.random;
    const kind = run.air.motes;
    const target = kind === "embers" ? 18 : kind === "fireflies" ? 18 : 16;
    const sources = run.embers.map(toScreen);
    let attempts = 0;
    while (this.motes.length < target && attempts++ < target * 3) {
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
    const strength = 0.055 * (0.55 + 0.45 * Math.sin(age * 0.35 + i * 1.7));
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
    glow(ctx, point.x, point.y, (26 + 12 * pulse) * zoom, `rgba(240, 177, 98, ${0.08 + 0.08 * pulse})`);
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
  gradient.addColorStop(1, color.replace(/,[^,]+\)$/, ", 0)"));
  ctx.fillStyle = gradient;
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
}

function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(Math.max(low, high), value));
}
