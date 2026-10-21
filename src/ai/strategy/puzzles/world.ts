import { BUILDING_DEFS, UNIT_DEFS } from '../../../shared/catalog';
import { campMembers } from '../../../shared/camps';
import { sketchScene, type SceneBuilder } from '../../../sdk/scene';
import { snapshotGame, stepGame, type Game } from '../../../shared/sim';
import { isBuildPlacementClear } from '../../../shared/build-placement';
import { isFootprintBuildable, isShoreFootprint, sameGround, snapToFootprint } from '../../../shared/terrain';
import type { Building, BuildingKind, CreepFamilyUnitKind, ResourceNode, Unit, UnitKind } from '../../../shared/types';
import type { Point } from '../types';

export const PUZZLE_OWNER = 'planner';
export const PUZZLE_OPPONENT = 'pressure';
export type LandRectangle = Readonly<{ left: number; top: number; right: number; bottom: number }>;
export type PuzzleWorld = {
  game: Game; owner: typeof PUZZLE_OWNER; opponent: typeof PUZZLE_OPPONENT;
  home: Building; army: Unit[]; workers: Unit[]; mine: ResourceNode; guards: Unit[];
  transport: Unit | undefined; departure: Point; landing: Point;
  beachGuards: Unit[]; attackers: Unit[]; islandHall: Building | undefined;
  islandWorkers: Unit[]; localMine: ResourceNode | undefined; localGuards: Unit[];
};
export function puzzleBuilder(gold: number) {
  return sketchScene('public-planner-frame').replaceDefaults()
    .player(PUZZLE_OWNER, { race: 'grove', ai: false })
    .player(PUZZLE_OPPONENT, { race: 'ember', ai: false })
    .playerState(PUZZLE_OWNER, { gold }).playerState(PUZZLE_OPPONENT, { gold: 0 });
}
export function soldiers(builder: SceneBuilder, kind: UnitKind, count: number, at: Point, owner = PUZZLE_OWNER as string) {
  for (let i = 0; i < count; i++) builder.unit(owner, kind, at.x + (i % 3) * 48, at.y + Math.floor(i / 3) * 48);
}
export function camp(builder: SceneBuilder, kinds: readonly CreepFamilyUnitKind[], center: Point) {
  for (const member of campMembers(kinds, center)) builder.unit('neutral', member.kind, member.x, member.y);
}
/** Construct native terrain; neither a pool-map selector nor an authored unit ID enters a puzzle. */
export function terrainWorld(builder: SceneBuilder, lands: readonly LandRectangle[], width = 4096, height = 3072): Game {
  const game = builder.build().createGame(), cell = 32;
  const cols = Math.ceil(width / cell), rows = Math.ceil(height / cell);
  let cells = '';
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const px = (x + .5) * cell, py = (y + .5) * cell;
    const land = lands.some(r => px >= r.left && px < r.right && py >= r.top && py < r.bottom);
    // Native shallow ground is shared by walkers and hulls. A dry cliff all the
    // way to deep water has no physical boarding rendezvous for a transport.
    const coast = lands.some(r => px >= r.left - cell * 2 && px < r.right + cell * 2
      && py >= r.top - cell * 2 && py < r.bottom + cell * 2
      && (px < r.left + cell * 2 || px >= r.right - cell * 2 || py < r.top + cell * 2 || py >= r.bottom - cell * 2));
    cells += coast ? ',' : land ? '.' : '~';
  }
  game.map = { ...game.map, width: cols * cell, height: rows * cell, landmarks: [], terrain: { cell, cols, rows, cells } };
  game.shops = []; game.obstacles = [];
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  game.scriptedVictory = true;
  return game;
}
/** Native impassable cliffs leave only the authored physical beach openings.
 * Without this ring an open rectangular island has many cheap unguarded
 * landings, so choosing a third beach would be a valid answer to the puzzle. */
