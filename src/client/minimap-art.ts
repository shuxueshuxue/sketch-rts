import { createMapPresentation, projectWorldToRect, type MapPresentationMark } from "../shared/presentation";
import type { GameSnapshot, PlayerId } from "../shared/types";
import { terrainMinimap } from "./terrain-art";
import { ownerInk } from "./world-renderer";

type Brush = CanvasRenderingContext2D;
type Rect = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };

// @@@minimap-art - A map at minimap scale: the ground (see @@@terrain-art), mines, camps, posts, items, buildings and
// units. The match's minimap and the lobby's map preview (see @@@map-preview) draw the same picture.
export function drawMinimapMap(ctx: Brush, snapshot: GameSnapshot, rect: Rect, marks: MapPresentationMark[] = createMapPresentation(snapshot)) {
  ctx.fillStyle = "#dedcc0";
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  if (snapshot.map.terrain) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(terrainMinimap(snapshot.map.terrain), rect.x, rect.y, rect.width, rect.height);
    ctx.imageSmoothingEnabled = true;
  }
  // Marks grow with the picture: the minimap's are a few pixels, a preview twice its size draws them a little larger.
  const scale = Math.max(1, Math.min(2, rect.width / 220));
  for (const mark of marks) {
    const point = projectWorldToRect(mark, snapshot.map, rect);
    if (mark.category === "terrain") {
      drawMiniTerrainMark(ctx, mark, point);
    } else if (mark.category === "goldMine") {
      const r = 3 * scale;
      ctx.fillStyle = "#c4921e";
      ctx.strokeStyle = "#5a3d0c";
      ctx.lineWidth = scale > 1 ? 1 : 0;
      ctx.beginPath();
      ctx.moveTo(point.x, point.y - r);
      ctx.lineTo(point.x + r, point.y);
      ctx.lineTo(point.x, point.y + r);
      ctx.lineTo(point.x - r, point.y);
      ctx.closePath();
      ctx.fill();
      if (scale > 1) ctx.stroke();
    } else if (mark.category === "mercenaryCamp") {
      ctx.strokeStyle = "#704a33";
      ctx.lineWidth = 1.5 * scale;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3.5 * scale, 0, Math.PI * 2);
      ctx.stroke();
    } else if (mark.category === "wildlingCamp") {
      ctx.fillStyle = scale > 1 ? CAMP_BAND[mark.powerBand ?? "green"] : "#704a33";
      ctx.beginPath();
      ctx.arc(point.x, point.y, 2.6 * scale, 0, Math.PI * 2);
      ctx.fill();
    } else if (mark.category === "building") {
      ctx.fillStyle = ownerInk(mark.owner);
      ctx.fillRect(point.x - 3 * scale, point.y - 3 * scale, 6 * scale, 6 * scale);
    } else if (mark.owner !== "neutral" || scale === 1) {
      ctx.fillStyle = ownerInk(mark.owner);
      const size = mark.owner === "neutral" ? 2.2 : 3;
      ctx.fillRect(point.x - size / 2, point.y - size / 2, size, size);
    }
  }
  for (const item of snapshot.items) {
    const point = projectWorldToRect(item, snapshot.map, rect);
    ctx.strokeStyle = item.kind === "lightningRod" || item.kind === "stormStaff" ? "#315f87" : item.kind === "flameCloak" ? "#963c36" : item.kind === "breachCharge" ? "#5f3a24" : "#8a6418";
    ctx.lineWidth = 1.3 * scale;
    ctx.beginPath();
    ctx.moveTo(point.x - 2.5 * scale, point.y + 2.5 * scale);
    ctx.lineTo(point.x + 2.5 * scale, point.y - 2.5 * scale);
    ctx.stroke();
  }
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
    ctx.fillStyle = ownerInk(playerId);
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
