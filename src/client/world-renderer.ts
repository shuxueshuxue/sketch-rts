import { drawAtlasBuilding, drawAtlasCamp, drawAtlasGround, drawAtlasLandmark, drawAtlasMine, drawAtlasUnit } from "./atlas-art";
import { drawScorchedUnitFlames, renderWorldEffects } from "./effect-renderer";
import { unitGlyphScale } from "./glyphs";
import type { createI18n } from "./i18n";
import { drawLevelStar } from "./level-star";
import { shouldRenderBuildingRally } from "./rally-visual";
import { generateTerrainLinework, type TextureStroke } from "./terrain-texture";
import { trainingQueueCountText } from "./training-queue";
import type { UnitFacingTracker } from "./unit-facing";
import { BUILDING_DEFS, UNIT_DEFS } from "../shared/catalog";
import type { Building, BuildingKind, GameSnapshot, MapId, MercenaryCamp, Owner, ResourceNode, TerrainLandmark, TrainableUnitKind, Unit, WorldItem } from "../shared/types";

type Point = { x: number; y: number };
type Brush = CanvasRenderingContext2D;

// @@@world-renderer - One frame of the battlefield, drawn from a snapshot with no DOM: the browser client and the
// headless recorder both call drawWorld, so a change to how the world looks reaches recordings too.

/** What the view looks at: `x`/`y` is the world point at the canvas's top-left; `zoom` scales world units to pixels. */
export type WorldView = {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom?: number;
};

/** The few words painted into the world, in the viewer's language. */
export type WorldLabels = {
  mercenaryStock: (stock: number) => string;
  unitKind: (kind: TrainableUnitKind) => string;
};

export function worldLabelsFor(i18n: ReturnType<typeof createI18n>): WorldLabels {
  return {
    mercenaryStock: (stock) => i18n.t("canvas.mercenaryStock", { stock }),
    unitKind: (kind) => i18n.label(kind),
  };
}

export type WorldFrame = {
  ctx: Brush;
  snapshot: GameSnapshot;
  view: WorldView;
  /** Animation clock in milliseconds (flames, auras, bobbing items). */
  now: number;
  facing: UnitFacingTracker;
  labels: WorldLabels;
  selectedIds?: ReadonlySet<string>;
  selectedCampId?: string;
};

type Painter = {
  ctx: Brush;
  snapshot: GameSnapshot;
  camera: Point;
  width: number;
  height: number;
  now: number;
  facing: UnitFacingTracker;
  labels: WorldLabels;
  selectedIds: ReadonlySet<string>;
  selectedCampId: string | undefined;
};

const NO_SELECTION: ReadonlySet<string> = new Set();

export function drawWorld(frame: WorldFrame) {
  const zoom = frame.view.zoom ?? 1;
  const painter: Painter = {
    ctx: frame.ctx,
    snapshot: frame.snapshot,
    camera: { x: frame.view.x, y: frame.view.y },
    width: frame.view.width / zoom,
    height: frame.view.height / zoom,
    now: frame.now,
    facing: frame.facing,
    labels: frame.labels,
    selectedIds: frame.selectedIds ?? NO_SELECTION,
    selectedCampId: frame.selectedCampId,
  };
  const { ctx, snapshot } = painter;
  ctx.save();
  ctx.scale(zoom, zoom);
  drawPaperMap(ctx, snapshot.map.id, painter.camera, painter.width, painter.height);
  drawLandmarks(painter, snapshot.map.landmarks);
  drawResources(painter, snapshot.resources);
  drawMercenaryCamps(painter, snapshot.mercenaryCamps);
  drawItems(painter, snapshot.items);
  drawBuildings(painter, snapshot.buildings);
  drawUnits(painter, snapshot.units);
  drawCarriedItems(painter, snapshot.items);
  renderWorldEffects({ ctx, effects: snapshot.effects, worldToScreen: (point) => worldToScreen(painter, point), nearScreen: (point, pad) => nearScreen(painter, point, pad) });
  ctx.restore();
}

/** Feeds the tracker every unit's facing for this snapshot; calling it twice for one snapshot changes nothing. */
export function trackUnitFacing(facing: UnitFacingTracker, snapshot: GameSnapshot) {
  const positions = new Map<string, Point>();
  for (const entity of [...snapshot.units, ...snapshot.buildings]) positions.set(entity.id, entity);
  facing.update(snapshot.units, (id) => positions.get(id));
}

export function drawPaperMap(ctx: Brush, mapId: MapId, camera: Point, width: number, height: number) {
  drawAtlasGround(ctx, width, height, camera);
  for (const stroke of generateTerrainLinework({ mapId, camera, width, height })) {
    drawTextureStroke(ctx, stroke);
  }
}

