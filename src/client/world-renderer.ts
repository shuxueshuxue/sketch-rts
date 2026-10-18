import {bloodSurfaceResolver} from './combat-surfaces';
import {PresentationViewIndex} from './presentation-view';
import { deckRemainsByShip, deckRemainsPose, remainsOpacity, remainsVariant } from './deck-remains';
import type {ProjectileOriginTracker} from './projectile-origins';
import { projectActionFrame, projectPaperDirection } from './art/action-direction';
import { IDLE_FRAME } from './unit-animation';
import { drawCombatGround, drawCombatBody, drawCombatAir } from "./art/combat-effects";
import type { CombatPresentationTracker, CombatPresentationFrame } from "./combat-presentation";
import { appearanceFor, corpseAppearanceFor } from "./art/unit-appearance";
import { itemEquipped, itemsFor } from "../shared/equipment";
import { playerColor } from '../shared/player-colors';
import { drawCanvasShip,deckVisualHeight,drawShipFlag } from "./art/canvas-ships";
import { isInCabin } from '../shared/ship-cabin';
import { localToWorld,shipProfile,shareShipProfile,shipPassengers,SHIP_CAMERA } from "../shared/ship-geometry";
import { gangwaySurface, type GangwaySurface } from '../shared/ship-gangway';
import { gangwayCrewVisualPose } from './ship-gangway-visual';
import { healthBarColor, shouldShowHealthBar } from "./health-bars";
import { drawPaintedItem } from "./art/items";
import type { SiteModelKind } from "./art/building-models";
import { buildingSpriteSize, garrisonTower, towerRoofOpen, towerTopLift } from "./tower-presentation";
import { SIM_TICKS_PER_SECOND } from "../shared/time";
import { drawAtlasCorpse, drawAtlasBuilding, drawAtlasCamp, drawAtlasGround, drawAtlasLandmark, drawAtlasMine, drawAtlasModel, drawAtlasObstacle, drawAtlasShop, drawAtlasUnit, obstacleArtTop } from "./atlas-art";
import { renderWorldEffects } from "./effect-renderer";
import { drawScorchedUnitFlames } from "./art/canvas-effects";
import { battlefieldEffectFrame, drawUnitStatusEffects } from './ability-effects';
import { footprintCentre, footprintSquare } from "./footprint-view";
import { creatureShadow } from "./art/painted-creatures";
import { unitGlyphScale } from "./glyphs";
import type { createI18n } from "./i18n";
import { drawLevelStar } from "./level-star";
import { shouldRenderBuildingRally } from "./rally-visual";
import { RELATION_INK, relationTo } from "./relations";
import { drawTerrain } from "./terrain-art";
import { byFoot, drawStandingObject, standingTerrain, type StandingTerrainObject } from "./standing-terrain";
import { mineStage, paintRoads } from "./art/environment";
import { GOLD_MINE_RULES } from "../shared/mining";
import { generateTerrainLinework, type TextureStroke } from "./terrain-texture";
import { isAwaitingShipLaunch, trainingQueueCountText } from "./training-queue";
import type { UnitFacingTracker } from "./unit-facing";
import type { UnitMotionSmoother } from "./unit-motion";
import type { UnitAnimationTracker } from "./unit-animation";
import type { ShipWakeTracker } from './ship-wakes';
import { drawStoryAir, drawStoryGround, drawStoryProps, drawStoryScreen } from "./story-renderer";
import type { PropPainter, UnitModel } from "../story/cast";
import type { StageView } from "../story/stage";
import { BUILDING_DEFS, UNIT_DEFS, unitMover } from "../shared/catalog";
import type { Building, BuildingKind, GameSnapshot, MapId, MercenaryCamp, MercenaryUnitKind, Obstacle, Owner, PlayerId, ResourceNode, Shop, TerrainLandmark, TrainableUnitKind, Unit, WorldItem,WorldEffect } from "../shared/types";

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
  unitKind: (kind: TrainableUnitKind | MercenaryUnitKind) => string;
  awaitingShipLaunch?: () => string;
};

export function worldLabelsFor(i18n: ReturnType<typeof createI18n>): WorldLabels {
  return {
    unitKind: (kind) => i18n.label(kind),
    awaitingShipLaunch: () => i18n.t("canvas.shipAwaitingLaunch"),
  };
}

