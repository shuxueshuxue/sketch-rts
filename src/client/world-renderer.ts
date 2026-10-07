import { itemEquipped } from "../shared/equipment";
import { drawCanvasShip,deckVisualHeight,drawShipFlag } from "./art/canvas-ships";
import { localToWorld,shipProfile,shipPassengers } from "../shared/ship-geometry";
import { engagedEntityIds, healthBarColor, shouldShowHealthBar } from "./health-bars";
import { drawPaintedItem } from "./art/items";
import type { SiteModelKind } from "./art/building-models";
import { SIM_TICKS_PER_SECOND } from "../shared/time";
import { drawAtlasCorpse, drawAtlasBuilding, drawAtlasCamp, drawAtlasGround, drawAtlasLandmark, drawAtlasMine, drawAtlasModel, drawAtlasObstacle, drawAtlasShop, drawAtlasUnit, obstacleArtTop } from "./atlas-art";
import { drawScorchedUnitFlames, renderWorldEffects } from "./effect-renderer";
import { footprintSquare } from "./footprint-view";
import { creatureShadow } from "./art/painted-creatures";
import { unitGlyphScale } from "./glyphs";
import type { createI18n } from "./i18n";
import { drawLevelStar } from "./level-star";
import { shouldRenderBuildingRally } from "./rally-visual";
import { RELATION_INK, relationTo } from "./relations";
import { drawTerrain } from "./terrain-art";
import { generateTerrainLinework, type TextureStroke } from "./terrain-texture";
import { trainingQueueCountText } from "./training-queue";
import type { UnitFacingTracker } from "./unit-facing";
import type { UnitMotionSmoother } from "./unit-motion";
import type { UnitAnimationTracker } from "./unit-animation";
import type { ShipWakeTracker } from './ship-wakes';
import { drawStoryAir, drawStoryGround, drawStoryProps, drawStoryScreen } from "./story-renderer";
import type { PropPainter, UnitModel } from "../story/cast";
import type { StageView } from "../story/stage";
import { BUILDING_DEFS, UNIT_DEFS, unitMover } from "../shared/catalog";
import type { Building, BuildingKind, GameSnapshot, MapId, MercenaryCamp, Obstacle, Owner, PlayerId, ResourceNode, Shop, TerrainLandmark, TrainableUnitKind, Unit, WorldItem,WorldEffect } from "../shared/types";

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
  /** Terrain and annotations flank the shared GPU depth layer. Recorder/fallback
   * callers omit this and retain the complete Canvas renderer. */
  pass?: 'ground' | 'overlay';
  actorPositions?: ReadonlyMap<string,{x:number;y:number;bodyY:number;topY:number}>;
  physicalEffects?: ReadonlySet<WorldEffect['type']>;
  /** Optional per-match pose history. Omit for static diagrams and portraits. */
  animation?: UnitAnimationTracker;
  wakes?: ShipWakeTracker;
  reducedMotion?: boolean;
  ctx: Brush;
  snapshot: GameSnapshot;
  view: WorldView;
  /** Animation clock in milliseconds (flames, auras, bobbing items). */
  now: number;
  facing: UnitFacingTracker;
  /** Glides charging riders between snapshots by `now` (see unit-motion); without it units are drawn at their snapshot spots. */
  motion?: UnitMotionSmoother;
  labels: WorldLabels;
  selectedIds?: ReadonlySet<string>;
  controlGroups?: Readonly<Record<string, readonly string[]>>;
  selectedCampId?: string;
  /** The player looking on: rings are in friend-or-foe colours to them (see @@@relation-ink); without one, the owners'. */
  viewer?: PlayerId;
  /** The unit or building under the pointer: ringed thinly, as a selected one is. */
  hoveredId?: string;
  /** A campaign's own units' models, by variant (see story/cast); without it a variant is drawn as its base kind. */
  buildingModels?: Readonly<Record<string,SiteModelKind>>;
  models?: (variant: string) => UnitModel | undefined;
  /** A campaign's scenery painters, by prop kind (see story/stage props). */
  props?: (kind: string) => PropPainter | undefined;
  /** The story's stage (see story/stage): bubbles, titles, objectives and the rest, drawn over the world. */
  story?: StageView;
  locale?: "zh" | "en";
  /** A picture of the world rather than a match (see @@@menu-scene): no health bars, no gold counts. */
  still?: boolean;
};