export function ownerInk(owner: Owner | undefined) {
  if (owner === "player") return "#387d72";
  if (owner === "enemy") return "#a85644";
  if (owner === "enemy2") return "#7f3a70";
  if (!owner || owner === "neutral") return "#704a33";
  const palette = ["#315f87", "#963c36", "#7f3a70", "#5d8b4c", "#b97927", "#596a8c", "#8d5a46", "#2f766f"];
  let hash = 0;
  for (const char of owner) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length]!;
}

export function buildingGlyphSize(kind: BuildingKind) {
  return kind === "townHall" ? 76 : 58;
}

function drawTextureStroke(ctx: Brush, stroke: TextureStroke) {
  if (stroke.points.length === 0) return;
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.beginPath();
  ctx.moveTo(stroke.points[0]!.x, stroke.points[0]!.y);
  for (const point of stroke.points.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.stroke();
}

function drawLandmarks(painter: Painter, landmarks: TerrainLandmark[]) {
  for (const landmark of landmarks) {
    const point = worldToScreen(painter, landmark);
    if (nearScreen(painter, point, landmark.size + 80)) drawAtlasLandmark(painter.ctx, landmark, point);
  }
}

function drawResources(painter: Painter, resources: ResourceNode[]) {
  const { ctx } = painter;
  for (const resource of resources) {
    const point = worldToScreen(painter, resource);
    if (!nearScreen(painter, point, 80)) continue;
    drawAtlasMine(ctx, point);
    ctx.font = "600 11px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "#776443";
    ctx.fillText(Math.ceil(resource.amount).toLocaleString(), point.x, point.y + 45);
    ctx.textAlign = "start";
  }
}

function drawMercenaryCamps(painter: Painter, camps: MercenaryCamp[]) {
  const { ctx } = painter;
  for (const camp of camps) {
    const point = worldToScreen(painter, camp);
    if (!nearScreen(painter, point, 110)) continue;
    if (painter.selectedCampId === camp.id) drawSelectionHalo(ctx, point.x, point.y + camp.radius * 0.56, camp.radius * 0.95, camp.radius * 0.3, "#96774a");
    drawAtlasCamp(ctx, point);
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillStyle = "#796644";
    ctx.textAlign = "center";
    ctx.fillText(painter.labels.mercenaryStock(camp.stock), point.x, point.y + 48);
    ctx.textAlign = "start";
    if (camp.cooldownRemaining > 0) drawProgress(ctx, point.x, point.y + 60, 1 - camp.cooldownRemaining / camp.cooldown);
  }
}

function drawBuildings(painter: Painter, buildings: Building[]) {
  const { ctx } = painter;
  for (const building of buildings) {
    const shake = hitFeedbackOffset(painter.snapshot, building, building.radius);
    const point = worldToScreen(painter, { x: building.x + shake.x, y: building.y + shake.y });
    const selected = painter.selectedIds.has(building.id);
    const trainable = BUILDING_DEFS[building.kind].trains.length > 0;
    const rallyPoint = worldToScreen(painter, { x: building.rallyX, y: building.rallyY });
    const showRally = shouldRenderBuildingRally({ selected, trainable });
    if (!nearScreen(painter, point, 120)) {
      if (showRally) drawBuildingRally(ctx, building, point, rallyPoint);
      continue;
    }
    ctx.strokeStyle = ownerInk(building.owner);
    ctx.fillStyle = building.complete ? "rgba(255, 250, 226, 0.72)" : "rgba(255, 250, 226, 0.42)";
    ctx.lineWidth = selected ? 4 : 2;
    const size = buildingGlyphSize(building.kind);
    if (selected) drawSelectionHalo(ctx, point.x, point.y + size / 2 - 3, size * 0.66, size * 0.22, ownerInk(building.owner));
    ctx.save();
    ctx.globalAlpha = building.complete ? 1 : 0.48;
    drawAtlasBuilding(ctx, building.kind, point, size, String(ctx.strokeStyle));
    ctx.restore();
    if (showRally) drawBuildingRally(ctx, building, point, rallyPoint);
    drawHp(ctx, point.x, point.y - size * 0.78 - 5, building.hp, building.maxHp);
    if (!building.complete) drawProgress(ctx, point.x, point.y + size * 0.6 + 10, building.buildProgress / building.buildTime);
    if (building.complete && building.queue[0]) {
      drawTrainingProgress(painter, point.x, point.y + size * 0.6 + 10, building.queue[0].remaining, building.queue[0].unitKind, building.queue.length);
    }
  }
}

function drawBuildingRally(ctx: Brush, building: Building, from: Point, to: Point) {
  const ink = building.rallyTarget?.type === "resource" ? "#b9861b" : building.rallyTarget?.type === "unit" ? "#5d8b4c" : "#315f87";
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 5]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(to.x, to.y, 7, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(to.x, to.y - 16);
  ctx.lineTo(to.x, to.y + 8);
  ctx.lineTo(to.x + 15, to.y - 8);
  ctx.lineTo(to.x, to.y - 8);
  ctx.fill();
  ctx.restore();
}

function drawUnits(painter: Painter, units: Unit[]) {
  const { ctx, now } = painter;
  trackUnitFacing(painter.facing, painter.snapshot);
  for (const unit of units) {
    const shake = hitFeedbackOffset(painter.snapshot, unit, unit.radius);
    const point = worldToScreen(painter, { x: unit.x + shake.x, y: unit.y + shake.y });
    const scale = unitGlyphScale(unit.radius);
    if (!nearScreen(painter, point, Math.max(60, unit.radius * 3))) continue;
    const selected = painter.selectedIds.has(unit.id);
    ctx.strokeStyle = ownerInk(unit.owner);
    ctx.fillStyle = unit.owner === "neutral" ? "#f0d9bd" : "#fffbe7";
    ctx.lineWidth = selected ? 4 : 2;
    if (hasCarriedItem(painter.snapshot, unit, "flameCloak")) drawFlameCloakAura(ctx, point, now, unit.radius);
    if (selected) {
      ctx.beginPath();
      ctx.ellipse(point.x, point.y + unit.radius * 0.72, unit.radius + 5, (unit.radius + 5) * 0.45, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    drawAtlasUnit(ctx, unit.kind, point, scale, String(ctx.strokeStyle), painter.facing.facing(unit.id));
    const scorch = unit.effects.find((effect) => effect.type === "scorch");
    if (scorch) drawScorchedUnitFlames(ctx, point, unit.radius, now, scorch.remaining);
    if (unit.kind === "worker" && unit.carryingGold > 0) drawCarriedGold(ctx, point.x, point.y);
    if (unit.level > 0) drawLevelStar(ctx, point.x + unit.radius + 5, point.y - unit.radius - 5, unit.level);
    drawHp(ctx, point.x, point.y - unit.radius * 1.8 - 6, unit.hp, unit.maxHp);
  }
}

function hasCarriedItem(snapshot: GameSnapshot, unit: Unit, kind: WorldItem["kind"]) {
  return snapshot.items.some((item) => item.kind === kind && item.carrierId === unit.id);
}

function drawFlameCloakAura(ctx: Brush, point: Point, now: number, radius: number) {
  const pulse = 0.55 + Math.sin(now / 140) * 0.14;
  ctx.save();
  ctx.strokeStyle = `rgba(150, 60, 54, ${pulse})`;
  ctx.fillStyle = "rgba(242, 137, 75, 0.12)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(point.x, point.y + 13, radius + 14, (radius + 14) * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "rgba(242, 137, 75, 0.72)";
  for (let index = 0; index < 5; index += 1) {
    const angle = now / 260 + index * 1.26;
    const x = point.x + Math.cos(angle) * (radius + 8);
    const y = point.y + 13 + Math.sin(angle) * (radius * 0.34);
    ctx.beginPath();
    ctx.moveTo(x, y + 5);
    ctx.quadraticCurveTo(x - 5, y - 3, x + 1, y - 11);
    ctx.quadraticCurveTo(x + 6, y - 3, x + 3, y + 5);
    ctx.stroke();
  }
  ctx.restore();
}

function drawItems(painter: Painter, items: WorldItem[]) {
  for (const item of items) {
    if (item.carrierId) continue;
    const point = worldToScreen(painter, item);
    if (!nearScreen(painter, point, 42)) continue;
    drawItemGlyph(painter.ctx, item, point, painter.now, false);
  }
}

function drawCarriedItems(painter: Painter, items: WorldItem[]) {
  for (const item of items) {
    if (!item.carrierId) continue;
    const point = worldToScreen(painter, item);
    if (!nearScreen(painter, point, 60)) continue;
    drawItemGlyph(painter.ctx, item, { x: point.x + 12, y: point.y - 34 }, painter.now, true);
  }
}

function drawSelectionHalo(ctx: Brush, x: number, y: number, rx: number, ry: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255, 250, 226, 0.8)";
  ctx.beginPath();
  ctx.ellipse(x - 2, y - 3, rx * 0.82, ry * 0.7, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawCarriedGold(ctx: Brush, x: number, y: number) {
  ctx.save();
  ctx.strokeStyle = "#8a6418";
  ctx.fillStyle = "#f2d05c";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 6, y - 24);
  ctx.lineTo(x + 2, y - 34);
  ctx.lineTo(x + 10, y - 23);
  ctx.lineTo(x + 1, y - 18);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawItemGlyph(ctx: Brush, item: WorldItem, point: Point, now: number, carried: boolean) {
  const bob = carried ? Math.sin(now / 180 + point.x * 0.03) * 2.5 : 0;
  const x = point.x;
  const y = point.y + bob;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (item.kind === "lightningRod") {
    ctx.strokeStyle = "#315f87";
    ctx.fillStyle = "#9ed8ff";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(x - 3, y + 9);
    ctx.lineTo(x + 6, y - 11);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 3, y - 13);
    ctx.lineTo(x + 11, y - 6);
    ctx.lineTo(x + 6, y - 6);
    ctx.lineTo(x + 12, y + 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + 6, y - 11, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (item.kind === "stormStaff") {
    ctx.strokeStyle = "#596073";
    ctx.fillStyle = "#d6d4f2";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 7, y + 9);
    ctx.lineTo(x + 5, y - 10);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + 6, y - 11, 5, 0.15, Math.PI * 1.8);
    ctx.stroke();
  } else if (item.kind === "flameCloak") {
    ctx.strokeStyle = "#963c36";
    ctx.fillStyle = "rgba(242, 137, 75, 0.72)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 7, y + 8);
    ctx.quadraticCurveTo(x - 13, y - 4, x - 4, y - 12);
    ctx.quadraticCurveTo(x + 12, y - 4, x + 7, y + 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (item.kind === "guardianScroll") {
    ctx.strokeStyle = "#704a33";
    ctx.fillStyle = "#fff6d0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(x - 8, y - 6, 16, 12);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 5, y - 2);
    ctx.lineTo(x + 5, y - 2);
    ctx.moveTo(x - 4, y + 3);
    ctx.lineTo(x + 4, y + 3);
    ctx.stroke();
  } else if (item.kind === "breachCharge") {
    ctx.strokeStyle = "#5f3a24";
    ctx.fillStyle = "#d28445";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y + 1, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 2, y - 7);
    ctx.quadraticCurveTo(x + 2, y - 13, x + 7, y - 9);
    ctx.stroke();
  } else {
    ctx.strokeStyle = "#8a6418";
    ctx.fillStyle = "#f2d05c";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - 10);
    ctx.lineTo(x + 8, y);
    ctx.lineTo(x, y + 10);
    ctx.lineTo(x - 8, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  if (carried) {
    ctx.strokeStyle = "rgba(49, 95, 135, 0.36)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(x, y + 13, 10, 3.2, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHp(ctx: Brush, x: number, y: number, hp: number, maxHp: number) {
  const width = 30;
  const ratio = Math.max(0, Math.min(1, hp / maxHp));
  ctx.fillStyle = "#31483a";
  ctx.fillRect(x - width / 2 - 1, y - 1, width + 2, 5);
  ctx.fillStyle = ratio > 0.45 ? "#90b781" : "#cd8062";
  ctx.fillRect(x - width / 2, y, width * ratio, 3);
}

function drawProgress(ctx: Brush, x: number, y: number, ratio: number) {
  ctx.fillStyle = "rgba(35, 49, 38, 0.18)";
  ctx.fillRect(x - 28, y, 56, 5);
  ctx.fillStyle = "#315f87";
  ctx.fillRect(x - 28, y, 56 * Math.max(0, Math.min(1, ratio)), 5);
}

function drawTrainingProgress(painter: Painter, x: number, y: number, remaining: number, unitKind: TrainableUnitKind, queueLength: number) {
  const { ctx } = painter;
  const total = UNIT_DEFS[unitKind].trainTime;
  drawProgress(ctx, x, y, 1 - remaining / total);
  ctx.fillStyle = "#315f87";
  ctx.font = "9px ui-monospace, monospace";
  const countText = trainingQueueCountText(queueLength);
  ctx.fillText(`${painter.labels.unitKind(unitKind)}${countText ? ` ${countText}` : ""}`, x - 27, y + 16);
}

function hitFeedbackOffset(snapshot: GameSnapshot, entity: Unit | Building, scale: number): Point {
  const hit = snapshot.effects.find((effect) => effect.type === "hit" && distance(effect, entity) <= scale + 8);
  if (!hit) return { x: 0, y: 0 };
  const pulse = Math.sin(hit.remaining * 1.7) * Math.max(2, scale * 0.18);
  return { x: pulse, y: -pulse * 0.35 };
}

function worldToScreen(painter: Painter, point: Point): Point {
  return { x: point.x - painter.camera.x, y: point.y - painter.camera.y };
}

function nearScreen(painter: Painter, point: Point, pad: number) {
  return point.x >= -pad && point.y >= -pad && point.x <= painter.width + pad && point.y <= painter.height + pad;
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
