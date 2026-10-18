import { poolMap, type PoolMapId } from "../shared/map-pool";
import { createRoom, seatTeam } from "../shared/rooms";
import { drawMapPreview, mapPreview } from "./map-preview";

// @@@map-thumbnails - The map list's pictures are the game's own preview of each map (see @@@map-preview), with its default
// seats and no start numbers, drawn small. Making one takes a map's generation (17-150 ms), so they are drawn one per idle
// moment, the chosen map and the rows in view first, and kept by map and layout for the page's life. A row shows its box at
// full size before its picture comes, so nothing moves when it does.
const THUMBNAIL_SIZE = 96;
const drawn = new Map<string, string>();
let pending: HTMLElement | undefined;
let scheduled = false;

const key = (mapId: PoolMapId) => `${mapId}|${poolMap(mapId)?.layout.seed ?? ""}`;

/** Fills the thumbnails of a map list (img[data-thumbnail-map]) from what is drawn, and draws the rest when idle. */
export function fillMapThumbnails(list: HTMLElement) {
  for (const img of list.querySelectorAll<HTMLImageElement>("img[data-thumbnail-map]")) {
    const url = drawn.get(key(img.dataset.thumbnailMap as PoolMapId));
    if (url && img.src !== url) img.src = url;
  }
  pending = list;
  schedule();
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  const idle = window.requestIdleCallback ?? ((callback: () => void) => window.setTimeout(callback, 16));
  idle(() => {
    scheduled = false;
    const list = pending;
    if (!list?.isConnected) return;
    const next = nextToDraw(list);
    if (!next) return;
    const url = draw(next);
    drawn.set(key(next), url);
    for (const img of list.querySelectorAll<HTMLImageElement>(`img[data-thumbnail-map="${next}"]`)) img.src = url;
    schedule();
  });
}

// The chosen map first, then the rows in view (top to bottom), then the rest in list order.
function nextToDraw(list: HTMLElement): PoolMapId | undefined {
  const box = list.getBoundingClientRect();
  const waiting = [...list.querySelectorAll<HTMLImageElement>("img[data-thumbnail-map]")].filter(img => !drawn.has(key(img.dataset.thumbnailMap as PoolMapId)));
  const inView = (img: HTMLImageElement) => {
    const rect = img.getBoundingClientRect();
    return rect.bottom > box.top && rect.top < box.bottom && rect.right > box.left && rect.left < box.right;
  };
  const chosen = waiting.find(img => img.closest("[aria-pressed='true']"));
  return (chosen ?? waiting.find(inView) ?? waiting[0])?.dataset.thumbnailMap as PoolMapId | undefined;
}

function draw(mapId: PoolMapId): string {
  const room = createRoom({ id: "thumbnail", host: { id: "thumbnail", name: "" }, mapId, humanCount: 1, aiCount: (poolMap(mapId)?.players ?? 2) - 1 });
  const preview = mapPreview(mapId, room.slots.map(slot => ({ playerId: slot.playerId, team: seatTeam(slot) })));
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = THUMBNAIL_SIZE;
  drawMapPreview(canvas, { ...preview, seats: [] });
  return canvas.toDataURL();
}
