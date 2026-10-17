import { createMapPresentation, projectWorldToRect, type MapPresentationMark } from "../shared/presentation";
import type { GameSnapshot, Owner, PlayerId } from "../shared/types";
import { RELATION_INK, relationTo } from "./relations";
import { terrainMinimap } from "./terrain-art";
import { ownerInk } from "./world-renderer";
import { isInCabin } from '../shared/ship-cabin';
import { shipProfile } from '../shared/ship-geometry';

type Brush = CanvasRenderingContext2D;
type Rect = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };

// @@@minimap-art - A map at minimap scale, layered as Warcraft III's: the ground (see @@@terrain-art), then the map's own
// sites (mines, shops, camps, the creeps' camps), rocks, gates and items, then the players' buildings as squares the size
// of their footprints, then units: the creeps, the enemy, allies, the player's own on top, and what the player has
// selected in white over everything. Every mark of a player's has a dark rim so it reads on water, grass or rock alike;
// a ship is a hull along its heading. The caller draws its own layers above (the camera's box, the wind map). The
// match's minimap and the lobby's map preview (see @@@map-preview) draw the same picture.
// @@@minimap-relations - Given the player looking on, the players' buildings and units are in friend-or-foe colours (see
// @@@relation-ink): own green, allies yellow, enemies red; the creeps keep theirs.
export type MinimapView = { self?: PlayerId | undefined; selected?: ReadonlySet<string> };

