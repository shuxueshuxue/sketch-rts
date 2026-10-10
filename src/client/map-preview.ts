import { createMapPresentation } from "../shared/presentation";
import { createGame, snapshotGame } from "../shared/sim";
import type { GameSnapshot, MapId, PlayerId } from "../shared/types";
import { drawMinimapMap, drawStartMarks } from "./minimap-art";
import { poolMap } from "../shared/map-pool";

// @@@map-preview - The lobby's picture of a map, as Warcraft III's custom game screen shows one: the game the room would
// start on it (the same seats and teams; a pool map draws its own layout, see @@@map-pool), drawn the way the minimap
// draws a match, with every start numbered by seat.

export type PreviewSeat = { playerId: PlayerId; team: string };
export type MapPreview = { snapshot: GameSnapshot; seats: PlayerId[]; facts: MapFacts };
export type MapFacts = { size: number; players: number; mines: number; camps: number; posts: number; items: number };

type CachedPreview = Pick<MapPreview, 'snapshot' | 'facts'>;
const cache = new Map<string, CachedPreview>();
const CACHE_SIZE = 24;

export function mapPreview(mapId: MapId, seats: PreviewSeat[], layoutSeed?: string): MapPreview {
  const pool = poolMap(mapId);
  const players = seats.map((seat) => seat.playerId);
  const teams = Object.fromEntries(seats.map((seat) => [seat.playerId, seat.team]));
  // Named shores have fixed physical seats. Alliance edits need new diplomacy, not another generated map.
  const key = JSON.stringify([mapId, layoutSeed || pool?.layout.seed || '', players, pool?.layout.kind === 'sides' ? null : seats.map(seat => seat.team)]);
  const kept = cache.get(key);
  if (kept) {
    cache.delete(key); cache.set(key, kept);
    return previewView(kept, players, teams);
  }
  const snapshot = freezeSnapshotValue(snapshotGame(createGame(mapId, { players, aiPlayers: [], teams,
    ...(layoutSeed ? { layout: { ...pool?.layout, seed: layoutSeed } } : {}) })));
  const marks = createMapPresentation(snapshot);
  const preview = {
    snapshot,
    facts: Object.freeze({
      size: snapshot.map.width,
      players: players.length,
      mines: snapshot.resources.length,
      camps: marks.filter((mark) => mark.category === "wildlingCamp").length,
      posts: snapshot.mercenaryCamps.length,
      items: snapshot.items.length,
    }),
  };
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
  cache.set(key, preview);
  return previewView(preview, players, teams);
}

function previewView(preview: CachedPreview, players: PlayerId[], teams: Record<PlayerId, string>): MapPreview {
  return { snapshot: { ...preview.snapshot, teams }, seats: [...players], facts: preview.facts };
}

// Preview generation owns this plain snapshot. Shared physical data stays read-only across callers and paint caches.
function freezeSnapshotValue<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeSnapshotValue(child);
    Object.freeze(value);
  }
  return value;
}

/** Paints the preview into its canvas at the canvas's own pixel size. */
export function drawMapPreview(canvas: HTMLCanvasElement, preview: MapPreview) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const rect = { x: 0, y: 0, width: canvas.width, height: canvas.height };
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawMinimapMap(ctx, preview.snapshot, rect);
  drawStartMarks(ctx, preview.snapshot, rect, preview.seats);
}