type Painter = {
  actorPositions: WorldFrame['actorPositions'];
  animation: UnitAnimationTracker | undefined;
  reducedMotion: boolean;
  ctx: Brush;
  snapshot: GameSnapshot;
  camera: Point;
  width: number;
  height: number;
  now: number;
  facing: UnitFacingTracker;
  motion: UnitMotionSmoother | undefined;
  labels: WorldLabels;
  selectedIds: ReadonlySet<string>;
  controlGroups: WorldFrame["controlGroups"];
  selectedCampId: string | undefined;
  viewer: PlayerId | undefined;
  hoveredId: string | undefined;
  models: WorldFrame["models"];
  buildingModels: WorldFrame["buildingModels"];
  still: boolean;
};

const NO_SELECTION: ReadonlySet<string> = new Set();

export function drawWorld(frame: WorldFrame) {
  const zoom = frame.view.zoom ?? 1;
  const painter: Painter = {
    actorPositions: frame.actorPositions,
    animation: frame.animation,
    reducedMotion: frame.reducedMotion ?? false,
    ctx: frame.ctx,
    snapshot: frame.snapshot,
    camera: { x: frame.view.x, y: frame.view.y },
    width: frame.view.width / zoom,
    height: frame.view.height / zoom,
    now: frame.now,
    facing: frame.facing,
    motion: frame.motion,
    labels: frame.labels,
    selectedIds: frame.selectedIds ?? NO_SELECTION,
    controlGroups: frame.controlGroups,
    selectedCampId: frame.selectedCampId,
    viewer: frame.viewer,
    hoveredId: frame.hoveredId,
    models: frame.models,
    buildingModels: frame.buildingModels,
    still: frame.still ?? false,
  };
  const { ctx, snapshot } = painter;
  painter.motion?.update(snapshot, painter.now);
  painter.animation?.update(snapshot, painter.now);
  if(!frame.reducedMotion && frame.pass!=='overlay')frame.wakes?.update(snapshot,painter.now);
  ctx.save();
  ctx.scale(zoom, zoom);
  if(frame.pass!=='overlay'){
  if (snapshot.map.terrain) {
    // A map with terrain is its own ground (see @@@terrain-art): the paper under it, no map id's linework.
    drawAtlasGround(ctx, painter.width, painter.height, painter.camera);
    drawTerrain(ctx, snapshot.map.terrain, painter.camera, painter.width, painter.height,
      frame.pass === 'ground' || painter.reducedMotion ? undefined : painter.now / 1000);
  } else {
    drawPaperMap(ctx, snapshot.map.id, painter.camera, painter.width, painter.height);
  }
  if(!frame.reducedMotion)frame.wakes?.draw(ctx,{...painter.camera,width:painter.width,height:painter.height},painter.now);
  drawLandmarks(painter, snapshot.map.landmarks);
  if (frame.story && frame.props) drawStoryProps(ctx, {...frame.story,props:frame.story.props.filter(prop=>!frame.actorPositions?.has(`prop:${prop.id}`))}, (point) => worldToScreen(painter, point), (point, pad) => nearScreen(painter, point, pad), frame.props, painter.now);
  drawResources(painter, snapshot.resources);
  drawMercenaryCamps(painter, snapshot.mercenaryCamps,false,frame.pass==='ground');
  if (snapshot.shops) drawShops(painter, snapshot.shops,false,frame.pass==='ground');
  drawObstacles(painter, snapshot.obstacles ?? []);
  drawItems(painter, snapshot.items);
  if (frame.story) drawStoryGround(ctx, frame.story, (point) => worldToScreen(painter, point), (point, pad) => nearScreen(painter, point, pad));
  // Persistent ground layer: weather to a faint sketch, never disappear.
  for(const corpse of snapshot.corpses ?? []){
    const point=worldToScreen(painter,corpse);
    if(!nearScreen(painter,point,90))continue;
    const age=Math.max(0,snapshot.tick-corpse.diedAtTick)/SIM_TICKS_PER_SECOND;
    ctx.save();ctx.globalAlpha*=.58-Math.min(1,age/8)*.18;
    let hash=0;for(const ch of corpse.id)hash=(Math.imul(hash,31)+ch.charCodeAt(0))>>>0;
    drawAtlasCorpse(ctx,corpse.kind,point,unitGlyphScale(corpse.radius),hash%6);ctx.restore();
  }
  }
  if(frame.pass==='ground'){ctx.restore();return;}
  if(frame.pass==='overlay'){drawMercenaryCamps(painter,snapshot.mercenaryCamps,true);if(snapshot.shops)drawShops(painter,snapshot.shops,true);}
  // Plans are a private overlay: they never enter target, visibility or pathing indexes.
  if (!painter.still && frame.viewer) for (const worker of snapshot.units) {
    if (worker.owner !== frame.viewer || worker.order.type !== "build") continue;
    const order = worker.order, point = worldToScreen(painter, order);
    if (!nearScreen(painter, point, 120)) continue;
    ctx.save(); ctx.globalAlpha = .24;
    drawAtlasBuilding(ctx, order.buildingKind, point, buildingGlyphSize(order.buildingKind), "#bca577");
    ctx.restore();
    if ((snapshot.players[frame.viewer]?.gold ?? 0) < BUILDING_DEFS[order.buildingKind].cost) {
      ctx.save(); ctx.fillStyle="#e1c28c"; ctx.font="12px sans-serif"; ctx.textAlign="center";
      ctx.fillText(frame.locale === "zh" ? "等待金币" : "Waiting for gold", point.x, point.y+40); ctx.restore();
    }
  }
  trackUnitFacing(painter.facing,painter.snapshot);
  // Sort feet, so a soldier behind a tall building is actually occluded by it.
  const actors=[...snapshot.buildings,...snapshot.units.filter(unit=>!unit.deck)].filter(a=>nearScreen(painter,worldToScreen(painter,a),Math.max(150,a.radius*3))).sort((a,b)=>a.y-b.y);
  if(frame.pass==='overlay'){drawBuildings(painter,snapshot.buildings,true);drawUnits(painter,snapshot.units,true);}
  else for(const actor of actors)if('order' in actor){if(shipProfile(actor))drawShipGroup(painter,actor);else drawUnits(painter,[actor]);}else drawBuildings(painter,[actor]);
  if (!painter.still && painter.viewer) drawAimLines(painter);
  // Carried objects belong in the inventory, not stacked over a unit's head.
  const unitsById = new Map(snapshot.units.map((unit) => [unit.id, unit]));
  renderWorldEffects({
    ctx,
    effects: snapshot.effects.filter(effect=>!frame.physicalEffects?.has(effect.type)),
    worldToScreen: (point) => worldToScreen(painter, point),
    nearScreen: (point, pad) => nearScreen(painter, point, pad),
    unitPosition: (id) => {
      const unit = unitsById.get(id);
      return unit ? drawnPosition(painter, unit) : undefined;
    },
  });
  ctx.restore();
  if (frame.story) {
    const storyPainter = {
      ctx,
      view: frame.story,
      locale: frame.locale ?? "zh",
      width: frame.view.width,
      height: frame.view.height,
      zoom,
      project: (point: Point) => {
        const at = worldToScreen(painter, point);
        return { x: at.x * zoom, y: at.y * zoom };
      },
      unitAt: (unitId: string) => {
        const unit = unitsById.get(unitId);
        return unit ? { ...drawnPosition(painter, unit), radius: unit.radius } : undefined;
      },
    };
    drawStoryAir(storyPainter);
    drawStoryScreen(storyPainter);
  }
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
  if (owner === "player") return "#477b91";
  if (owner === "fleet") return "#799199";
  if (owner === "crown") return "#a45c4b";
  if (owner === "enemy") return "#a85644";
  if (owner === "enemy2") return "#7f3a70";
  if (!owner || owner === "neutral") return "#704a33";
  const palette = ["#315f87", "#963c36", "#7f3a70", "#5d8b4c", "#b97927", "#596a8c", "#8d5a46", "#2f766f"];
  let hash = 0;
  for (const char of owner) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length]!;
}