export type WorldFrame = {
  /** The building being placed, drawn by the 3D layer as its own see-through model (see @@@build-ghost). */
  buildGhost?: { kind: BuildingKind; x: number; y: number; valid: boolean };
  /** Shared snapshot index across the GPU, ground and annotation passes. */
  viewIndex?:PresentationViewIndex;
  /** Terrain and annotations flank the shared GPU depth layer. Recorder/fallback
   * callers omit this and retain the complete Canvas renderer. */
  pass?: 'ground' | 'overlay';
  actorPositions?: ReadonlyMap<string,{x:number;y:number;bodyY:number;topY:number;facing?:1|-1}>;
  physicalEffects?: ReadonlySet<WorldEffect['type']>;
  physicalCombat?:boolean;
  /** Successfully drawn GPU ground/deck markers own their depth, not the HUD canvas. */
  depthSelection?:boolean;
  /** Optional per-match pose history. Omit for static diagrams and portraits. */
  animation?: UnitAnimationTracker;
  combat?: CombatPresentationTracker;
  projectiles?:ProjectileOriginTracker;
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
  viewIndex:PresentationViewIndex;
  ships: ReadonlyMap<string, Unit>;
  gangways: ReadonlyMap<string, GangwaySurface>;
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
  engaged:ReadonlySet<string>;
  abilityEffects?:ReturnType<typeof battlefieldEffectFrame>;
  combatBody?:ReadonlyMap<string,CombatPresentationFrame["body"]>;
};

const NO_SELECTION: ReadonlySet<string> = new Set();
const canvasViewIndexes=new WeakMap<Brush,PresentationViewIndex>();