export function cliffCoast(game: Game, land: LandRectangle, openings: readonly LandRectangle[]) {
  const terrain = game.map.terrain!;
  const cells = [...terrain.cells];
  for (let row = 0; row < terrain.rows; row++) for (let col = 0; col < terrain.cols; col++) {
    const x = (col + .5) * terrain.cell, y = (row + .5) * terrain.cell;
    const inside = (r: LandRectangle) => x >= r.left && x < r.right && y >= r.top && y < r.bottom;
    const outer = { left: land.left - 64, right: land.right + 64, top: land.top - 64, bottom: land.bottom + 64 };
    const inner = { left: land.left + 96, right: land.right - 96, top: land.top + 96, bottom: land.bottom - 96 };
    if (inside(outer) && !inside(inner) && !openings.some(inside)) cells[row * terrain.cols + col] = '#';
  }
  game.map = { ...game.map, terrain: { ...terrain, cells: cells.join('') } };
}
export const MAINLAND: LandRectangle = { left: 128, top: 128, right: 1536, bottom: 2816 };
export const ISLAND: LandRectangle = { left: 2304, top: 256, right: 3712, bottom: 1792 };
export const HOME = { x: 640, y: 768 }, TARGET_MINE = { x: 2976, y: 896 };
export const DEPARTURE = { x: 1472, y: 768 }, LANDING = { x: 2368, y: 768 };
export function homeEconomy(builder: SceneBuilder, farms = 2) {
  builder.townHall(PUZZLE_OWNER, HOME.x, HOME.y).farms(PUZZLE_OWNER, farms, 256, 256)
    .goldMine(`resource-${0}`, HOME.x, HOME.y + 224, 60 * UNIT_DEFS.worker.cost);
  soldiers(builder, 'worker', 3, { x: HOME.x - 96, y: HOME.y + 64 });
}
export function targetMine(builder: SceneBuilder, at = TARGET_MINE, amount = 100 * BUILDING_DEFS.townHall.cost) {
  builder.goldMine(`resource-${1}`, at.x, at.y, amount);
}
export function findMine(game: Game, at: Point) {
  const mine = game.resources.find(r => Math.hypot(r.x - at.x, r.y - at.y) < 1);
  if (!mine) throw new Error('Puzzle mine was not created');
  return mine;
}
export function neutralGroup(game: Game, at: Point, radius = 150) {
  return game.units.filter(u => u.owner === 'neutral' && Math.hypot(u.x - at.x, u.y - at.y) <= radius);
}
export function finishWorld(game: Game, target: Point, guard: Point, transport?: Point): PuzzleWorld {
  if (transport) game.spawnUnit(PUZZLE_OWNER, 'transport', transport.x, transport.y);
  // Run the actual derived-stat/supply pass before taking the cold frame.
  stepGame(game);
  const home = game.buildings.find(b => b.owner === PUZZLE_OWNER && b.kind === 'townHall')!;
  return { game, owner: PUZZLE_OWNER, opponent: PUZZLE_OPPONENT, home,
    army: game.units.filter(u => u.owner === PUZZLE_OWNER && u.kind !== 'worker' && !UNIT_DEFS[u.kind].naval),
    workers: game.units.filter(u => u.owner === PUZZLE_OWNER && u.kind === 'worker'),
    mine: findMine(game, target), guards: neutralGroup(game, guard), transport: game.units.find(u => u.owner === PUZZLE_OWNER && u.kind === 'transport'),
    departure: DEPARTURE, landing: LANDING, beachGuards: [], attackers: [], islandHall: undefined,
    islandWorkers: [], localMine: undefined, localGuards: [] };
}
export function legalBuildingSite(game: Game, kind: BuildingKind, preferred: Point) {
  const radius = BUILDING_DEFS[kind].radius, cell = game.map.terrain?.cell ?? 32;
  for (let ring = 0; ring <= 8; ring++) for (let y = -ring; y <= ring; y++) for (let x = -ring; x <= ring; x++) {
    if (ring && Math.max(Math.abs(x), Math.abs(y)) !== ring) continue;
    const p = snapToFootprint(game.map, radius, { x: preferred.x + x * cell, y: preferred.y + y * cell });
    const terrainFits = BUILDING_DEFS[kind].shore ? isShoreFootprint(game.map, p.x, p.y, radius)
      : isFootprintBuildable(game.map, p.x, p.y, radius);
    if (terrainFits && isBuildPlacementClear(snapshotGame(game), kind, p)) return p;
  }
  throw new Error(`No legal ${kind} footprint near puzzle construction point`);
}
export function physicallyOnLand(world: PuzzleWorld, unit: Unit, target: Point) {
  return unit.hp > 0 && !unit.deck && !unit.cabin && sameGround(world.game.map, unit, target);
}