export function buildingGlyphSize(kind: BuildingKind) {
  return Math.round(BUILDING_DEFS[kind].radius * 2.12);
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
    if (painter.still) continue;
    ctx.font = "600 11px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "#776443";
    ctx.fillText(Math.ceil(resource.amount).toLocaleString(), point.x, point.y + 45);
    ctx.textAlign = "start";
  }
}

function drawMercenaryCamps(painter: Painter, camps: MercenaryCamp[],overlayOnly=false,groundOnly=false) {
  const { ctx } = painter;
  for (const camp of camps) {
    const point = worldToScreen(painter, camp);
    if (!nearScreen(painter, point, 110)) continue;
    if (!groundOnly && (painter.selectedCampId === camp.id || painter.hoveredId === camp.id)) drawFoundationBoundary(painter,camp,"#96774a",painter.selectedCampId === camp.id);
    if(!overlayOnly && !painter.actorPositions?.has(camp.id))drawAtlasCamp(ctx, point);
    if(groundOnly)continue;
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillStyle = "#796644";
    ctx.textAlign = "center";
    ctx.fillText(painter.labels.mercenaryStock(camp.stock), point.x, point.y + 48);
    ctx.textAlign = "start";
    if (camp.cooldownRemaining > 0) drawProgress(ctx, point.x, point.y + 60, 1 - camp.cooldownRemaining / camp.cooldown);
  }
}

