import { CORE_SCENERY } from "./art/scenery";
import { snapshotGame } from "../shared/sim";
import type { MenuSceneRun } from "./menu-scene-world";
import type { PaintedRemainsPreparation } from './world3d/painted-remains';
import { createPirateBoarding } from "./menu-pirate-boarding";
import { createCapitalStreet } from "./menu-capital-street";
import { createForestHorde } from "./menu-forest-horde";
import { SIM_TICKS_PER_SECOND } from "../shared/time";
import type { GameSnapshot } from "../shared/types";
import { type PropPainter } from "../story/cast";
import type { PropView, StageView } from "../story/stage";
import { INK, ellipse, line, polygon, type Brush } from "./art/kit";
import { paintBuildingModel } from "./art/building-models";
import { UnitFacingTracker } from "./unit-facing";
import { UnitMotionSmoother } from "./unit-motion";
import { UnitAnimationTracker } from "./unit-animation";
import { CombatPresentationTracker } from "./combat-presentation";
import { ProjectileOriginTracker } from "./projectile-origins";
import { drawWorld, trackUnitFacing, type WorldLabels,type WorldFrame } from "./world-renderer";

// @@@menu-scenes - Three bounded presentation casts, without match pathfinding
// or combat simulation. They share the game's world and asset renderers.

type Point = { x: number; y: number };
type Text = { zh: string; en: string };
type Run = MenuSceneRun;
type Air = Run["air"];
export type MenuScene = { id: string; name: Text; create: () => Run };

const FRAME_MS = 1000 / 30;
const FADE = 1.4;

// ---------------------------------------------------------------- building blocks

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

export const MENU_SCENES: MenuScene[] = [
  { id: "capital", name: { zh: "王城", en: "The Capital" }, create: createCapitalStreet },
  { id: "woods", name: { zh: "林间血战", en: "Army and Wild Horde" }, create: createForestHorde },
  { id: "fleet", name: { zh: "海盗夺船", en: "Pirate Boarding" }, create: createPirateBoarding },
];

// ---------------------------------------------------------------- the backdrop

type Mote = { x: number; y: number; vx: number; vy: number; life: number; age: number; phase: number };

export class MenuBackdrop {
  private run: Run | undefined;
  private snapshot: GameSnapshot | undefined;
  private facing = new UnitFacingTracker();
  private motion = new UnitMotionSmoother();
  private animation = new UnitAnimationTracker();
  private combat = new CombatPresentationTracker();
  private projectiles = new ProjectileOriginTracker();
  private started = 0;
  private clock: number | undefined;
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

  prepare(now:number){if(!this.run)this.begin(now);if(!this.snapshot){this.run!.script(this.run!.game,0);this.snapshot=snapshotGame(this.run!.game);}return this.snapshot;}
  /** Resource loading does not consume the opening beats of the presentation.
   * Keep this cast and its prepared assets; only display history starts anew. */
  startPresentation(now:number){
    if(!this.run)return;
    this.snapshot=undefined;
    this.facing=new UnitFacingTracker();
    this.motion=new UnitMotionSmoother();
    this.animation=new UnitAnimationTracker();
    this.combat.reset();this.projectiles.reset();
    this.started=now;this.clock=now;this.lastPaint=-Infinity;this.motes=[];
  }
  get artPreparation():PaintedRemainsPreparation|undefined{
    const run=this.run;
    if(!run?.warmCorpses?.length)return;
    return{corpses:run.warmCorpses,...(run.models?{models:run.models}:{})};
  }
  get architectureKinds(){return [...new Set([
    ...(this.run?.props.map(prop=>prop.kind).filter(kind=>['statue','well','beacon','citadel'].includes(kind))??[]),
    ...Object.values(this.run?.buildingModels??{}),
  ])];}

  /** Steps the scene to `now` and paints it, at most thirty times a second; the canvas keeps the last picture between. */
  draw(ctx: CanvasRenderingContext2D, width: number, height: number, now: number, reducedMotion = false,paint:(frame:WorldFrame)=>void=drawWorld) {
    if (now - this.lastPaint < FRAME_MS) return;
    this.lastPaint = now;
    if (!this.run) this.begin(now);
    const run = this.run!;
    const elapsed = Math.min(250, now - (this.clock ?? now));
    this.clock = now;
    const age = (now - this.started) / 1000;
    const sceneSecond = reducedMotion ? (run.stillSecond ?? 0) : age;
    run.game.tick = Math.floor(sceneSecond * SIM_TICKS_PER_SECOND);
    run.script(run.game, sceneSecond);
    this.snapshot = snapshotGame(run.game);
    trackUnitFacing(this.facing, this.snapshot);
    const framing = run.frameAt?.(sceneSecond, width, height);
    const zoom = framing?.zoom ?? run.zoom * Math.max(0.85, Math.min(1.4, height / 900));
    const view = { width: width / zoom, height: height / zoom };
    const map = run.game.map;
    const focus = framing?.focus ?? run.focus;
    const camera = {
      x: clamp(focus.x - view.width * (framing?.anchorX ?? .64), 0, map.width - view.width),
      y: clamp(focus.y - view.height * (framing?.anchorY ?? .5), 0, map.height - view.height),
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
      combat: this.combat,
      projectiles: this.projectiles,
      reducedMotion,
      labels: this.labels,
      still: true,

      ...(run.models ? { models: run.models } : {}),
      ...(run.buildingModels ? { buildingModels: run.buildingModels } : {}),
      props: (kind) => run.painters?.[kind] ?? PROPS[kind] ?? CORE_SCENERY[kind],
      story: stageView(run),
    });
    run.foreground?.(ctx, { ...camera, width, height, zoom }, sceneSecond);
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
    if (!reducedMotion && run.length && age >= run.length) this.run = undefined;
  }

  private begin(now: number) {
    this.run = this.scene.create();
    this.startPresentation(now);
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
  const actions = run.actions?.();
  return {
    tick: run.game.tick,
    ...(actions ? { unitActions: actions } : {}),
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