export function drawMinimapMap(ctx: Brush, snapshot: GameSnapshot, rect: Rect, marks: MapPresentationMark[] = createMapPresentation(snapshot), viewer?: PlayerId, view: MinimapView = {}) {
  const ink = (owner: Owner | undefined) => (viewer && owner && owner !== "neutral" ? RELATION_INK[relationTo(snapshot, viewer, owner)] : ownerInk(owner, snapshot));
  ctx.fillStyle = "#dedcc0";
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  if (snapshot.map.terrain) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(terrainMinimap(snapshot.map.terrain), rect.x, rect.y, rect.width, rect.height);
    ctx.imageSmoothingEnabled = true;
  }
  // Marks grow with the picture: the minimap's are a few pixels, a preview twice its size draws them a little larger.
  const scale = Math.max(1, Math.min(2, rect.width / 220));
  const perUnit = rect.width / snapshot.map.width;
  const self = view.self ?? viewer;
  const selected = view.selected ?? new Set<string>();
  const sheltered = new Set(snapshot.units.filter(isInCabin).map(unit => unit.id));
  const unitsById = new Map(snapshot.units.map(unit => [unit.id, unit]));
  const project = (point: Point) => projectWorldToRect(point, snapshot.map, rect);
  const pieces: MapPresentationMark[] = [];
  for (const mark of marks) {
    if (mark.category === "unit" || mark.category === "building") { pieces.push(mark); continue; }
    const point = project(mark);
    if (mark.category === "terrain") drawMiniTerrainMark(ctx, mark, point);
    else if (mark.category === "goldMine") {
      const mine = snapshot.resources.find(resource => mark.sourceIds.includes(resource.id));
      drawGoldMine(ctx, point, Math.max(3.4 * scale, 32 * perUnit), mine !== undefined && mine.amount <= 0);
    } else if (mark.category === "mercenaryCamp") drawMercenaryCamp(ctx, point, 3.6 * scale);
    else if (mark.category === "wildlingCamp") {
      ctx.fillStyle = scale > 1 ? CAMP_BAND[mark.powerBand ?? "green"] : "#704a33";
      ctx.beginPath();
      ctx.arc(point.x, point.y, 2.6 * scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (const shop of snapshot.shops ?? []) drawShop(ctx, project(shop), 3.6 * scale);
  for (const item of snapshot.items) {
    if (item.carrierId) continue;
    const point = project(item);
    ctx.strokeStyle = item.kind === "lightningRod" || item.kind === "stormStaff" ? "#315f87" : item.kind === "flameCloak" ? "#963c36" : item.kind === "breachCharge" ? "#5f3a24" : "#8a6418";
    ctx.lineWidth = 1.3 * scale;
    ctx.beginPath();
    ctx.moveTo(point.x - 2.5 * scale, point.y + 2.5 * scale);
    ctx.lineTo(point.x + 2.5 * scale, point.y - 2.5 * scale);
    ctx.stroke();
  }
  // Rocks and gates (see @@@obstacle): a short bar across the way each shuts.
  for (const obstacle of snapshot.obstacles ?? []) {
    const point = project(obstacle);
    const half = 3.2 * scale;
    ctx.strokeStyle = obstacle.kind === "gate" ? "#4f3f30" : "#6e6b58";
    ctx.lineWidth = 2.2 * scale;
    ctx.beginPath();
    ctx.moveTo(point.x - obstacle.along.y * half, point.y + obstacle.along.x * half);
    ctx.lineTo(point.x + obstacle.along.y * half, point.y - obstacle.along.x * half);
    ctx.stroke();
  }
  // Players' pieces: buildings under units, and within each the creeps, the enemy, allies, then the player's own.
  const layer = (mark: MapPresentationMark) => (mark.category === "building" ? 0 : 4)
    + (mark.owner === "neutral" ? 0 : !self || !mark.owner ? 1 : mark.owner === self ? 3 : relationTo(snapshot, self, mark.owner) === "enemy" ? 1 : 2);
  const isSelected = (mark: MapPresentationMark) => mark.sourceIds.some(id => selected.has(id));
  const ordered = pieces.filter(mark => !(mark.category === "unit" && mark.sourceIds.some(id => sheltered.has(id))))
    .map((mark, index) => ({ mark, index, layer: layer(mark) + (isSelected(mark) ? 8 : 0) }))
    .sort((a, b) => a.layer - b.layer || a.index - b.index);
  for (const { mark } of ordered) {
    const fill = isSelected(mark) ? SELECTED_INK : ink(mark.owner);
    const point = project(mark);
    if (mark.category === "building") {
      const side = Math.max(4 * scale, 2 * mark.radius * perUnit);
      drawPiece(ctx, point, side, side, 0, fill);
      continue;
    }
    if (mark.owner === "neutral") {
      // A creep is a small dot on the minimap; a preview shows its camp's mark instead (see wildlingCamp above).
      if (scale === 1) drawPiece(ctx, point, 2.2, 2.2, 0, fill);
      continue;
    }
    const unit = unitsById.get(mark.sourceIds[0]!);
    const hull = unit && shipProfile(unit);
    if (unit && hull) drawPiece(ctx, point, Math.max(7 * scale, hull.length * perUnit), Math.max(3 * scale, hull.beam * perUnit), unit.sailing?.heading ?? 0, fill);
    else drawPiece(ctx, point, 3 * scale, 3 * scale, 0, fill);
  }
}

// What the player has selected, over every colour a side can have.
const SELECTED_INK = "#ffffff";
const RIM_INK = "#14110c";

// A player's piece: a rectangle (a square for a building or a soldier, a hull for a ship) in its colour, on a dark rim.
function drawPiece(ctx: Brush, point: Point, length: number, width: number, heading: number, fill: string) {
  if (heading === 0) {
    ctx.fillStyle = RIM_INK;
    ctx.fillRect(point.x - length / 2 - 1, point.y - width / 2 - 1, length + 2, width + 2);
    ctx.fillStyle = fill;
    ctx.fillRect(point.x - length / 2, point.y - width / 2, length, width);
    return;
  }
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate(heading);
  ctx.fillStyle = RIM_INK;
  ctx.fillRect(-length / 2 - 1, -width / 2 - 1, length + 2, width + 2);
  ctx.fillStyle = fill;
  ctx.fillRect(-length / 2, -width / 2, length, width);
  ctx.restore();
}

// A mine as Warcraft III marks one: a gold piece on a dark rim; worked out, it is grey.
function drawGoldMine(ctx: Brush, point: Point, radius: number, empty: boolean) {
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius + 1, 0, Math.PI * 2);
  ctx.fillStyle = "#3b2708";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = empty ? "#8c8778" : "#f0c23a";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(point.x - radius * .3, point.y - radius * .3, radius * .35, 0, Math.PI * 2);
  ctx.fillStyle = empty ? "#b4ae9c" : "#fff0b0";
  ctx.fill();
}

// A shop, a neutral building the player may use: a pale roofed house on a dark rim.
function drawShop(ctx: Brush, point: Point, size: number) {
  const roof = () => {
    ctx.beginPath();
    ctx.moveTo(point.x - size, point.y);
    ctx.lineTo(point.x, point.y - size);
    ctx.lineTo(point.x + size, point.y);
    ctx.lineTo(point.x + size * .75, point.y);
    ctx.lineTo(point.x + size * .75, point.y + size * .9);
    ctx.lineTo(point.x - size * .75, point.y + size * .9);
    ctx.lineTo(point.x - size * .75, point.y);
    ctx.closePath();
  };
  roof();
  ctx.lineWidth = 2;
  ctx.strokeStyle = RIM_INK;
  ctx.stroke();
  ctx.fillStyle = "#e9dcff";
  ctx.fill();
}

// A mercenary camp: a tent on a dark rim.
function drawMercenaryCamp(ctx: Brush, point: Point, size: number) {
  ctx.beginPath();
  ctx.moveTo(point.x, point.y - size);
  ctx.lineTo(point.x + size, point.y + size * .8);
  ctx.lineTo(point.x - size, point.y + size * .8);
  ctx.closePath();
  ctx.lineWidth = 2;
  ctx.strokeStyle = RIM_INK;
  ctx.stroke();
  ctx.fillStyle = "#d9884a";
  ctx.fill();
}

// Camps by the danger of their creeps, as Warcraft III colours them: green easy, orange fair, red hard.
const CAMP_BAND = { green: "#4f8a3a", orange: "#c77a1c", red: "#a8322a" } as const;

/** Every start's hall, ringed in its player's colour and numbered by seat, as Warcraft III marks start locations. */
export function drawStartMarks(ctx: Brush, snapshot: GameSnapshot, rect: Rect, seats: PlayerId[]) {
  const radius = Math.max(8, rect.width / 42);
  ctx.save();
  ctx.font = `700 ${Math.round(radius * 1.15)}px Georgia, "Songti SC", serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  seats.forEach((playerId, index) => {
    const hall = snapshot.buildings.find((building) => building.owner === playerId && building.kind === "townHall");
    if (!hall) return;
    const point = projectWorldToRect(hall, snapshot.map, rect);
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = ownerInk(playerId, snapshot);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#f3e3b5";
    ctx.stroke();
    ctx.fillStyle = "#fff6dc";
    ctx.fillText(String(index + 1), point.x, point.y + 1);
  });
  ctx.restore();
}

function drawMiniTerrainMark(ctx: Brush, mark: MapPresentationMark, point: Point) {
  ctx.save();
  ctx.lineWidth = 1;
  if (mark.kind === "road") {
    ctx.strokeStyle = "rgba(123, 101, 66, 0.62)";
    ctx.beginPath();
    ctx.moveTo(point.x - 4, point.y);
    ctx.lineTo(point.x + 4, point.y);
    ctx.stroke();
  } else if (mark.kind === "grove") {
    ctx.strokeStyle = "rgba(64, 108, 66, 0.62)";
    ctx.beginPath();
    ctx.arc(point.x, point.y, 2.3, 0, Math.PI * 2);
    ctx.stroke();
  } else if (mark.kind === "ridge") {
    ctx.strokeStyle = "rgba(84, 90, 68, 0.62)";
    ctx.beginPath();
    ctx.moveTo(point.x - 3, point.y + 2);
    ctx.lineTo(point.x, point.y - 2);
    ctx.lineTo(point.x + 3, point.y + 2);
    ctx.stroke();
  } else if (mark.kind === "ditch") {
    ctx.strokeStyle = "rgba(54, 100, 112, 0.62)";
    ctx.beginPath();
    ctx.moveTo(point.x - 3, point.y);
    ctx.quadraticCurveTo(point.x, point.y + 2, point.x + 3, point.y);
    ctx.stroke();
  } else if (mark.kind === "mineScar") {
    ctx.fillStyle = "rgba(184, 133, 31, 0.58)";
    ctx.fillRect(point.x - 1.5, point.y - 1.5, 3, 3);
  } else {
    ctx.fillStyle = "rgba(47, 61, 42, 0.48)";
    ctx.fillRect(point.x - 1.2, point.y - 1.2, 2.4, 2.4);
  }
  ctx.restore();
}
