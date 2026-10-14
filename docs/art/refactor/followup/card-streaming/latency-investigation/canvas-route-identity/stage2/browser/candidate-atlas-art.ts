import { animationKey, actionPaintSize } from './art/action-direction';
import { unitPaintKey } from './art/paint-identity';
import type { UnitModel } from "../story/cast";
import { appearanceKey, isCatalogPresentation } from "./art/unit-appearance";
import type { FigurePresentation } from "./art/rig";
import { paintMine } from "./art/environment";
import { drawModelPortrait } from './model-portraits';
import { drawFittedPortrait, clearFittedPortraits } from './art/portrait-fit';
import { isShipKind,shipProfile } from "../shared/ship-geometry";
import { unitMover } from "../shared/catalog";
import { paintCorpse, corpseAppearanceKey, type CorpsePresentation } from "./art/corpses";
import { paintBuildingModel, type SiteModelKind } from "./art/building-models";
import { paintFigure } from "./art/painted-units";
import { creatureShadow } from "./art/painted-creatures";
import { type Brush, type Point, ellipse, line, polygon } from "./art/kit";
import { createScratchCanvas } from "./art/scratch-canvas";
import { UNIT_CARDS } from "./content/units";
import type { BuildingKind, UnitKind, Unit } from "../shared/types";
import type { Facing } from "./unit-facing";
import { IDLE_FRAME, type UnitAnimationFrame } from "./unit-animation";
import { RasterCache } from "./art/raster-cache";

const sprites = new RasterCache();
export const canvasArtCacheStats = () => sprites.stats();
export const clearCanvasArtCache = () => {sprites.clear();clearFittedPortraits();};

/** Internally frozen catalog kits and empty stock presentations use proven
 * identities. Custom appearance and detail keep their original cache inputs. */
function catalogPaintKey(kind:UnitKind,color:string,pose:UnitAnimationFrame,presentation:FigurePresentation){
  return isCatalogPresentation(presentation)||(Object.getPrototypeOf(presentation)===Object.prototype&&Reflect.ownKeys(presentation).length===0)
    ?unitPaintKey(kind,color,pose):undefined;
}

function sprite(c: Brush, key: string, point: Point, scale: number, paint: (brush: Brush) => void, mirrored = false, tileSize=128) {
  const density = Math.max(2, Math.min(6, Math.ceil(scale * brushZoom(c) * 2)));
  const art = sprites.get(key, density, paint,tileSize);
  const width = art.canvas.width / density * scale, height = art.canvas.height / density * scale;
  if (!mirrored) {
    c.drawImage(art.canvas, point.x + art.x * scale, point.y + art.y * scale, width, height);
    return;
  }
  c.save(); c.translate(point.x, point.y); c.scale(-1, 1);
  c.drawImage(art.canvas, art.x * scale, art.y * scale, width, height);
  c.restore();
}

function brushZoom(c: Brush) {
  const transform = c.getTransform();
  return Math.hypot(transform.a, transform.b);
}

export function drawAtlasBuilding(c: Brush, kind: BuildingKind | SiteModelKind, point: Point, size: number, color: string) {
  sprite(c, `b:${kind}:${color}`, point, size / 64, (b) => {
    paintBuildingModel(b, kind, color);
  });
}

/** Architecture portraits use the same current model as the world. */
export function drawAtlasBuildingPortrait(c: Brush, kind: BuildingKind | SiteModelKind, size: number, color: string) {
  if(drawModelPortrait(c,`buildings/${kind}`,0,0,size,color))return;
  drawFittedPortrait(c,`building:${kind}:${color}`,b=>paintBuildingModel(b,kind,color),0,0,size,size);
}

/** Unit models face right; facing -1 draws the mirror image, facing left. */
export function drawAtlasUnit(c: Brush, kind: UnitKind, point: Point, scale: number, color: string, facing: Facing = 1, pose: UnitAnimationFrame = IDLE_FRAME, presentation: FigurePresentation = {}) {
    const shared=catalogPaintKey(kind,color,pose,presentation);
    const key=shared===undefined?`painted:${kind}:${color}:${facing}:${animationKey(pose)}:${appearanceKey(presentation)}`:`painted:${shared}:${facing}:${appearanceKey(presentation)}`;
    sprite(c, key, point, scale, (b) => {
      const mounted = UNIT_CARDS[kind].art.bearing === "mounted";
      const broad = mounted || UNIT_CARDS[kind].art.bearing !== "foot";
      const feet = creatureShadow(kind);
      if (unitMover(kind) !== "sea") {
        ellipse(b, 3, feet?.y ?? 18, feet ? feet.rx * 1.12 : broad ? 29 : 14, feet ? feet.ry * 1.2 : broad ? 6 : 4.5, "#29282418");
        ellipse(b, 1, feet?.y ?? 17, feet?.rx ?? (broad ? 24 : 10), feet?.ry ?? (broad ? 4.5 : 2.8), "#29282438");
      }
      paintFigure(b, kind, color, pose, facing, presentation);
    }, facing === -1, actionPaintSize(pose,kind));

}

