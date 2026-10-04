import { paintCorpse } from "./art/corpses";
import { paintBuildingModel, type SiteModelKind } from "./art/building-models";
import { hasPaintedUnit, paintFigure } from "./art/painted-units";
import { type Brush, type Point, ellipse, flag, line, polygon } from "./art/kit";
import { createScratchCanvas } from "./art/scratch-canvas";
import { UNIT_CARDS } from "./content/units";
import type { BuildingKind, Obstacle, TerrainLandmark, UnitKind } from "../shared/types";
import type { Facing } from "./unit-facing";
import { IDLE_FRAME, type UnitAnimationFrame } from "./unit-animation";
import { withUnitPose } from "./art/pose";

const sprites = new Map<string, HTMLCanvasElement>();
const MAX_SPRITES = 256;
// Posed frames share the cache. Bound pixels too: count alone does not bound
// memory when a recorder asks for high-density sprites (RGBA, about 48 MiB).
const MAX_SPRITE_PIXELS = 12 * 1024 * 1024;
let spritePixels = 0;

// Cache at a resolution suited to the drawing size, including the enlarged
// title illustration. Team colors and marks keep faction variants distinct.
// A mirrored draw flips the cached image about the sprite's own vertical axis.
// The resolution follows the brush's own zoom too, so a zoomed-in view (the recorder's camera) stays crisp.
function sprite(c: Brush, key: string, point: Point, scale: number, paint: (brush: Brush) => void, mirrored = false) {
  const density = Math.max(2, Math.min(6, Math.ceil(scale * brushZoom(c) * 2)));
  const cacheKey = `${key}:${density}`;
  let source = sprites.get(cacheKey);
  if (!source) {
    source = createScratchCanvas(128 * density, 128 * density);
    const brush = source.getContext("2d")!;
    brush.scale(density, density);
    brush.translate(64, 64);
    brush.lineJoin = brush.lineCap = "round";
    paint(brush);
    while (sprites.size && (sprites.size >= MAX_SPRITES || spritePixels + source.width * source.height > MAX_SPRITE_PIXELS)) {
      const oldest = sprites.keys().next().value!;
      const evicted = sprites.get(oldest)!;
      spritePixels -= evicted.width * evicted.height;
      sprites.delete(oldest);
    }
    sprites.set(cacheKey, source);
    spritePixels += source.width * source.height;
  } else {
    // Keep frequently reused troop frames ahead of old zoom levels and colors.
    sprites.delete(cacheKey);
    sprites.set(cacheKey, source);
  }
  if (!mirrored) {
    c.drawImage(source, point.x - 64 * scale, point.y - 64 * scale, 128 * scale, 128 * scale);
    return;
  }
  c.save();
  c.translate(point.x, point.y);
  c.scale(-1, 1);
  c.drawImage(source, -64 * scale, -64 * scale, 128 * scale, 128 * scale);
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

/** Unit models face right; facing -1 draws the mirror image, facing left. */
export function drawAtlasUnit(c: Brush, kind: UnitKind, point: Point, scale: number, color: string, facing: Facing = 1, pose: UnitAnimationFrame = IDLE_FRAME) {
  if (hasPaintedUnit(kind)) {
    sprite(c, `painted:${kind}:${color}:${facing}:${pose.mode}:${pose.frame}`, point, scale, (b) => {
      const mounted = UNIT_CARDS[kind].art.bearing === "mounted";
      const broad = mounted || UNIT_CARDS[kind].art.bearing !== "foot";
      if (kind !== "transport" && kind !== "warship") {
        ellipse(b, 3, 18, broad ? 29 : 14, broad ? 6 : 4.5, "#29282418");
        ellipse(b, 1, 17, broad ? 24 : 10, broad ? 4.5 : 2.8, "#29282438");
      }
      paintFigure(b, kind, color, pose, facing);
    }, facing === -1);
    return;
  }
  sprite(c, `u:${kind}:${color}:${pose.mode}:${pose.frame}`, point, scale, (b) => {
    const card = UNIT_CARDS[kind];
    if (card.art.bearing === "foot" && kind !== "wildling") ellipse(b, 2, 16, 17, 6, "#30483630");
    else if (kind === "wildling" || kind === "mossGnawer" || kind === "spirit") ellipse(b, 2, 15, 14, 5, "#30483630");
    withUnitPose(b, pose, () => card.paint(b, color));
  }, facing === -1);
}

/** A close portrait shares the actual model, but gives faces and equipment the
 * space that a full-body thumbnail cannot. Mounted units and beasts keep their
 * silhouette. Coordinates and clipping stay local to the requested rectangle. */
export function drawAtlasUnitPortrait(c: Brush, kind: UnitKind, x: number, y: number, size: number, color: string) {
  const { bearing } = UNIT_CARDS[kind].art;
  const foot = bearing === "foot";
  const painted = hasPaintedUnit(kind);
  // Busts use head/shoulder space; cavalry retains enough mount to read its role.
  const extent = foot ? (painted ? 40 : 48) : bearing === "mounted" ? 86 : kind === "redDragon" ? 112 : 94;
  const scale = size / extent;
  c.save();
  c.beginPath(); c.rect(x, y, size, size); c.clip();
  const wash = c.createLinearGradient(x, y, x + size, y + size);
  wash.addColorStop(0, "#555956"); wash.addColorStop(.55, "#343b3d"); wash.addColorStop(1, "#20272b");
  c.fillStyle = wash; c.fillRect(x, y, size, size);
  const anchorY = foot ? (painted ? 49 : 36) * scale : (bearing === "mounted" ? 61 : 60) * scale;
  drawAtlasUnit(c, kind, { x: x + size * .5, y: y + anchorY }, scale, color);

  c.restore();
}

/** A campaign unit's own model (see story/cast), cached like the catalog's units, per model and team colour. */
export function drawAtlasModel(c: Brush, key: string, model: { paint: (b: Brush, team: string) => void; shadow?: "foot" | "mounted" | "beast" | "huge" | "none" }, point: Point, scale: number, color: string, facing: Facing = 1) {
  sprite(c, `m:${key}:${color}`, point, scale, (b) => {
    const shadow = model.shadow ?? "foot";
    if (shadow === "foot") ellipse(b, 2, 16, 17, 6, "#30483630");
    else if (shadow === "mounted") ellipse(b, 2, 17, 22, 5.5, "#30483630");
    else if (shadow === "beast") ellipse(b, 2, 15, 20, 5, "#30483630");
    else if (shadow === "huge") ellipse(b, 2, 18, 30, 8, "#30483638");
    model.paint(b, color);
  }, facing === -1);
}

/** A piece of a story's scenery (see story/stage props), cached per kind and state like the units. */
export function drawAtlasProp(c: Brush, key: string, paint: (b: Brush) => void, point: Point, scale: number, flip = false) {
  sprite(c, `p:${key}`, point, scale, paint, flip);
}

/** One tree of the atlas, its foot at (x, y). */
export function drawAtlasTree(c: Brush, x: number, y: number, size: number, tone = 0) {
  tree(c, x, y, size, tone);
}

function tree(c: Brush, x: number, y: number, size: number, tone = 0) {
  c.save(); c.translate(x, y); c.scale(size, size);
  const shade = tone % 3;
  const dark = ["#394940", "#424d40", "#3b4947"][shade < 0 ? 0 : shade]!;
  polygon(c, [[-8,3],[6,-2],[23,7],[12,10]], "#29372d20", "transparent", 0);
  line(c, [[0,5],[-1,-53]], "#625a44", 2.7);
  line(c, [[-1,3],[-1,-47]], "#a19068", .65);
  for (let tier=5;tier>=0;tier--) {
    const y=-59+tier*9, span=3+tier*4.6;
    const sway=Math.sin(tone*2.1+tier)*1.5;
    polygon(c, [[sway,y-10],[-span*.38,y-1],[-span*.75,y+1],[-span*.55,y+2],[-span,y+5],[-span*.62,y+5],[-span*.91,y+8],[-span*.25,y+6],[sway,y+8],[span*.43,y+6],[span,y+7],[span*.75,y+3],[span*.95,y+4],[span*.45,y-1]], dark, "#2d3b342b", .5);
    polygon(c, [[sway,y-8],[-span*.33,y],[-span*.62,y+2],[-span*.44,y+3],[-span*.82,y+5],[-span*.27,y+4],[sway+1,y+6],[sway-1,y]], tier%2?"#6c7557":"#77806a", "transparent",0);
    line(c, [[-span*.5,y+3],[-span*.22,y+2],[sway,y-2]], "#a5a27a55", .65);
    line(c, [[span*.25,y+3],[span*.68,y+5]], "#88907855", .6);
  }
  c.restore();
}

export function drawAtlasLandmark(c: Brush, landmark: TerrainLandmark, point: Point) {
  c.save(); c.translate(point.x, point.y);
  c.lineCap = c.lineJoin = "round";
  const size = landmark.size;
  if (landmark.kind === "grove") {
    ellipse(c, 0, 0, size * 0.46, size * 0.26, "#78966b14");
    for (let i = 0; i < 11; i++) {
      const a = i * 2.4 + landmark.rotation;
      const r = Math.sqrt((i + 1) / 11);
      tree(c, Math.cos(a) * size * 0.32 * r, -size * 0.17 + i * size * 0.032, 0.65 + (i % 3) * 0.15, i);
    }
  } else if (landmark.kind === "ridge") {
    for (let i = 0; i < 5; i++) {
      const x = (i - 2) * size * 0.17; const y = Math.sin(i * 2.7) * 15;
      polygon(c, [[x - 28, y + 13], [x - 10, y - 18], [x + 7, y - 27], [x + 32, y + 9], [x + 10, y + 20]], "#a5ad91", "#88967d", 1);
      polygon(c, [[x - 28, y + 13], [x + 7, y - 27], [x + 1, y + 9]], "#c7c9ab", "transparent", 0);
      line(c, [[x + 7, y - 24], [x + 12, y - 4], [x + 26, y + 8]], "#7e8f78", 1);
    }
  } else if (landmark.kind === "ruin") {
    ellipse(c, 0, 9, size * 0.3, size * 0.13, "#7a8b6820");
    for (let i = 0; i < 4; i++) {
      const x = (i - 1.5) * 20, y = (i % 2) * 18, h = 16 + (i % 3) * 9;
      polygon(c, [[x, y], [x, y - h], [x + 11, y - h - 4], [x + 19, y - h], [x + 19, y], [x + 10, y + 5]], "#b3b69a", "#7f8c74");
      polygon(c, [[x, y - h], [x + 10, y - h + 4], [x + 10, y + 5], [x, y]], "#d4d0b0", "#8f9c7f", 0.5);
    }
  } else if (landmark.kind === "road" || landmark.kind === "ditch") {
    c.rotate(landmark.rotation);
    const river = landmark.kind === "ditch";
    c.beginPath(); c.moveTo(-size / 2, 0);
    c.bezierCurveTo(-size / 4, river ? 42 : -20, size / 4, river ? -42 : -20, size / 2, 0);
    c.lineWidth = river ? 17 : 13; c.strokeStyle = river ? "#799c912c" : "#ac99772a"; c.stroke();
    c.lineWidth = river ? 9 : 7; c.strokeStyle = river ? "#7caca169" : "#d0be9970"; c.stroke();
    c.lineWidth = 1; c.strokeStyle = river ? "#e0e4c9a6" : "#a7967433"; c.stroke();
  } else if (landmark.kind === "mineScar") {
    for (let i = 0; i < 6; i++) { const x = (i - 2.5) * 14; polygon(c, [[x, 8], [x + 5, -8 - (i % 3) * 5], [x + 12, 5]], "#c3b78c", "#a79f7d", 0.7); }
  } else if (isDecor(landmark.kind)) {
    drawDecor(c, landmark.kind, size, landmark.rotation);
  } else {
    // Camp markers remain subtle so they cannot be mistaken for live entities.
    ellipse(c, 0, 0, size * 0.26, size * 0.12, "#a18b5c12", "#9d987d55");
    line(c, [[-9, 4], [0, -9], [9, 4]], "#8b8b6c66", 1);
  }
  c.restore();
}

// @@@decor-art - The small scenery a generated map is dressed in (see @@@generated-decor), each sized to its landmark's
// size and turned by its rotation where it has a way to face; drawn faint enough that nothing reads as a unit.
type DecorKind = "flowers" | "bush" | "stump" | "log" | "mushrooms" | "pebbles" | "bones" | "reeds" | "lilies" | "wreck" | "campfire" | "signpost" | "pillar";
const DECOR_KINDS: readonly string[] = ["flowers", "bush", "stump", "log", "mushrooms", "pebbles", "bones", "reeds", "lilies", "wreck", "campfire", "signpost", "pillar"];

function isDecor(kind: TerrainLandmark["kind"]): kind is DecorKind {
  return DECOR_KINDS.includes(kind);
}

function drawDecor(c: Brush, kind: DecorKind, size: number, rotation: number) {
  const s = size;
  // A fixed spread of a few points round the middle, the same every frame.
  const spot = (i: number, reach: number) => [Math.cos(i * 2.4 + rotation) * s * reach * Math.sqrt((i + 1) / 7), Math.sin(i * 2.4 + rotation) * s * reach * 0.6 * Math.sqrt((i + 1) / 7)] as const;
  if (kind === "flowers") {
    for (let i = 0; i < 7; i++) {
      const [x, y] = spot(i, 0.42);
      line(c, [[x, y + s * 0.06], [x, y]], "#6f8a5a", 1);
      ellipse(c, x, y, s * 0.05, s * 0.04, ["#e8a6b4", "#f2d27a", "#f4f0e2", "#c9a6e0"][i % 4]!, "#9a8a6a80");
    }
  } else if (kind === "bush") {
    for (let i = 0; i < 3; i++) ellipse(c, (i - 1) * s * 0.16, -Math.abs(i - 1) * s * 0.04 - s * 0.06, s * 0.17, s * 0.13, i === 1 ? "#6f8f62" : "#5f7f55", "#4c6a45");
  } else if (kind === "stump") {
    polygon(c, [[-s * 0.13, 0], [-s * 0.12, -s * 0.12], [s * 0.12, -s * 0.12], [s * 0.13, 0]], "#8a6a46", "#5e4630", 1);
    ellipse(c, 0, -s * 0.12, s * 0.12, s * 0.055, "#c9a878", "#5e4630");
    ellipse(c, 0, -s * 0.12, s * 0.05, s * 0.022, "transparent", "#8a6a4680");
  } else if (kind === "log") {
    c.rotate(rotation);
    polygon(c, [[-s * 0.32, -s * 0.06], [s * 0.3, -s * 0.07], [s * 0.3, s * 0.06], [-s * 0.32, s * 0.07]], "#8a6a46", "#5e4630", 1);
    ellipse(c, s * 0.3, 0, s * 0.045, s * 0.065, "#c9a878", "#5e4630");
    line(c, [[-s * 0.2, -s * 0.02], [s * 0.15, -s * 0.03]], "#5e463080", 1);
  } else if (kind === "mushrooms") {
    for (let i = 0; i < 4; i++) {
      const [x, y] = spot(i, 0.25);
      line(c, [[x, y], [x, y - s * 0.07]], "#efe6cf", 2);
      polygon(c, [[x - s * 0.06, y - s * 0.06], [x, y - s * 0.12], [x + s * 0.06, y - s * 0.06]], i % 2 ? "#b8573f" : "#9b7a4c", "#5e3a2a", 0.8);
    }
  } else if (kind === "pebbles") {
    for (let i = 0; i < 6; i++) {
      const [x, y] = spot(i, 0.36);
      ellipse(c, x, y, s * (0.035 + (i % 3) * 0.015), s * (0.025 + (i % 2) * 0.01), i % 2 ? "#b9b6a0" : "#a3a08b", "#7d7a6680");
    }
  } else if (kind === "bones") {
    c.rotate(rotation);
    for (const turn of [0.5, -0.5]) {
      const dx = Math.cos(turn) * s * 0.18;
      const dy = Math.sin(turn) * s * 0.18;
      line(c, [[-dx, -dy], [dx, dy]], "#ece5cf", 3);
      for (const end of [-1, 1]) ellipse(c, end * dx, end * dy, s * 0.03, s * 0.03, "#ece5cf", "#a49c84");
    }
  } else if (kind === "reeds") {
    for (let i = 0; i < 8; i++) {
      const x = (i - 3.5) * s * 0.06 + Math.sin(i * 3.1) * s * 0.02;
      const h = s * (0.18 + (i % 3) * 0.06);
      line(c, [[x, 0], [x + Math.sin(i + rotation) * s * 0.03, -h]], "#6f8a5a", 1.2);
      if (i % 3 === 0) ellipse(c, x + Math.sin(i + rotation) * s * 0.03, -h, s * 0.015, s * 0.04, "#7a5a3a");
    }
  } else if (kind === "lilies") {
    for (let i = 0; i < 4; i++) {
      const [x, y] = spot(i, 0.35);
      polygon(c, [[x, y], [x + s * 0.07, y - s * 0.02], [x + s * 0.05, y + s * 0.04], [x - s * 0.05, y + s * 0.04], [x - s * 0.07, y - s * 0.02]], "#7fa36a", "#5f7f55", 0.6);
    }
    ellipse(c, 0, -s * 0.01, s * 0.03, s * 0.025, "#f0b8c8", "#c08a9a");
  } else if (kind === "wreck") {
    c.rotate(rotation);
    polygon(c, [[-s * 0.32, -s * 0.02], [-s * 0.18, s * 0.09], [s * 0.24, s * 0.08], [s * 0.34, -s * 0.05], [s * 0.1, -s * 0.02], [-s * 0.05, -s * 0.09]], "#7d5c3c", "#4f3a26", 1);
    for (const x of [-0.15, 0, 0.15]) line(c, [[x * s, -s * 0.06], [x * s + s * 0.02, s * 0.07]], "#4f3a2690", 1);
    line(c, [[s * 0.02, -s * 0.04], [-s * 0.08, -s * 0.3]], "#5e4630", 2);
  } else if (kind === "campfire") {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      ellipse(c, Math.cos(a) * s * 0.1, Math.sin(a) * s * 0.06, s * 0.03, s * 0.022, "#a3a08b", "#6f6c5a");
    }
    polygon(c, [[-s * 0.05, 0], [-s * 0.02, -s * 0.12], [0, -s * 0.06], [s * 0.025, -s * 0.15], [s * 0.05, 0]], "#e8873a", "#b4562a", 0.8);
    polygon(c, [[-s * 0.02, 0], [0, -s * 0.07], [s * 0.02, 0]], "#f6d36a", "transparent", 0);
  } else if (kind === "signpost") {
    line(c, [[0, 0], [0, -s * 0.32]], "#6e5236", 2.4);
    polygon(c, [[0, -s * 0.3], [s * 0.2, -s * 0.3], [s * 0.25, -s * 0.26], [s * 0.2, -s * 0.22], [0, -s * 0.22]], "#b88e5c", "#6e5236", 1);
    polygon(c, [[0, -s * 0.18], [-s * 0.18, -s * 0.18], [-s * 0.23, -s * 0.14], [-s * 0.18, -s * 0.1], [0, -s * 0.1]], "#a87e4e", "#6e5236", 1);
  } else {
    const broken = Math.sin(rotation * 7) > 0;
    const top = broken ? -s * 0.24 : -s * 0.38;
    ellipse(c, 0, 0, s * 0.11, s * 0.04, "#7a8b6830");
    polygon(c, [[-s * 0.07, 0], [-s * 0.07, top], [s * 0.07, broken ? top + s * 0.04 : top], [s * 0.07, 0]], "#c9c7ac", "#8a8d74", 1);
    if (!broken) polygon(c, [[-s * 0.1, top], [-s * 0.1, top - s * 0.04], [s * 0.1, top - s * 0.04], [s * 0.1, top]], "#d8d5ba", "#8a8d74", 1);
    line(c, [[-s * 0.02, -s * 0.03], [-s * 0.02, top + s * 0.03]], "#8a8d7470", 1);
  }
}