export function drawWorld(frame: WorldFrame) {
  const zoom = frame.view.zoom ?? 1;
  let viewIndex=frame.viewIndex??canvasViewIndexes.get(frame.ctx);
  if(!viewIndex){viewIndex=new PresentationViewIndex();canvasViewIndexes.set(frame.ctx,viewIndex);}
  const ships = new Map<string, Unit>(), gangways = new Map<string, GangwaySurface>();
  const painter: Painter = {
    viewIndex,
    ships,
    gangways,
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
    engaged:NO_SELECTION,
  };
  const { ctx, snapshot } = painter;
  painter.motion?.update(snapshot, painter.now);
  viewIndex.update(snapshot,painter.motion);
  // The GPU pass already supplies crew positions. The Canvas fallback owns
  // its bridge proof once per bridge and shares it with every crossing person.
  if (!frame.actorPositions) {
    for (const ship of snapshot.units) if (shipProfile(ship)) {
      const displayed = { ...ship, ...painter.motion?.position(ship, painter.now), sailing: { ...ship.sailing!, heading: painter.motion?.heading(ship, painter.now) ?? ship.sailing?.heading ?? 0 } };
      shareShipProfile(ship, displayed); ships.set(ship.id, displayed);
    }
    for (const source of ships.values()) {
      const target = source.sailing?.gangway && ships.get(source.sailing.gangway.targetId);
      const surface = target && gangwaySurface(source, target);
      if (surface) gangways.set(source.id, surface);
    }
  }
  painter.animation?.update(snapshot, painter.now, frame.story?.unitActions);
  if(!frame.reducedMotion && frame.pass!=='overlay')frame.wakes?.update(snapshot,painter.now);
  if(!frame.actorPositions){
    trackUnitFacing(painter.facing,painter.snapshot,viewIndex.entities);
    painter.animation?.observeDirections(painter.now,(id,direction)=>painter.facing.actionFacing(id,direction,projectPaperDirection),painter.reducedMotion);
  }
  if(!frame.physicalCombat)frame.combat?.update(snapshot,painter.now,bloodSurfaceResolver(snapshot,frame.animation,frame.facing,frame.models,frame.reducedMotion,frame.models?.8:1),areas=>viewIndex.queryBoundsUnion(areas));
  frame.projectiles?.update(snapshot,frame.models,id=>frame.facing.releaseFacing(id));
  const combat=frame.combat?.frame(painter.now);
  if(combat&&!frame.physicalCombat){
    const body=new Map<string,CombatPresentationFrame["body"]>();
    for(const mark of combat.body){const list=body.get(mark.unitId)??[];list.push(mark);body.set(mark.unitId,list);}
    painter.combatBody=body;
  }
  const combatProjection={worldToScreen:(point:Point)=>worldToScreen(painter,point),nearScreen:(point:Point,pad:number)=>nearScreen(painter,point,pad)};
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
  if(!frame.depthSelection)drawGroundSelectionMarkers(painter);
  if (frame.story && frame.props) drawStoryProps(ctx, {...frame.story,props:frame.story.props.filter(prop=>!frame.actorPositions?.has(`prop:${prop.id}`))}, (point) => worldToScreen(painter, point), (point, pad) => nearScreen(painter, point, pad), frame.props, painter.now);
  drawResources(painter, snapshot.resources);
  drawMercenaryCamps(painter, snapshot.mercenaryCamps,false,frame.pass==='ground');
  if (snapshot.shops) drawShops(painter, snapshot.shops,false,frame.pass==='ground');
  drawObstacles(painter, snapshot.obstacles ?? []);
  drawItems(painter, snapshot.items);
  if (frame.story) drawStoryGround(ctx, frame.story, (point) => worldToScreen(painter, point), (point, pad) => nearScreen(painter, point, pad));
  if(combat)drawCombatGround(ctx,combat,combatProjection);
  // Persistent ground layer: weather to a faint sketch, never disappear.
  for(const corpse of snapshot.corpses ?? []){
    if(corpse.deck)continue;
    const point=worldToScreen(painter,corpse);
    if(!nearScreen(painter,point,90))continue;
    ctx.save();ctx.globalAlpha*=remainsOpacity(snapshot.tick,corpse.diedAtTick);
    const model=corpse.variant ? frame.models?.(corpse.variant) : undefined;
    drawAtlasCorpse(ctx,corpse.kind,point,model ? Math.max(.72,corpse.radius/18) : unitGlyphScale(corpse.radius),remainsVariant(corpse.id),model,corpse.variant,ownerInk(corpse.owner,snapshot),corpseAppearanceFor(snapshot,corpse));ctx.restore();
  }
  }
  if(frame.pass==='ground'){ctx.restore();return;}
  painter.engaged=viewIndex.engagedIds();
  painter.abilityEffects=battlefieldEffectFrame(snapshot);
  if(frame.pass==='overlay'){drawMercenaryCamps(painter,snapshot.mercenaryCamps,true);if(snapshot.shops)drawShops(painter,snapshot.shops,true);}
  // Plans are a private overlay: they never enter target, visibility or pathing indexes.
  if (!painter.still && frame.viewer) for (const worker of viewIndex.builders) {
    if (isInCabin(worker) || worker.owner !== frame.viewer || worker.order.type !== "build") continue;
    const order = worker.order, point = worldToScreen(painter, order);
    if (!nearScreen(painter, point, 120)) continue;
    // Over the 3D world the plan is its model (see @@@build-ghost); this Canvas sprite is the fallback's.
    if (frame.pass !== 'overlay') { ctx.save(); ctx.globalAlpha = .24;
    drawAtlasBuilding(ctx, order.buildingKind, point, buildingGlyphSize(order.buildingKind), "#bca577");
    ctx.restore(); }
    if ((snapshot.players[frame.viewer]?.gold ?? 0) < BUILDING_DEFS[order.buildingKind].cost) {
      ctx.save(); ctx.fillStyle="#e1c28c"; ctx.font="12px sans-serif"; ctx.textAlign="center";
      ctx.fillText(frame.locale === "zh" ? "等待金币" : "Waiting for gold", point.x, point.y+40); ctx.restore();
    }
  }
  // Sort feet, so a soldier behind a tall building is actually occluded by it.
  if (frame.pass !== 'overlay') drawGangways(painter);
  const candidateUnits=viewIndex.query(frame.view);
  if(frame.pass==='overlay'){drawBuildings(painter,snapshot.buildings,true);drawUnits(painter,candidateUnits,true);}
  else {
    // A troop on a tower's top is drawn over its tower, front spots last (see @@@tower-garrison).
    const depth=(a:Unit|Building|StandingTerrainObject)=>{const tower='order' in a?garrisonTower(snapshot.buildings,a):undefined;return tower?tower.y+1+(a.y-tower.y+50)/100:a.y;};
    // The terrain's trees and boulders stand among them, in the same order by foot (see @@@standing-terrain).
    const standing=snapshot.map.terrain?standingTerrain(snapshot.map.terrain).filter(a=>nearScreen(painter,worldToScreen(painter,a),140*a.scale)):[];
    const actors:(Unit|Building|StandingTerrainObject)[]=[...snapshot.buildings,...candidateUnits.filter(unit=>!unit.deck)].filter(a=>nearScreen(painter,worldToScreen(painter,a),Math.max(150,a.radius*3)));
    actors.push(...standing);byFoot(actors,depth);
    for(const actor of actors)if('look' in actor)drawStandingObject(ctx,actor,worldToScreen(painter,actor));else if('order' in actor){if(shipProfile(actor))drawShipGroup(painter,actor);else drawUnits(painter,[actor]);}else drawBuildings(painter,[actor]);
  }
  if (!painter.still && painter.viewer) drawAimLines(painter);
  // Carried objects belong in the inventory, not stacked over a unit's head.
  const unitsById = viewIndex.units;
  if(combat&&!frame.physicalCombat)drawCombatGround(ctx,combat,combatProjection,true);
  if(combat&&!frame.physicalCombat)drawCombatAir(ctx,combat,combatProjection,(id,height,position)=>{
    const unit=unitsById.get(id);if(!unit||isInCabin(unit))return null;
    const anchor=painter.actorPositions?.get(id);
    const at=anchor?{x:anchor.x,y:anchor.bodyY}:drawnPosition(painter,unit);
    const ship=unit.deck?painter.ships.get(unit.deck.shipId):undefined;
    const model=unit.variant?painter.models?.(unit.variant):undefined;
    const floor=model?17*Math.max(.72,unit.radius/18):(creatureShadow(unit.kind)?.y??17)*unitGlyphScale(unit.radius);
    const lift=anchor||ship?0:towerTopLift(snapshot.buildings,unit);
    return worldToScreen(painter,{x:at.x+position.x-unit.x,y:at.y+position.y-unit.y+floor-(anchor?0:ship?deckVisualHeight(ship)+18*unitGlyphScale(unit.radius):lift?lift+18*unitGlyphScale(unit.radius):0)-height*Math.tan(SHIP_CAMERA.tilt)});
  },painter.reducedMotion);
  renderWorldEffects({
    ctx,
    players:snapshot.players,
    effects: snapshot.effects.filter(effect=>!frame.physicalEffects?.has(effect.type) && !(effect.unitId && unitsById.has(effect.unitId) && isInCabin(unitsById.get(effect.unitId)!))),
    worldToScreen: (point) => worldToScreen(painter, point),
    nearScreen: (point, pad) => nearScreen(painter, point, pad),
    viewer:painter.viewer,
    reducedMotion:painter.reducedMotion,
    combatTrails:Boolean(combat),
    projectileOrigin:effect=>frame.projectiles?.origin(effect,frame.physicalCombat?'gpu':'canvas'),
    unit:(id)=>unitsById.get(id),
    unitPosition: (id) => {
      const unit = unitsById.get(id);
      if(!unit || isInCabin(unit))return undefined;
      const anchor=painter.actorPositions?.get(id);
      if(anchor)return{x:anchor.x,y:anchor.bodyY};
      const at=drawnPosition(painter,unit),parent=unit.deck?painter.ships.get(unit.deck.shipId):undefined,lift=towerTopLift(snapshot.buildings,unit);
      return parent?{x:at.x,y:at.y-deckVisualHeight(parent)-18*unitGlyphScale(unit.radius)}:lift?{x:at.x,y:at.y-lift-18*unitGlyphScale(unit.radius)}:at;
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
        return unit && !isInCabin(unit) ? { ...drawnPosition(painter, unit), radius: unit.radius } : undefined;
      },
    };
    drawStoryAir(storyPainter);
    drawStoryScreen(storyPainter);
  }
}