/** One measured portrait source serves selection, training, queues and crew. */
export function drawAtlasUnitPortrait(c: Brush, kind: UnitKind, x: number, y: number, size: number, color: string, presentation: FigurePresentation = {}) {
  if(isShipKind(kind) && drawModelPortrait(c,`ships/${kind}`,x,y,size,color))return;
  const bust=UNIT_CARDS[kind].art.bearing==='foot';
  const shared=catalogPaintKey(kind,color,IDLE_FRAME,presentation);
  const key=shared===undefined?`portrait:${kind}:${color}:${appearanceKey(presentation)}`:`portrait:${shared}:${appearanceKey(presentation)}`;
  drawFittedPortrait(c,key,b=>{paintFigure(b,kind,color,IDLE_FRAME,1,presentation);},x,y,size,size,bust,actionPaintSize(IDLE_FRAME,kind));
}
export function drawAtlasUnitFigure(c:Brush,kind:UnitKind,width:number,height:number,color:string,presentation:FigurePresentation={}){
  const shared=catalogPaintKey(kind,color,IDLE_FRAME,presentation);
  const key=shared===undefined?`figure:${kind}:${color}:${appearanceKey(presentation)}`:`figure:${shared}:${appearanceKey(presentation)}`;
  drawFittedPortrait(c,key,b=>{paintFigure(b,kind,color,IDLE_FRAME,1,presentation);},0,0,width,height,false,actionPaintSize(IDLE_FRAME,kind));
}

/** A campaign unit's own model (see story/cast), cached like the catalog's units, per model and team colour. */
export function drawAtlasModel(c: Brush, key: string, model: UnitModel, point: Point, scale: number, color: string, facing: Facing = 1, pose: UnitAnimationFrame = IDLE_FRAME,presentation:FigurePresentation={}) {
  sprite(c, `m:${key}:${color}:${facing}:${animationKey(pose)}:${appearanceKey(presentation)}`, point, scale, (b) => {
    const shadow = model.shadow ?? "foot";
    if (shadow === "foot") ellipse(b, 2, 16, 17, 6, "#30483630");
    else if (shadow === "mounted") ellipse(b, 2, 17, 22, 5.5, "#30483630");
    else if (shadow === "beast") ellipse(b, 2, 15, 20, 5, "#30483630");
    else if (shadow === "huge") ellipse(b, 2, 18, 30, 8, "#30483638");
    model.paint(b, color, pose, facing,presentation);
  }, facing === -1, model.paint.paintSize?.(pose)??actionPaintSize(pose));
}

/** A piece of a story's scenery (see story/stage props), cached per kind and state like the units. */
export function drawAtlasProp(c: Brush, key: string, paint: (b: Brush) => void, point: Point, scale: number, flip = false) {
  sprite(c, `p:${key}`, point, scale, paint, flip);
}

export { paintTree as drawAtlasTree, paintLandmark as drawAtlasLandmark, paintObstacle as drawAtlasObstacle, obstacleArtTop } from "./art/environment";

export function drawAtlasMine(c: Brush, point: Point) {
  sprite(c, "gold-mine", point, 1, paintMine);
}

export function drawAtlasCamp(c: Brush, point: Point, size = 1) {
  sprite(c, "mercenary-camp", point, size, b => paintBuildingModel(b, "camp", "#8b7355"));
}

/** Neutral trading house: slate roof, linen awning, wares and hanging brass sign. */
export function drawAtlasShop(c: Brush, point: Point, size = 1) {
  sprite(c, "shop", point, size, b => paintBuildingModel(b, "shop", "#8b7355"));
}

/** The paper's own colour, under the washes and specks of the ground tile. */
export const PAPER_BASE = "#ddd5bb";

let groundTile: HTMLCanvasElement | undefined;
export function drawAtlasGround(c: Brush, width: number, height: number, camera: Point) {
  if (!groundTile) {
    groundTile = createScratchCanvas(512, 512);
    const b = groundTile.getContext("2d")!;
    b.fillStyle = PAPER_BASE; b.fillRect(0, 0, 512, 512);
    let seed = 19027;
    const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
    for (let i = 0; i < 7000; i++) { b.fillStyle = i % 2 ? "#7f8b6805" : "#fff8e720"; b.fillRect(random() * 512, random() * 512, 1, 1); }
    for (let i = 0; i < 42; i++) {
      const x = 8 + random() * 496, y = 8 + random() * 496;
      line(b, [[x - 3, y], [x - 4, y - 3], [x, y + 1], [x + 1, y - 4]], "#7c8d671c", 0.8);
    }
  }
  const offsetX = ((-camera.x % 512) + 512) % 512 - 512;
  const offsetY = ((-camera.y % 512) + 512) % 512 - 512;
  for (let x = offsetX; x < width; x += 512) for (let y = offsetY; y < height; y += 512) c.drawImage(groundTile, x, y, 512.35, 512.35);
}

/** Remains use authored low silhouettes, including campaign-specific anatomy. */
export function drawAtlasCorpse(c:Brush,kind:UnitKind,point:Point,scale:number,variant=0,model?:UnitModel,modelKey='',color='#77766e',presentation:Readonly<CorpsePresentation>={}){
  c.save();c.translate(point.x,point.y+7);c.rotate((variant%3-1)*.14);
  sprite(c,`corpse:${kind}:${modelKey}:${color}:${corpseAppearanceKey(presentation)}`,{x:0,y:0},scale, b=>model?.remains ? model.remains(b,color,presentation) : paintCorpse(b,kind,presentation),variant%2===1);
  c.restore();
}
