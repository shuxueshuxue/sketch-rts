import { UNIT_DEFS } from "../shared/catalog";
import { createGame, type Game } from "../shared/sim";
import type { Terrain } from "../shared/terrain";
import type { Corpse, GameSnapshot, PlayerId, RaceId, ResourceNode, ScenarioBuildingSeed, ScenarioUnitSeed, UnitKind } from "../shared/types";
import type { PropPainter } from "../story/cast";
import type { PropView, StageView } from "../story/stage";
import type { WorldFrame, WorldView } from "./world-renderer";

type Point = { x: number; y: number };
/** The home battles the match simulation fights (see @@@menu-battles). */
export type MenuBattleId = "woods" | "fleet";
/** An authored scene's script: poses its cast for any second of the scene. */
export type MenuScript = (game: Game, second: number) => void;
export type MenuSceneRun = {
  game: Game;
  props: PropView[];
  focus: Point;
  zoom: number;
  stillSecond?: number;
  frameAt?: (second: number, width: number, height: number, snapshot: GameSnapshot) => { focus: Point; zoom: number; anchorX: number; anchorY: number };
  models?: WorldFrame["models"];
  /** Finite authored casualties to prepare as assets without spawning them. */
  warmCorpses?: readonly Corpse[];
  buildingModels?: WorldFrame["buildingModels"];
  painters?: Readonly<Record<string, PropPainter>>;
  actions?: () => StageView["unitActions"];
  /** Scene-local deck signs and impact accents that must appear above the ship layer. */
  foreground?: (ctx: CanvasRenderingContext2D, view: WorldView, second: number, snapshot: GameSnapshot) => void;
  length?: number;
  embers: Point[];
  glows: Point[];
  air: { dusk: number; mist: string; mistAlpha: number; rays: string; rayAngle: number; motes: "embers" | "fireflies" | "glints" };
} & (
  /** An authored presentation: its script poses the cast for any second, without match simulation. */
  | { presentation: true; script: MenuScript }
  /** A battle: `game` is its opening, and the match simulation fights it on from there (see @@@menu-battles). */
  | { battle: { scene: MenuBattleId; seed: number } }
);
const CELL = 32;

export function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type AuthoredMenuSceneRun = Extract<MenuSceneRun, { script: MenuScript }>;

/** A battle is decided once one side has nobody left who can fight: a healer alone is no army, and neither is a hull
 * whose crew is gone. */
export function battleDecided(snapshot: Pick<GameSnapshot, "units">) {
  return new Set(snapshot.units.filter((unit) => unit.hp > 0 && unit.attackDamage > 0 && !UNIT_DEFS[unit.kind].naval).map((unit) => unit.owner)).size < 2;
}

export function terrainOf(width: number, height: number, kindAt: (x: number, y: number) => string): Terrain {
  const cols = Math.ceil(width / CELL);
  const rows = Math.ceil(height / CELL);
  let cells = "";
  for (let row = 0; row < rows; row += 1) for (let col = 0; col < cols; col += 1) cells += kindAt(col * CELL + CELL / 2, row * CELL + CELL / 2);
  return { cell: CELL, cols, rows, cells };
}

export type Cast = { units: ScenarioUnitSeed[]; buildings: ScenarioBuildingSeed[]; resources: ResourceNode[]; props: PropView[] };

export function cast(): Cast & {
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

export function stage(width: number, height: number, terrain: Terrain, seats: [PlayerId, RaceId][], pieces: Cast): Game {
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