// Rocks and gates across their ways (see @@@obstacle-art), their health shown once they are struck.
function drawObstacles(painter: Painter, obstacles: Obstacle[]) {
  for (const obstacle of obstacles) {
    const shake = hitFeedbackOffset(painter.snapshot, obstacle);
    const point = worldToScreen(painter, { x: obstacle.x + shake.x, y: obstacle.y + shake.y });
    if (!nearScreen(painter, point, obstacle.radius + 80)) continue;
    drawAtlasObstacle(painter.ctx, obstacle, point);
    if (!painter.still && obstacle.hp < obstacle.maxHp) drawHp(painter.ctx, point.x, point.y - obstacleArtTop(obstacle) - 10, obstacle.hp, obstacle.maxHp);
  }
}

function drawShops(painter: Painter, shops: Shop[],overlayOnly=false,groundOnly=false) {
  const { ctx } = painter;
  for (const shop of shops) {
    const point = worldToScreen(painter, shop);
    if (!nearScreen(painter, point, 110)) continue;
    if (!groundOnly && (painter.selectedCampId === shop.id || painter.hoveredId === shop.id)) drawFoundationBoundary(painter,shop,"#96774a",painter.selectedCampId === shop.id);
    if(!overlayOnly && !painter.actorPositions?.has(shop.id))drawAtlasShop(ctx, point);
  }
}

function drawBuildings(painter: Painter, buildings: Building[],overlayOnly=false) {
  const { ctx } = painter;
  const engaged = engagedEntityIds(painter.snapshot);
  for (const building of buildings) {
    const shake = hitFeedbackOffset(painter.snapshot, building);
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
    if (selected || painter.hoveredId === building.id) drawFoundationBoundary(painter,building,ringInk(painter,building.owner),selected);
    ctx.save();
    ctx.globalAlpha = building.complete ? 1 : 0.48;
    if(!overlayOnly)drawAtlasBuilding(ctx, painter.buildingModels?.[building.id] ?? building.kind, point, size, ownerInk(building.owner));
    ctx.restore();
    if (showRally) drawBuildingRally(ctx, building, point, rallyPoint);
    if (shouldShowHealthBar({ hp: building.hp, maxHp: building.maxHp, selected, hovered: painter.hoveredId === building.id, engaged: engaged.has(building.id), constructing: !building.complete, still: painter.still })) drawHp(ctx, point.x, painter.actorPositions?.get(building.id)?.topY!==undefined?painter.actorPositions.get(building.id)!.topY-painter.camera.y-7:point.y - size * 0.78 - 5, building.hp, building.maxHp, 48);
    if (!building.complete) drawProgress(ctx, point.x, point.y + size * 0.6 + 10, building.buildProgress / building.buildTime);
    if (building.complete && building.queue[0]) {
      drawTrainingProgress(painter, point.x, point.y + size * 0.6 + 10, building.queue[0].remaining, building.queue[0].unitKind, building.queue.length);
    }
  }
}

