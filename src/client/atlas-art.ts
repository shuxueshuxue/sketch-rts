import { type Brush, type Point, ellipse, flag, line, polygon } from "./art/kit";
import { BUILDING_CARDS } from "./content/buildings";
import { UNIT_CARDS } from "./content/units";
import type { BuildingKind, TerrainLandmark, UnitKind } from "../shared/types";
import type { Facing } from "./unit-facing";

const sprites = new Map<string, HTMLCanvasElement>();
const MAX_SPRITES = 256;

// Cache at a resolution suited to the drawing size, including the enlarged
// title illustration. Team colors and marks keep faction variants distinct.
// A mirrored draw flips the cached image about the sprite's own vertical axis.
function sprite(c: Brush, key: string, point: Point, scale: number, paint: (brush: Brush) => void, mirrored = false) {
  const density = Math.max(2, Math.min(6, Math.ceil(scale * 2)));
  const cacheKey = `${key}:${density}`;
  let source = sprites.get(cacheKey);
  if (!source) {
    source = document.createElement("canvas");
    source.width = source.height = 128 * density;
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
  } else {
    // Camp markers remain subtle so they cannot be mistaken for live entities.
    ellipse(c, 0, 0, size * 0.26, size * 0.12, "#a18b5c12", "#9d987d55");
    line(c, [[-9, 4], [0, -9], [9, 4]], "#8b8b6c66", 1);
  }
  c.restore();
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

let groundTile: HTMLCanvasElement | undefined;
export function drawAtlasGround(c: Brush, width: number, height: number, camera: Point) {
  if (!groundTile) {
    groundTile = document.createElement("canvas"); groundTile.width = groundTile.height = 512;
    const b = groundTile.getContext("2d")!;
    b.fillStyle = "#e8e3ca"; b.fillRect(0, 0, 512, 512);
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

let menuScene: HTMLCanvasElement | undefined;
export function drawAtlasMenu(c: Brush, width: number, height: number) {
  if (!menuScene || menuScene.width !== width || menuScene.height !== height) {
    menuScene = document.createElement("canvas"); menuScene.width = width; menuScene.height = height;
    const b = menuScene.getContext("2d")!;
    drawAtlasGround(b, width, height, { x: 0, y: 0 });
    b.lineJoin = b.lineCap = "round";
    const s = Math.min(width / 1440, height / 900);
    b.save(); b.translate(width * 0.72, height * 0.54); b.scale(s, s);
    for (let i = 0; i < 12; i++) {
      b.beginPath(); b.ellipse(20, 15, 200 + i * 28, 125 + i * 19, -0.35, 0, Math.PI * 2);
      b.strokeStyle = "#7f977427"; b.lineWidth = 1; b.stroke();
    }
    b.beginPath(); b.moveTo(330, -500); b.bezierCurveTo(110, -290, 365, -120, 260, 40); b.bezierCurveTo(70, 220, 280, 310, 130, 500);
    b.strokeStyle = "#a4b8a6"; b.lineWidth = 34; b.stroke();
    b.strokeStyle = "#b8cbbb"; b.lineWidth = 26; b.stroke();
    b.strokeStyle = "#e2e7ce"; b.lineWidth = 1; b.stroke();
    for (let i = 0; i < 54; i++) {
      const a = i * 2.399, r = 210 + (i % 7) * 17;
      const x = Math.cos(a) * r, y = Math.sin(a) * r * 0.72;
      if (x > 180 || (x > -140 && y > 100)) continue;
      tree(b, x, y, 1.1 + (i % 3) * 0.17, i);
    }
    b.beginPath(); b.moveTo(-245, 350); b.bezierCurveTo(-230, 130, 160, 120, -5, -70);
    b.strokeStyle = "#b8a47b77"; b.lineWidth = 20; b.stroke();
    b.strokeStyle = "#e3d5b3"; b.lineWidth = 14; b.stroke();
    drawAtlasBuilding(b, "townHall", { x: -10, y: -46 }, 225, "#3d7169");
    drawAtlasBuilding(b, "defenseTower", { x: -143, y: 39 }, 98, "#3d7169");
    drawAtlasBuilding(b, "farm", { x: 105, y: 41 }, 100, "#4c7766");
    drawAtlasBuilding(b, "barracks", { x: -45, y: 110 }, 110, "#3d7169");
    drawAtlasMine(b, { x: -212, y: -118 });
    for (let i = 0; i < 5; i++) drawAtlasUnit(b, "footman", { x: -95 + (i % 3) * 31, y: 192 + Math.floor(i / 3) * 31 }, 1.02, "#3e7369");
    drawAtlasCamp(b, { x: 152, y: -218 }, 1.05);
    // Compass and survey marks frame the illustration like a printed field atlas.
    b.save(); b.translate(303, -265);
    for (let i = 0; i < 4; i++) { b.rotate(Math.PI / 2); polygon(b, [[0, -35], [6, 0], [0, 8], [-6, 0]], i % 2 ? "#c3b48b" : "#526e5b", "#526e5b", 0.8); }
    b.beginPath(); b.arc(0, 0, 25, 0, Math.PI * 2); b.strokeStyle = "#7a8a6880"; b.lineWidth = 1; b.stroke();
    b.font = "12px Georgia"; b.textAlign = "center"; b.fillStyle = "#647656"; b.fillText("N", 0, -46);
    b.restore();
    b.restore();
    const vignette = b.createRadialGradient(width * 0.66, height * 0.45, width * 0.1, width * 0.66, height * 0.45, width * 0.7);
    vignette.addColorStop(0, "#695c3600"); vignette.addColorStop(1, "#695c3626"); b.fillStyle = vignette; b.fillRect(0, 0, width, height);
    b.strokeStyle = "#797d4e36"; b.lineWidth = 1; b.strokeRect(20, 20, width - 40, height - 40);
  }
  c.drawImage(menuScene, 0, 0);
}
