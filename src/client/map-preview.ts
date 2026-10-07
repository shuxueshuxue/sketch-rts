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

const cache = new Map<string, MapPreview>();
const CACHE_SIZE = 24;

export function mapPreview(mapId: MapId, seats: PreviewSeat[], layoutSeed?: string): MapPreview {
  const key = `${mapId}|${layoutSeed ?? ""}|${seats.map((seat) => `${seat.playerId}:${seat.team}`).join(",")}`;
  const kept = cache.get(key);
  if (kept) return kept;
  const players = seats.map((seat) => seat.playerId);
  const snapshot = snapshotGame(createGame(mapId, { players, aiPlayers: [], teams: Object.fromEntries(seats.map((seat) => [seat.playerId, seat.team])),
    ...(layoutSeed ? { layout: { ...poolMap(mapId)?.layout, seed: layoutSeed } } : {}) }));
  const marks = createMapPresentation(snapshot);
  const preview = {
    snapshot,
    seats: players,
    facts: {
      size: snapshot.map.width,
      players: players.length,
      mines: snapshot.resources.length,
      camps: marks.filter((mark) => mark.category === "wildlingCamp").length,
      posts: snapshot.mercenaryCamps.length,
      items: snapshot.items.length,
    },
  };
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
  cache.set(key, preview);
  return preview;
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