/** Feeds the tracker every unit's facing for this snapshot; calling it twice for one snapshot changes nothing. */
export function trackUnitFacing(facing: UnitFacingTracker, snapshot: GameSnapshot,knownPositions?:ReadonlyMap<string,Point>) {
  let positions:Map<string,Point>|undefined;
  facing.updateSnapshot(snapshot,(id)=>{
    if(knownPositions)return knownPositions.get(id);
    if(!positions){positions=new Map();for(const entity of snapshot.units)positions.set(entity.id,entity);for(const entity of snapshot.buildings)positions.set(entity.id,entity);}
    return positions.get(id);
  });
}

export function drawPaperMap(ctx: Brush, mapId: MapId, camera: Point, width: number, height: number) {
  drawAtlasGround(ctx, width, height, camera);
  for (const stroke of generateTerrainLinework({ mapId, camera, width, height })) {
    drawTextureStroke(ctx, stroke);
  }
}

export function ownerInk(owner: Owner | undefined, snapshot?: Pick<GameSnapshot, 'players'>) { return playerColor(owner, snapshot); }

export function buildingGlyphSize(kind: BuildingKind) {
  return buildingSpriteSize(BUILDING_DEFS[kind]);
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
  paintRoads(painter.ctx, landmarks, (point) => worldToScreen(painter, point), { ...painter.camera, width: painter.width, height: painter.height });
  for (const landmark of landmarks) {
    const point = worldToScreen(painter, landmark);
    if (nearScreen(painter, point, landmark.size + 80)) drawAtlasLandmark(painter.ctx, landmark, point);
  }
}

function drawResources(painter: Painter, resources: ResourceNode[]) {
  const { ctx } = painter;
  for (const resource of resources) {
    const square = footprintSquare(painter.snapshot, resource, GOLD_MINE_RULES.radius);
    const point = worldToScreen(painter, square ? footprintCentre(square) : resource);
    if (!nearScreen(painter, point, 80)) continue;
    // The hill stands on its two-cell body (see @@@structure-body), its rocks a little past the edge; what is left in it
    // shows in the art (see @@@mine-stages).
    const size = square ? (square.right - square.left + 1) * square.cell * 1.1 / 84 : 1, stage = mineStage(resource);
    drawAtlasMine(ctx, point, stage, size);
    if (painter.still || stage === "collapsed") continue;
    ctx.font = "600 11px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "#776443";
    ctx.fillText(Math.ceil(resource.amount).toLocaleString(), point.x, point.y + 45 * size);
    ctx.textAlign = "start";
  }
}

function drawMercenaryCamps(painter: Painter, camps: MercenaryCamp[],overlayOnly=false,groundOnly=false) {
  const { ctx } = painter;
  for (const camp of camps) {
    const point = worldToScreen(painter, camp);
    if (!nearScreen(painter, point, 110)) continue;
    if(!overlayOnly && !painter.actorPositions?.has(camp.id))drawAtlasCamp(ctx, point);
    if(groundOnly)continue;
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillStyle = "#796644";
    ctx.textAlign = "center";
    // What the camp sells and how many are left (see @@@camp-text), under its footprint.
    const square = footprintSquare(painter.snapshot, camp, camp.radius);
    const below = square ? (square.bottom + 1) * square.cell - painter.camera.y + 13 : point.y + 48;
    ctx.fillText(`${painter.labels.unitKind(camp.hireKind)} ×${camp.stock}`, point.x, below);
    ctx.textAlign = "start";
    if (camp.cooldownRemaining > 0) drawProgress(ctx, point.x, below + 12, 1 - camp.cooldownRemaining / camp.cooldown);
  }
}

