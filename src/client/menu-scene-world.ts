import { createGame, type Game } from "../shared/sim";
import type { Terrain } from "../shared/terrain";
import type { Corpse, PlayerId, RaceId, ResourceNode, ScenarioBuildingSeed, ScenarioUnitSeed, UnitKind } from "../shared/types";
import type { PropPainter } from "../story/cast";
import type { PropView, StageView } from "../story/stage";
import type { WorldFrame, WorldView } from "./world-renderer";

type Point = { x: number; y: number };
export type MenuSceneRun = {
  game: Game;
  props: PropView[];
  focus: Point;
  zoom: number;
  script: (game: Game, second: number) => void;
  /** Bounded scene presentation advances its authored cast without match simulation. */
  presentation: true;
  stillSecond?: number;
  frameAt?: (second: number, width: number, height: number) => { focus: Point; zoom: number; anchorX: number; anchorY: number };
  models?: WorldFrame["models"];
  /** Finite authored casualties to prepare as assets without spawning them. */
  warmCorpses?: readonly Corpse[];
  buildingModels?: WorldFrame["buildingModels"];
  painters?: Readonly<Record<string, PropPainter>>;
  actions?: () => StageView["unitActions"];
  /** Scene-local deck signs and impact accents that must appear above the ship layer. */
  foreground?: (ctx: CanvasRenderingContext2D, view: WorldView, second: number) => void;
  length?: number;
  embers: Point[];
  glows: Point[];
  air: { dusk: number; mist: string; mistAlpha: number; rays: string; rayAngle: number; motes: "embers" | "fireflies" | "glints" };
};
const CELL = 32;

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