export function drawAtlasMine(c: Brush, point: Point) {
  sprite(c, "gold-mine", point, 1, (b) => {
    ellipse(b, 4, 22, 42, 12, "#38302920");
    ellipse(b, 1, 22, 32, 7, "#38302935");
    const rock = (p:number[][], color:string) => { polygon(b,p,color,"#55554d",.65); line(b,p.slice(0,3),"#c5bfab",.75); };
    rock([[-40,16],[-34,-5],[-21,-23],[-7,-19],[0,7],[-14,25]],"#8f9083");
    rock([[-25,-7],[-16,-31],[4,-36],[16,-20],[7,7]],"#a3a293");
    rock([[4,-27],[21,-34],[38,-12],[42,17],[24,25],[12,7]],"#85897f");
    rock([[21,-34],[35,-22],[38,-12],[21,-16]],"#b9b4a0");
    polygon(b,[[-13,22],[-12,-8],[0,-15],[14,-8],[16,22]],"#242825","#57564a",.8);
    for(const x of [-15,15]) { line(b,[[x,23],[x,-10]],"#554735",5); line(b,[[x-1,21],[x-1,-10]],"#ad936c",1.2); }
    line(b,[[-19,-11],[18,-11]],"#766047",6); line(b,[[-19,-13],[18,-13]],"#b09a74",1);
    line(b,[[-15,-3],[-5,-11]],"#8c7656",2); line(b,[[15,-3],[5,-11]],"#8c7656",2);
    for(let i=0;i<5;i++) line(b,[[-10-i*1.8,22+i*3],[12+i,22+i*3]],"#6c5c47",2);
    line(b,[[-4,14],[-13,39]],"#8d9490",1.5); line(b,[[7,14],[12,39]],"#8d9490",1.5);
    polygon(b,[[21,17],[34,17],[32,28],[22,28]],"#655846","#3e3a32",.7);
    for(const x of [23,30]) ellipse(b,x,29,2.8,2.8,"#373a37","#9a9787");
    for(const [x,y] of [[-29,8],[-20,20],[30,15],[24,16],[28,16]]) rock([[x!-3,y!],[x!,y!-4],[x!+4,y!-1],[x!+2,y!+2]],"#bdab73");
    line(b,[[20,-10],[27,-10],[27,1]],"#61513e",1.3);
    polygon(b,[[24,-1],[30,-1],[30,5],[24,5]],"#d9b777","#4e4536",.6);
  });
}