/** Reticles are an owner-only overlay, including during multiplayer and allied shared vision. */
function drawAimLines(painter: Painter) {
  const { ctx } = painter;
  for (const unit of painter.snapshot.units) {
    const aim = unit.aim;
    if (unit.owner !== painter.viewer || !aim || !["attack", "attackMove", "hold", "aim", "cast"].includes(unit.order.type)) continue;
    const from = worldToScreen(painter, drawnPosition(painter, unit)), to = worldToScreen(painter, aim);
    if (!nearScreen(painter, from, 80) && !nearScreen(painter, to, 80)) continue;
    ctx.save();
    ctx.globalAlpha = painter.selectedIds.has(unit.id) ? .8 : .4;
    ctx.strokeStyle = aim.tracking ? "#c59b56" : "#72a98b";
    ctx.lineWidth = 1;
    ctx.setLineDash(aim.tracking ? [4, 4] : []);
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(to.x, to.y, 4, 0, Math.PI * 2);
    ctx.moveTo(to.x - 7, to.y); ctx.lineTo(to.x + 7, to.y);
    ctx.moveTo(to.x, to.y - 7); ctx.lineTo(to.x, to.y + 7); ctx.stroke();
    ctx.restore();
  }
}

function drawBuildingRally(ctx: Brush, building: Building, from: Point, to: Point) {
  ctx.save();
  const x = to.x, y = to.y;
  ctx.fillStyle = "#29272440";
  ctx.beginPath(); ctx.ellipse(x + 3, y + 3, 10, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#49413a"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y + 2); ctx.lineTo(x, y - 27); ctx.stroke();
  ctx.strokeStyle = "#d4c1a0"; ctx.lineWidth = .65;
  ctx.beginPath(); ctx.moveTo(x - .6, y); ctx.lineTo(x - .6, y - 27); ctx.stroke();
  ctx.fillStyle = ownerInk(building.owner);
  ctx.beginPath(); ctx.moveTo(x + 1, y - 26); ctx.lineTo(x + 17, y - 23);
  ctx.lineTo(x + 12, y - 18); ctx.lineTo(x + 17, y - 14); ctx.lineTo(x + 1, y - 17); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}

function drawShipGroup(painter:Painter,ship:Unit) {
  const point=worldToScreen(painter,drawnPosition(painter,ship));
  if(painter.motion && ship.sailing)ship={...ship,sailing:{...ship.sailing,heading:painter.motion.heading(ship,painter.now)}};
  drawCanvasShip(painter.ctx,ship,point,painter.snapshot.items);
  drawShipFlag(painter.ctx,ship,point,ownerInk(ship.owner));
  drawItems(painter,painter.snapshot.items,ship);
  for(const crew of shipPassengers(painter.snapshot.units,ship).sort((a,b)=>a.y-b.y))drawUnits(painter,[crew]);
  drawUnits(painter,[ship],true);
}

function drawUnits(painter: Painter, units: Unit[], overlayOnly=false) {
  const { ctx, now } = painter;
  const engaged = engagedEntityIds(painter.snapshot);
  for (const unit of units) {
    const shake = hitFeedbackOffset(painter.snapshot, unit);
    const anchor=painter.actorPositions?.get(unit.id);
    const at = anchor?{x:anchor.x,y:anchor.bodyY}:drawnPosition(painter, unit);
    const ship=unit.deck ? painter.snapshot.units.find(ship=>ship.id===unit.deck!.shipId) : undefined;
    const height=anchor?0:ship ? deckVisualHeight(ship)+18*unitGlyphScale(unit.radius)*(painter.models && !unit.variant ? .8 : 1) : 0;
    const point = worldToScreen(painter, { x: at.x + shake.x, y: at.y + shake.y-height });
    const scale = unitGlyphScale(unit.radius) * (painter.models && !unit.variant ? .8 : 1);
    if (!nearScreen(painter, point, Math.max(60, unit.radius * 3))) continue;
    const selected = painter.selectedIds.has(unit.id);
    ctx.strokeStyle = ownerInk(unit.owner);
    ctx.fillStyle = unit.owner === "neutral" ? "#f0d9bd" : "#fffbe7";
    ctx.lineWidth = selected ? 4 : 2;
    if (hasCarriedItem(painter.snapshot, unit, "flameCloak")) drawFlameCloakAura(ctx, point, now, unit.radius);
    if (selected || painter.hoveredId === unit.id) {
      ctx.save();
      ctx.strokeStyle = ringInk(painter, unit.owner);
      ctx.lineWidth = selected ? 3 : 2;
      ctx.beginPath();
      const profile=shipProfile(unit);
      if(profile){
        const heading=painter.motion?.heading(unit,now) ?? unit.sailing?.heading ?? unit.facing ?? 0;
        const hull={...unit,x:at.x,y:at.y,sailing:{heading,speed:0,load:0,balance:0}};
        profile.hull.forEach((vertex,index)=>{const p=worldToScreen(painter,localToWorld(hull,vertex));if(index===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);});
        ctx.closePath();
      } else {
        const feet=point.y+(creatureShadow(unit.kind)?.y??17)*scale;
        ctx.ellipse(point.x, feet, (unit.bodyRadius??unit.radius)+3, ((unit.bodyRadius??unit.radius)+3)*.55, 0, 0, Math.PI * 2);
      }
      ctx.stroke();
      ctx.restore();
    }
    const model = unit.variant !== undefined ? painter.models?.(unit.variant) : undefined;
    if (!overlayOnly && model) drawAtlasModel(ctx, unit.variant!, model, point, Math.max(0.72, unit.radius / 18), String(ctx.strokeStyle), painter.facing.facing(unit.id));
    else if(!overlayOnly) drawAtlasUnit(ctx, unit.kind, point, scale, String(ctx.strokeStyle), painter.facing.facing(unit.id), painter.reducedMotion || (painter.still && unitMover(unit.kind) === "sea") ? undefined : painter.animation?.frame(unit, now));
    if(unit.id==='tide-admiral'){
      ctx.fillStyle='#edd094';ctx.strokeStyle='#26373d';ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(point.x,point.y-65);ctx.lineTo(point.x+6,point.y-57);ctx.lineTo(point.x,point.y-49);ctx.lineTo(point.x-6,point.y-57);ctx.closePath();ctx.fill();ctx.stroke();
    }
    const scorch = unit.effects.find((effect) => effect.type === "scorch");
    if (scorch) drawScorchedUnitFlames(ctx, point, unit.radius, now, scorch.remaining);
    if (unit.kind === "worker" && unit.carryingGold > 0) drawCarriedGold(ctx, point.x, point.y);
    if (unit.level > 0) drawLevelStar(ctx, point.x + unit.radius + 5, point.y - unit.radius - 5, unit.level);
    if (shouldShowHealthBar({ hp: unit.hp, maxHp: unit.maxHp, shipHull: Boolean(shipProfile(unit)), selected, hovered: painter.hoveredId === unit.id, engaged: engaged.has(unit.id), still: painter.still })) drawHp(ctx, point.x, point.y - Math.max(unit.radius * 1.8 + 6, 64 * scale + 6), unit.hp, unit.maxHp);
    if (selected && painter.controlGroups) {
      const digits = Object.entries(painter.controlGroups).filter(([, ids]) => ids.includes(unit.id)).map(([digit]) => digit).join("·");
      if (digits) {
        ctx.save(); ctx.font = "11px sans-serif"; ctx.textAlign = "left";
        ctx.lineWidth=2; ctx.strokeStyle="#17201caa"; ctx.fillStyle="#fff";
        ctx.strokeText(digits,point.x+unit.radius*.7,point.y+unit.radius+10);
        ctx.fillText(digits,point.x+unit.radius*.7,point.y+unit.radius+10); ctx.restore();
      }
    }
  }
}

// Where a unit is drawn this frame: its snapshot spot, or on its glide when it charges (see unit-motion).
function drawnPosition(painter: Painter, unit: Unit): Point {
  if (unit.deck) {
    const ship = painter.snapshot.units.find(ship => ship.id === unit.deck!.shipId);
    if (ship) {
      const parent = painter.motion ? painter.motion.position(ship, painter.now) : ship;
      const heading = painter.motion?.heading(ship,painter.now) ?? ship.sailing?.heading ?? 0, c = Math.cos(heading), s = Math.sin(heading);
      return { x: parent.x + unit.deck.x*c-unit.deck.y*s, y: parent.y + unit.deck.x*s+unit.deck.y*c };
    }
  }
  return painter.motion ? painter.motion.position(unit, painter.now) : unit;
}

function hasCarriedItem(snapshot: GameSnapshot, unit: Unit, kind: WorldItem["kind"]) {
  return snapshot.items.some((item) => item.kind === kind && item.carrierId === unit.id && itemEquipped(snapshot,unit,item));
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

function drawItems(painter: Painter, items: WorldItem[], ship?: Unit) {
  for (const item of items) {
    if (item.carrierId || item.shipId) continue;
    if(ship ? item.deck?.shipId!==ship.id : item.deck)continue;
    const position=ship && item.deck ? localToWorld({...ship,...drawnPosition(painter,ship)},item.deck) : item;
    const point = worldToScreen(painter, position);
    if(ship)point.y-=deckVisualHeight(ship);
    if (!nearScreen(painter, point, 42)) continue;
    drawItemGlyph(painter.ctx, item, point, painter.now, false);
  }
}

// A ring's colour: friend or foe to the player looking on (see @@@relation-ink), or with no one looking, the owner's.
function ringInk(painter: Painter, owner: Owner) {
  return painter.viewer ? RELATION_INK[relationTo(painter.snapshot, painter.viewer, owner)] : ownerInk(owner);
}

function drawFoundationBoundary(painter:Painter,body:{x:number;y:number;radius:number},color:string,selected:boolean){
  const {ctx}=painter,square=footprintSquare(painter.snapshot,body,body.radius),point=worldToScreen(painter,body);
  ctx.save();ctx.strokeStyle=color;ctx.lineWidth=selected?2.5:1.5;
  if(square){
    const x=square.left*square.cell-painter.camera.x,y=square.top*square.cell-painter.camera.y;
    const w=(square.right-square.left+1)*square.cell,h=(square.bottom-square.top+1)*square.cell;
    ctx.strokeRect(x+1,y+1,w-2,h-2);
    if(selected){ctx.globalAlpha=.06;ctx.fillStyle=color;ctx.fillRect(x+1,y+1,w-2,h-2);}
  } else {ctx.beginPath();ctx.ellipse(point.x,point.y,body.radius+3,(body.radius+3)*.55,0,0,Math.PI*2);ctx.stroke();}
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

function drawItemGlyph(ctx: Brush, item: WorldItem, point: Point, _now: number, _carried: boolean) {
  drawPaintedItem(ctx, item.kind, point, 30, true);
}

function drawHp(ctx: Brush, x: number, y: number, hp: number, maxHp: number, width = 34) {
  const ratio = Math.max(0, Math.min(1, hp / Math.max(1, maxHp)));
  ctx.fillStyle = "#31483a";
  ctx.fillRect(x - width / 2 - 1, y - 1, width + 2, 5);
  ctx.fillStyle = healthBarColor(hp, maxHp);
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

// @@@hit-shake - A subtle, decaying contact response; strong hits cannot move
// a silhouette far enough to resemble pathing or a second attack animation.
const HIT_SHAKE = 7;
const MAX_HIT_SHAKE = 2;

function hitFeedbackOffset(snapshot: GameSnapshot, entity: Unit | Building | Obstacle): Point {
  const hit = snapshot.effects.find((effect) => effect.type === "hit" && effect.unitId === entity.id);
  if (!hit) return { x: 0, y: 0 };
  const amount = Math.min(MAX_HIT_SHAKE, (HIT_SHAKE * (hit.damage ?? 0)) / Math.max(1, entity.maxHp));
  const life = Math.max(0, Math.min(1, hit.remaining / hit.duration));
  const pulse = Math.sin((1-life) * Math.PI * 2) * amount * life * life;
  return { x: pulse, y: -pulse * 0.35 };
}

function worldToScreen(painter: Painter, point: Point): Point {
  return { x: point.x - painter.camera.x, y: point.y - painter.camera.y };
}

function nearScreen(painter: Painter, point: Point, pad: number) {
  return point.x >= -pad && point.y >= -pad && point.x <= painter.width + pad && point.y <= painter.height + pad;
}
