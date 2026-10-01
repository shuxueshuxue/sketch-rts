import { LADDER_MAP_ID } from "../shared/map-ids";
import { createMapPresentation } from "../shared/presentation";
import { createGame, snapshotGame } from "../shared/sim";
import type { GameSnapshot, PlayerId } from "../shared/types";
import { drawMinimapMap, drawStartMarks } from "./minimap-art";

// @@@map-preview - The lobby's picture of a ladder layout, as Warcraft III's custom game screen shows a map: the game
// the room would start (the same seed, seats and teams; see @@@generated-map), drawn the way the minimap draws a match,
// with every start numbered by seat.

export type PreviewSeat = { playerId: PlayerId; team: string };
export type MapPreview = { snapshot: GameSnapshot; seats: PlayerId[]; facts: MapFacts };
export type MapFacts = { size: number; players: number; teams: number; mines: number; camps: number; posts: number; items: number };

const cache = new Map<string, MapPreview>();
const CACHE_SIZE = 24;

export function ladderPreview(seed: string, seats: PreviewSeat[]): MapPreview {
  const key = `${seed}|${seats.map((seat) => `${seat.playerId}:${seat.team}`).join(",")}`;
  const kept = cache.get(key);
  if (kept) return kept;
  const players = seats.map((seat) => seat.playerId);
  const game = createGame(LADDER_MAP_ID, { players, aiPlayers: [], teams: Object.fromEntries(seats.map((seat) => [seat.playerId, seat.team])), layout: { seed } });
  const snapshot = snapshotGame(game);
  const marks = createMapPresentation(snapshot);
  const preview = {
    snapshot,
    seats: players,
    facts: {
      size: snapshot.map.width,
      players: players.length,
      teams: new Set(seats.map((seat) => seat.team)).size,
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