// @@@obstacle-art - Rocks or a stone gate across a way (see @@@obstacle): a heap of boulders the width of the way, or two
// stone pillars with a timber gate between them, lying across the way it shuts; cracked once it is down to half its
// health. Drawn fresh each frame (each lies its own way), as few as they are.
export function drawAtlasObstacle(c: Brush, obstacle: Pick<Obstacle, "kind" | "radius" | "along" | "hp" | "maxHp">, point: Point) {
  c.save();
  c.translate(point.x, point.y);
  c.lineCap = c.lineJoin = "round";
  const r = obstacle.radius;
  const across = { x: -obstacle.along.y, y: obstacle.along.x };
  // The point `t` of the way across (-1 to 1, one side of the way to the other), `lift` above the ground.
  const at = (t: number, lift = 0): Point => ({ x: across.x * r * t, y: across.y * r * t - lift });
  const cracked = obstacle.hp < obstacle.maxHp / 2;
  c.save();
  c.rotate(Math.atan2(across.y, across.x));
  ellipse(c, 0, r * 0.08, r * 1.2, r * 0.5, "#35493726");
  c.restore();
  if (obstacle.kind === "rocks") {
    const stones = [[-0.98, 0.44], [-0.55, 0.58], [-0.08, 0.64], [0.4, 0.58], [0.94, 0.46], [-0.76, 0.38], [0.16, 0.42], [0.68, 0.36]] as const;
    const placed = stones.map(([t, size], index) => ({ ...at(t), size: r * size, index, back: index >= 5 }));
    for (const stone of placed.sort((a, b) => Number(b.back) - Number(a.back) || a.y - b.y)) {
      const { x, size, index } = stone;
      const y = stone.y - (stone.back ? size * 0.55 : 0);
      const corners = Array.from({ length: 7 }, (_, k) => {
        const angle = (k / 7) * Math.PI * 2 + index;
        const reach = size * (0.8 + 0.2 * Math.sin(index * 3 + k * 2.1));
        return [x + Math.cos(angle) * reach, y + Math.sin(angle) * reach * 0.78] as [number, number];
      });
      polygon(c, corners, index % 2 ? "#a9ac91" : "#b9b6a0", "#6e806d", 1.2);
      polygon(c, [[x - size * 0.55, y - size * 0.1], [x - size * 0.2, y - size * 0.62], [x + size * 0.25, y - size * 0.5], [x - size * 0.05, y - size * 0.05]], "#d4d2b8", "transparent", 0);
      if (cracked && index % 3 === 0) line(c, [[x - size * 0.2, y - size * 0.5], [x, y - size * 0.1], [x - size * 0.1, y + size * 0.3]], "#55604f", 1.2);
    }
  } else {
    const high = r * 0.8;
    const ends = [at(-0.86), at(0.86)];
    // The gate's face: a timber wall between the pillars, its planks upright and two cross beams.
    polygon(c, [[ends[0]!.x, ends[0]!.y], [ends[1]!.x, ends[1]!.y], [ends[1]!.x, ends[1]!.y - high], [ends[0]!.x, ends[0]!.y - high]], "#7a5c3c", "#3f3024", 1.4);
    for (let plank = -2; plank <= 2; plank += 1) {
      if (cracked && plank === 1) continue;
      const foot = at(plank * 0.29);
      line(c, [[foot.x, foot.y], [foot.x, foot.y - high]], "#4f3a28", 1.4);
    }
    for (const lift of [high * 0.28, high * 0.72]) {
      const [from, to] = [at(-0.86, lift), at(0.86, lift)];
      line(c, [[from.x, from.y], [to.x, to.y]], "#3f3024", 2.6);
    }
    if (cracked) {
      const [from, to] = [at(0.05, high * 0.95), at(0.5, high * 0.1)];
      line(c, [[from.x, from.y], [(from.x + to.x) / 2 + r * 0.08, (from.y + to.y) / 2], [to.x, to.y]], "#24190f", 1.6);
    }
    for (const pillar of [at(-1), at(1)].sort((a, b) => a.y - b.y)) {
      const w = r * 0.2;
      const top = pillar.y - r * 1.05;
      polygon(c, [[pillar.x - w, pillar.y + 4], [pillar.x - w, top], [pillar.x + w, top], [pillar.x + w, pillar.y + 4]], "#c9c7ac", "#7d7a66", 1.2);
      polygon(c, [[pillar.x - w * 1.3, top], [pillar.x - w * 1.3, top - r * 0.12], [pillar.x + w * 1.3, top - r * 0.12], [pillar.x + w * 1.3, top]], "#d8d5ba", "#7d7a66", 1.2);
      line(c, [[pillar.x - w * 0.4, pillar.y], [pillar.x - w * 0.4, top + r * 0.1]], "#8a8d7470", 1);
      if (cracked) line(c, [[pillar.x + w * 0.5, top + r * 0.15], [pillar.x - w * 0.1, top + r * 0.45], [pillar.x + w * 0.3, top + r * 0.7]], "#55604f", 1.2);
    }
  }
  c.restore();
}