// Rocks and gates across their ways (see @@@obstacle-art), their health shown once they are struck.
function drawObstacles(painter: Painter, obstacles: Obstacle[]) {
  for (const obstacle of obstacles) {
    const shake = hitFeedbackOffset(painter.snapshot, obstacle,painter.viewIndex.hits);
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
    if(!overlayOnly && !painter.actorPositions?.has(shop.id))drawAtlasShop(ctx, point);
  }
}

function drawBuildings(painter: Painter, buildings: Building[],overlayOnly=false) {
  const { ctx } = painter;
  const engaged = painter.engaged;
  for (const building of buildings) {
    const shake = hitFeedbackOffset(painter.snapshot, building,painter.viewIndex.hits);
    const point = worldToScreen(painter, { x: building.x + shake.x, y: building.y + shake.y });
    const selected = painter.selectedIds.has(building.id);
    const trainable = BUILDING_DEFS[building.kind].trains.length > 0;
    const rallyPoint = worldToScreen(painter, { x: building.rallyX, y: building.rallyY });
    const showRally = shouldRenderBuildingRally({ selected, trainable, owner:building.owner, viewer:painter.viewer });
    if (!nearScreen(painter, point, 120)) {
      if (showRally) drawBuildingRally(ctx, building, point, rallyPoint, ownerInk(building.owner, painter.snapshot));
      continue;
    }
    ctx.strokeStyle = ownerInk(building.owner, painter.snapshot);
    ctx.fillStyle = building.complete ? "rgba(255, 250, 226, 0.72)" : "rgba(255, 250, 226, 0.42)";
    ctx.lineWidth = selected ? 4 : 2;
    const size = buildingSpriteSize(building);
    ctx.save();
    ctx.globalAlpha = building.complete ? 1 : 0.48;
    if(!overlayOnly)drawAtlasBuilding(ctx, painter.buildingModels?.[building.id] ?? building.kind, point, size, ownerInk(building.owner, painter.snapshot), towerRoofOpen(painter.snapshot.units, building));
    ctx.restore();
    if (showRally) drawBuildingRally(ctx, building, point, rallyPoint, ownerInk(building.owner, painter.snapshot));
    if (shouldShowHealthBar({ hp: building.hp, maxHp: building.maxHp, selected, hovered: painter.hoveredId === building.id, engaged: engaged.has(building.id), constructing: !building.complete, still: painter.still })) drawHp(ctx, point.x, painter.actorPositions?.get(building.id)?.topY!==undefined?painter.actorPositions.get(building.id)!.topY-painter.camera.y-7:point.y - size * 0.78 - 5, building.hp, building.maxHp, 48);
    if (!building.complete) drawProgress(ctx, point.x, point.y + size * 0.6 + 10, building.buildProgress / building.buildTime);
    if (building.complete && building.queue[0]) {
      drawTrainingProgress(painter, point.x, point.y + size * 0.6 + 10, building);
    }
  }
}

