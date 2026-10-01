import { type Brush, type Point, ellipse, flag, line, polygon } from "./art/kit";
import { createScratchCanvas } from "./art/scratch-canvas";
import { BUILDING_CARDS } from "./content/buildings";
import { UNIT_CARDS } from "./content/units";
import type { BuildingKind, TerrainLandmark, UnitKind } from "../shared/types";
import type { Facing } from "./unit-facing";

const sprites = new Map<string, HTMLCanvasElement>();
const MAX_SPRITES = 256;

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
    if (sprites.size >= MAX_SPRITES) sprites.delete(sprites.keys().next().value!);
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

export function drawAtlasBuilding(c: Brush, kind: BuildingKind, point: Point, size: number, color: string) {
  const card = BUILDING_CARDS[kind];
  sprite(c, `b:${card.glyph.frame}:${color}`, point, size / 76, (b) => {
    ellipse(b, 6, 33, 48, 14, "#31433824");
    polygon(b, [[-48, 17], [-8, -1], [48, 16], [9, 43]], "#b7ba95", "#899779", 1);
    polygon(b, [[-39, 21], [-8, 6], [39, 19], [8, 36]], "#cec9a7", "#9da080", 0.7);
    card.paint(b, color);
  });
}

/** Unit models face right; facing -1 draws the mirror image, facing left. */
export function drawAtlasUnit(c: Brush, kind: UnitKind, point: Point, scale: number, color: string, facing: Facing = 1) {
  sprite(c, `u:${kind}:${color}`, point, scale, (b) => {
    const card = UNIT_CARDS[kind];
    if (card.art.bearing === "foot" && kind !== "wildling") ellipse(b, 2, 16, 17, 6, "#30483630");
    else if (kind === "wildling" || kind === "mossGnawer" || kind === "spirit") ellipse(b, 2, 15, 14, 5, "#30483630");
    card.paint(b, color);
  }, facing === -1);
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
  ellipse(c, 5, 4, 16, 6, "#304f3b19");
  line(c, [[0, 4], [0, -12]], "#79744f", 3);
  polygon(c, [[-17, -5], [-9, -20], [-12, -20], [0, -44], [12, -20], [8, -20], [17, -5], [0, 0]], tone % 2 ? "#71866a" : "#577762", "#526951", 1);
  polygon(c, [[0, -41], [0, -3], [-14, -7], [-6, -19], [-9, -20]], tone % 2 ? "#8d9d78" : "#799573", "transparent", 0);
  line(c, [[-8, -13], [-2, -11], [-2, -27]], "#afbb8b", 0.8);
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
    ellipse(b, 3, 20, 37, 12, "#35493724");
    polygon(b, [[-35, 13], [-25, -9], [-11, -22], [6, -18], [17, -27], [31, -9], [37, 16], [5, 25]], "#a9ac91", "#6e806d");
    polygon(b, [[-34, 12], [-11, -22], [-5, 2], [-15, 18]], "#cfceb0", "transparent", 0);
    polygon(b, [[5, -17], [17, -27], [22, -5], [7, 3]], "#d0c5a0", "transparent", 0);
    polygon(b, [[-10, 20], [-9, -1], [0, -8], [10, -2], [13, 21]], "#354a3e");
    line(b, [[-14, 21], [-14, -2], [0, -12], [14, -3], [16, 21]], "#8d7449", 4);
    line(b, [[-12, -1], [13, -1]], "#d0af70", 2);
    for (const [x, y] of [[-23, 3], [22, 3], [27, 14], [-21, 17]]) polygon(b, [[x! - 4, y!], [x!, y! - 8], [x! + 5, y! - 3], [x! + 3, y! + 3]], "#dfba65", "#9f8450", 0.8);
    line(b, [[-3, 17], [-10, 30]], "#847450", 2);
    line(b, [[7, 18], [5, 32]], "#847450", 2);
  });
}

export function drawAtlasCamp(c: Brush, point: Point, size = 1) {
  sprite(c, "mercenary-camp", point, size, (b) => {
    ellipse(b, 4, 24, 45, 14, "#3b4b3822");
    polygon(b, [[-39, 22], [-9, -30], [30, -18], [43, 22], [1, 32]], "#a37750", "#62573f");
    polygon(b, [[-39, 22], [-9, -30], [1, 32]], "#e3cb99", "#726448");
    polygon(b, [[-26, 24], [-9, -9], [-2, 29]], "#465443");
    line(b, [[-9, -30], [1, 32]], "#f0d9a5", 2);
    line(b, [[13, -22], [26, 26]], "#dfbf85", 3);
    flag(b, -9, -38, "#a3734e", 0.6);
    ellipse(b, 34, 30, 10, 5, "#837354");
    polygon(b, [[29, 29], [31, 18], [36, 24], [39, 29]], "#e0b05d", "#a37843", 1);
  });
}

// A shop (see @@@shop): a merchant's stall under a striped awning, its goods on the counter, a coin hung at its post.
export function drawAtlasShop(c: Brush, point: Point, size = 1) {
  sprite(c, "shop", point, size, (b) => {
    ellipse(b, 2, 24, 42, 12, "#3b4b3822");
    polygon(b, [[-30, 22], [-30, -4], [30, -4], [30, 22]], "#c9a874", "#62573f");
    polygon(b, [[-22, 22], [-22, 6], [22, 6], [22, 22]], "#7a5a3a", "#62573f");
    polygon(b, [[-36, -4], [-28, -26], [28, -26], [36, -4]], "#b5523f", "#62573f");
    for (const x of [-18, 0, 18]) polygon(b, [[x - 5, -4], [x - 3, -26], [x + 3, -26], [x + 5, -4]], "#f0e3c0", "#b5523f", 0.8);
    ellipse(b, -10, 2, 5, 3, "#d9b25a", "#8a6418");
    ellipse(b, 8, 2, 6, 3, "#9ed8ff", "#315f87");
    line(b, [[38, 22], [38, -16]], "#62573f", 2);
    ellipse(b, 38, -19, 6, 6, "#f2d05c", "#8a6418");
  });
}

/** The paper's own colour, under the washes and specks of the ground tile. */
export const PAPER_BASE = "#e8e3ca";

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
      wash.addColorStop(0, "#8caa7514"); wash.addColorStop(1, "#8caa7500");
      b.fillStyle = wash; b.fillRect(0, 0, 512, 512);
    }
    for (let i = 0; i < 7000; i++) { b.fillStyle = i % 2 ? "#6c705407" : "#fff9df20"; b.fillRect(random() * 512, random() * 512, 1, 1); }
    for (let i = 0; i < 42; i++) {
      const x = 8 + random() * 496, y = 8 + random() * 496;
      line(b, [[x - 3, y], [x - 4, y - 3], [x, y + 1], [x + 1, y - 4]], "#7c8d671c", 0.8);
    }
  }
  const offsetX = ((-camera.x % 512) + 512) % 512 - 512;
  const offsetY = ((-camera.y % 512) + 512) % 512 - 512;
  for (let x = offsetX; x < width; x += 512) for (let y = offsetY; y < height; y += 512) c.drawImage(groundTile, x, y);
}