// How far above its point an obstacle's drawing reaches (see @@@obstacle-art), for what is drawn over it.
export function obstacleArtTop(obstacle: Pick<Obstacle, "kind" | "radius" | "along">) {
  return obstacle.radius * (Math.abs(obstacle.along.x) + (obstacle.kind === "gate" ? 1.2 : 0.75));
}

export function drawAtlasCamp(c: Brush, point: Point, size = 1) {
  sprite(c, "mercenary-camp", point, size, b => paintBuildingModel(b, "camp", "#8b7355"));
}

/** Neutral trading house: slate roof, linen awning, wares and hanging brass sign. */
export function drawAtlasShop(c: Brush, point: Point, size = 1) {
  sprite(c, "shop", point, size, b => paintBuildingModel(b, "shop", "#8b7355"));
}

/** The paper's own colour, under the washes and specks of the ground tile. */
export const PAPER_BASE = "#b9b49e";

let groundTile: HTMLCanvasElement | undefined;
export function drawAtlasGround(c: Brush, width: number, height: number, camera: Point) {
  if (!groundTile) {
    groundTile = createScratchCanvas(512, 512);
    const b = groundTile.getContext("2d")!;
    b.fillStyle = PAPER_BASE; b.fillRect(0, 0, 512, 512);
    let seed = 19027;
    const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
    for (let i = 0; i < 18; i++) {
      const x = random() * 512, y = random() * 512, r = 45 + random() * 110;
      const wash = b.createRadialGradient(x, y, 0, x, y, r);
      wash.addColorStop(0, "#727b4d14"); wash.addColorStop(1, "#727b4d00");
      b.fillStyle = wash; b.fillRect(0, 0, 512, 512);
    }
    for (let i = 0; i < 7000; i++) { b.fillStyle = i % 2 ? "#6c705407" : "#ece4c51a"; b.fillRect(random() * 512, random() * 512, 1, 1); }
    for (let i = 0; i < 42; i++) {
      const x = 8 + random() * 496, y = 8 + random() * 496;
      line(b, [[x - 3, y], [x - 4, y - 3], [x, y + 1], [x + 1, y - 4]], "#7c8d671c", 0.8);
    }
  }
  const offsetX = ((-camera.x % 512) + 512) % 512 - 512;
  const offsetY = ((-camera.y % 512) + 512) % 512 - 512;
  for (let x = offsetX; x < width; x += 512) for (let y = offsetY; y < height; y += 512) c.drawImage(groundTile, x, y, 512.35, 512.35);
}

/** Remains use their own low silhouette, cached once per unit kind. */
export function drawAtlasCorpse(c:Brush,kind:UnitKind,point:Point,scale:number,variant=0){
  c.save();c.translate(point.x,point.y+7);c.rotate((variant%3-1)*.14);
  sprite(c,`corpse:${kind}`,{x:0,y:0},scale, b=>paintCorpse(b,kind),variant%2===1);
  c.restore();
}