/** Reticles are an owner-only overlay, including during multiplayer and allied shared vision. */
function drawAimLines(painter: Painter) {
  const { ctx } = painter;
  for (const unit of painter.viewIndex.aiming) {
    const aim = unit.aim;
    if (isInCabin(unit) || unit.owner !== painter.viewer || !aim || !["attack", "attackMove", "hold", "aim", "cast"].includes(unit.order.type)) continue;
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

function drawBuildingRally(ctx: Brush, building: Building, from: Point, to: Point, color: string) {
  ctx.save();
  const x = to.x, y = to.y;
  ctx.fillStyle = "#29272440";
  ctx.beginPath(); ctx.ellipse(x + 3, y + 3, 10, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#49413a"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y + 2); ctx.lineTo(x, y - 27); ctx.stroke();
  ctx.strokeStyle = "#d4c1a0"; ctx.lineWidth = .65;
  ctx.beginPath(); ctx.moveTo(x - .6, y); ctx.lineTo(x - .6, y - 27); ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(x + 1, y - 26); ctx.lineTo(x + 17, y - 23);
  ctx.lineTo(x + 12, y - 18); ctx.lineTo(x + 17, y - 14); ctx.lineTo(x + 1, y - 17); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}

function drawShipGroup(painter:Painter,ship:Unit) {
  const point=worldToScreen(painter,drawnPosition(painter,ship));
  if(painter.motion && ship.sailing)ship={...ship,sailing:{...ship.sailing,heading:painter.motion.heading(ship,painter.now)}};
  const crew=shipPassengers(painter.snapshot.units,ship).sort((a,b)=>a.y-b.y);
  // All deck rings precede every passenger, so one person's marker cannot
  // cover a previously drawn neighbour. The deck itself remains underneath.
  drawCanvasShip(painter.ctx,ship,point,painter.snapshot.items,()=>{
    const at=drawnPosition(painter,ship);
    for(const corpse of deckRemainsByShip(painter.snapshot.corpses).get(ship.id) ?? []){
      const pose=deckRemainsPose(corpse,ship,{...at,heading:ship.sailing?.heading??0});
      if(!pose)continue;
      const center=worldToScreen(painter,{x:pose.x,y:pose.y-deckVisualHeight(ship)});
      const model=corpse.variant?painter.models?.(corpse.variant):undefined;
      painter.ctx.save();painter.ctx.translate(center.x,center.y);painter.ctx.rotate(pose.heading);
      painter.ctx.globalAlpha*=remainsOpacity(painter.snapshot.tick,corpse.diedAtTick);
      drawAtlasCorpse(painter.ctx,corpse.kind,{x:0,y:0},model?Math.max(.72,corpse.radius/18):unitGlyphScale(corpse.radius),remainsVariant(corpse.id),model,corpse.variant,ownerInk(corpse.owner,painter.snapshot),corpseAppearanceFor(painter.snapshot,corpse));
      painter.ctx.restore();
    }
    for(const passenger of crew)drawUnitSelectionMarker(painter,passenger);
  });
  drawShipFlag(painter.ctx,ship,point,ownerInk(ship.owner, painter.snapshot));
  drawItems(painter,painter.snapshot.items,ship);
  for(const passenger of crew)drawUnits(painter,[passenger]);
  drawUnits(painter,[ship],true);
}

function drawGangways(painter: Painter) {
  const { ctx } = painter;
  for (const [id, surface] of painter.gangways) {
    const source = painter.ships.get(id)!, target = painter.ships.get(source.sailing!.gangway!.targetId)!;
    const dx = surface.target.x - surface.source.x, dy = surface.target.y - surface.source.y, span2 = dx * dx + dy * dy;
    const project = (point: Point) => {
      const t = Math.max(0, Math.min(1, ((point.x - surface.source.x) * dx + (point.y - surface.source.y) * dy) / span2));
      const height = deckVisualHeight(source) + (deckVisualHeight(target) - deckVisualHeight(source)) * t;
      return worldToScreen(painter, { x: point.x, y: point.y - height });
    };
    const center = project({ x: (surface.source.x + surface.target.x) / 2, y: (surface.source.y + surface.target.y) / 2 });
    if (!nearScreen(painter, center, 100)) continue;
    ctx.save(); ctx.globalAlpha = surface.phase === 'deploying' ? .48 : 1;
    ctx.fillStyle = '#9b7550'; ctx.strokeStyle = '#4d3927'; ctx.lineWidth = 2;
    ctx.beginPath(); surface.polygon.forEach((point, index) => { const at = project(point); if (index) ctx.lineTo(at.x, at.y); else ctx.moveTo(at.x, at.y); });
    ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  }
}

function drawUnits(painter: Painter, units: readonly Unit[], overlayOnly=false) {
  const { ctx, now } = painter;
  const engaged = painter.engaged;
  for (const unit of units) {
    if (isInCabin(unit)) continue;
    const shake = hitFeedbackOffset(painter.snapshot, unit,painter.viewIndex.hits);
    const anchor=painter.actorPositions?.get(unit.id);
    const at = anchor?{x:anchor.x,y:anchor.bodyY}:drawnPosition(painter, unit);
    const ship=unit.deck ? painter.ships.get(unit.deck.shipId) : undefined;
    const bridge = !anchor && gangwayCrewVisualPose(unit, painter.ships, painter.gangways);
    const bodyHeight = 18*unitGlyphScale(unit.radius)*(painter.models && !unit.variant ? .8 : 1);
    const lift=anchor||bridge||ship?0:towerTopLift(painter.snapshot.buildings,unit);
    const height=anchor?0:bridge ? bridge.height * Math.tan(SHIP_CAMERA.tilt) + bodyHeight : ship ? deckVisualHeight(ship)+bodyHeight : lift ? lift+bodyHeight : 0;
    const point = worldToScreen(painter, { x: at.x + shake.x, y: at.y + shake.y-height });
    const scale = unitGlyphScale(unit.radius) * (painter.models && !unit.variant ? .8 : 1);
    if (!nearScreen(painter, point, Math.max(60, unit.radius * 3))) continue;
    const selected = painter.selectedIds.has(unit.id);
    ctx.strokeStyle = ownerInk(unit.owner, painter.snapshot);
    ctx.fillStyle = unit.owner === "neutral" ? "#f0d9bd" : "#fffbe7";
    ctx.lineWidth = selected ? 4 : 2;
    if (hasCarriedItem(painter.snapshot, unit, "flameCloak")) drawFlameCloakAura(ctx, point, now, unit.radius);
    const model = unit.variant !== undefined ? painter.models?.(unit.variant) : undefined;
    const blood=painter.combatBody?.get(unit.id);
    if(!overlayOnly||blood){
      const rawPose=painter.reducedMotion||(painter.still&&unitMover(unit.kind)==="sea")?IDLE_FRAME:painter.animation?.frame(unit,now)??IDLE_FRAME;
      const facing=painter.facing.actionFacing(unit.id,rawPose.direction??rawPose.carryDirection,projectPaperDirection);
      const pose=projectActionFrame(rawPose,facing);
      if (!overlayOnly && model) drawAtlasModel(ctx, unit.variant!, model, point, Math.max(0.72, unit.radius / 18), String(ctx.strokeStyle), facing, pose,appearanceFor(painter.snapshot,unit));
      else if(!overlayOnly) drawAtlasUnit(ctx, unit.kind, point, scale, String(ctx.strokeStyle), facing, pose, appearanceFor(painter.snapshot,unit));
      if(blood)drawCombatBody(ctx,blood,{x:point.x,y:point.y+(model?17*Math.max(.72,unit.radius/18):(creatureShadow(unit.kind)?.y??17)*scale)},anchor?.facing??facing);
    }
    if(unit.id==='tide-admiral'){
      ctx.fillStyle='#edd094';ctx.strokeStyle='#26373d';ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(point.x,point.y-65);ctx.lineTo(point.x+6,point.y-57);ctx.lineTo(point.x,point.y-49);ctx.lineTo(point.x-6,point.y-57);ctx.closePath();ctx.fill();ctx.stroke();
    }
    const scorch = painter.abilityEffects?.statuses.get(unit.id)?.find((effect) => effect.type === "scorch");
    if (scorch && scorch.remaining>0) drawScorchedUnitFlames(ctx, point, unit.radius, painter.reducedMotion?0:now, scorch.remaining);
    if(painter.abilityEffects)drawUnitStatusEffects(ctx,unit,painter.abilityEffects,point,
      {x:point.x,y:point.y+(creatureShadow(unit.kind)?.y??17)*scale},
      {x:point.x,y:anchor?anchor.topY-painter.camera.y+shake.y:point.y-64*scale},now,painter.reducedMotion,selected);
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
  const anchor = unit.gangway && painter.actorPositions?.get(unit.id);
  if (anchor) return anchor;
  const bridge = gangwayCrewVisualPose(unit, painter.ships, painter.gangways);
  if (bridge) return bridge;
  if (unit.deck) {
    const ship = painter.ships.get(unit.deck.shipId);
    if (ship) {
      const parent = painter.motion ? painter.motion.position(ship, painter.now) : ship;
      const heading = painter.motion?.heading(ship,painter.now) ?? ship.sailing?.heading ?? 0, c = Math.cos(heading), s = Math.sin(heading);
      return { x: parent.x + unit.deck.x*c-unit.deck.y*s, y: parent.y + unit.deck.x*s+unit.deck.y*c };
    }
  }
  return painter.motion ? painter.motion.position(unit, painter.now) : unit;
}

function hasCarriedItem(snapshot: GameSnapshot, unit: Unit, kind: WorldItem["kind"]) {
  return itemsFor(snapshot,unit).some((item) => item.kind === kind && itemEquipped(snapshot,unit,item));
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
  return painter.viewer ? RELATION_INK[relationTo(painter.snapshot, painter.viewer, owner)] : ownerInk(owner, painter.snapshot);
}

function drawGroundSelectionMarkers(painter:Painter) {
  for(const unit of painter.viewIndex.query({x:painter.camera.x,y:painter.camera.y,width:painter.width,height:painter.height}))if(!unit.deck)drawUnitSelectionMarker(painter,unit);
  for(const building of painter.snapshot.buildings) {
    const selected=painter.selectedIds.has(building.id);
    if((selected || painter.hoveredId===building.id) && nearScreen(painter,worldToScreen(painter,building),building.radius+80))
      drawFoundationBoundary(painter,building,ringInk(painter,building.owner),selected);
  }
  for(const site of [...painter.snapshot.mercenaryCamps,...(painter.snapshot.shops??[])]) {
    const selected=painter.selectedCampId===site.id;
    if((selected || painter.hoveredId===site.id) && nearScreen(painter,worldToScreen(painter,site),site.radius+80))
      drawFoundationBoundary(painter,site,'#96774a',selected);
  }
  for(const mine of painter.snapshot.resources)
    if(painter.hoveredId===mine.id && nearScreen(painter,worldToScreen(painter,mine),GOLD_MINE_RULES.radius+80))
      drawFoundationBoundary(painter,{x:mine.x,y:mine.y,radius:GOLD_MINE_RULES.radius},mineRingInk(mine),false);
}

/** A neutral site's ring, greyed once a mine is worked out (see @@@mine-stages). */
export function mineRingInk(mine:{amount:number;startAmount:number}){return mineStage(mine)==='collapsed'?'#8d8c86':'#96774a';}

function drawUnitSelectionMarker(painter:Painter,unit:Unit) {
  const selected=painter.selectedIds.has(unit.id);
  if(unit.hp<=0 || isInCabin(unit) || (!selected && painter.hoveredId!==unit.id))return;
  const {ctx}=painter,at=drawnPosition(painter,unit),profile=shipProfile(unit);
  const parent=unit.deck && painter.ships.get(unit.deck.shipId),bridge=gangwayCrewVisualPose(unit,painter.ships,painter.gangways);
  const scale=unitGlyphScale(unit.radius)*(painter.models && !unit.variant ? .8:1);
  const lift=bridge||parent?0:towerTopLift(painter.snapshot.buildings,unit);
  const height=bridge?bridge.height*Math.tan(SHIP_CAMERA.tilt):parent?deckVisualHeight(parent):lift;
  const point=worldToScreen(painter,{x:at.x,y:at.y-height});
  if(!nearScreen(painter,point,Math.max(60,unit.radius*3)))return;
  ctx.save();ctx.strokeStyle=ringInk(painter,unit.owner);ctx.lineWidth=selected?3:2;ctx.beginPath();
  if(profile) {
    const heading=painter.motion?.heading(unit,painter.now)??unit.sailing?.heading??unit.facing??0;
    const hull={...unit,x:at.x,y:at.y,sailing:{heading,speed:0,load:0,balance:0}};
    profile.hull.forEach((vertex,index)=>{const p=worldToScreen(painter,localToWorld(hull,vertex));if(index===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);});ctx.closePath();
  }else {
    // Land sprites use a body-origin; elevated crew use a feet-origin after
    // their deck/gangway lift. Keep both existing poses while changing layer.
    const bodyHeight=parent || bridge || lift?18*scale:0,feet=point.y-bodyHeight+(creatureShadow(unit.kind)?.y??17)*scale;
    const radius=(unit.bodyRadius??unit.radius)+3;ctx.ellipse(point.x,feet,radius,radius*.55,0,0,Math.PI*2);
  }
  ctx.stroke();ctx.restore();
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
  drawPaintedItem(ctx, item.kind, point, 30, true,item.weaponKind);
}

function drawHp(ctx: Brush, x: number, y: number, hp: number, maxHp: number, width = 34) {
  const ratio = Math.max(0, Math.min(1, hp / Math.max(1, maxHp)));
  ctx.fillStyle = "#31483a";
  ctx.fillRect(x - width / 2 - 1, y - 1, width + 2, 5);
  ctx.fillStyle = healthBarColor(hp, maxHp);
  ctx.fillRect(x - width / 2, y, width * ratio, 3);
}

function drawProgress(ctx: Brush, x: number, y: number, ratio: number, ink = "#315f87") {
  ctx.fillStyle = "rgba(35, 49, 38, 0.18)";
  ctx.fillRect(x - 28, y, 56, 5);
  ctx.fillStyle = ink;
  ctx.fillRect(x - 28, y, 56 * Math.max(0, Math.min(1, ratio)), 5);
}

function drawTrainingProgress(painter: Painter, x: number, y: number, building: Building) {
  const { ctx } = painter;
  const { remaining, unitKind } = building.queue[0]!;
  const total = UNIT_DEFS[unitKind].trainTime;
  const awaitingLaunch = isAwaitingShipLaunch(building);
  const ink = awaitingLaunch ? "#9a6a28" : "#315f87";
  drawProgress(ctx, x, y, 1 - remaining / total, ink);
  ctx.fillStyle = ink;
  ctx.font = "9px ui-monospace, monospace";
  const countText = trainingQueueCountText(building.queue.length);
  ctx.fillText(`${painter.labels.unitKind(unitKind)}${countText ? ` ${countText}` : ""}`, x - 27, y + 16);
  if (awaitingLaunch && painter.labels.awaitingShipLaunch) {
    const label = painter.labels.awaitingShipLaunch();
    ctx.save();
    ctx.font = "600 10px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const width = Math.ceil(ctx.measureText(label).width) + 8;
    ctx.fillStyle = "rgba(255, 250, 226, 0.94)";
    ctx.fillRect(x - 31, y + 20, width, 15);
    ctx.fillStyle = "#704a20";
    ctx.fillText(label, x - 27, y + 31);
    ctx.restore();
  }
}

// @@@hit-shake - A subtle, decaying contact response; strong hits cannot move
// a silhouette far enough to resemble pathing or a second attack animation.
const HIT_SHAKE = 7;
const MAX_HIT_SHAKE = 2;

function hitFeedbackOffset(snapshot: GameSnapshot, entity: Unit | Building | Obstacle,hits?:ReadonlyMap<string,WorldEffect>): Point {
  const hit = hits?hits.get(entity.id):snapshot.effects.find((effect) => effect.type === "hit" && effect.unitId === entity.id);
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
