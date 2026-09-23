import type { BuildingGlyph } from "./building-glyphs";
import { UNIT_ART } from "./unit-art";
import type { TerrainLandmark, UnitKind } from "../shared/types";

type Point = { x: number; y: number };
type Brush = CanvasRenderingContext2D;
const INK = "#35483c";
const GOLD = "#cfab62";
const sprites = new Map<string, HTMLCanvasElement>();
const MAX_SPRITES = 256;

function polygon(c: Brush, points: number[][], fill: string, stroke = INK, width = 1.4) {
  c.beginPath();
  points.forEach(([x, y], i) => i ? c.lineTo(x!, y!) : c.moveTo(x!, y!));
  c.closePath();
  c.fillStyle = fill;
  c.fill();
  if (width) { c.strokeStyle = stroke; c.lineWidth = width; c.stroke(); }
}

function ellipse(c: Brush, x: number, y: number, rx: number, ry: number, fill: string, stroke?: string) {
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  c.fillStyle = fill;
  c.fill();
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1.2; c.stroke(); }
}

function line(c: Brush, points: number[][], color = INK, width = 1.4) {
  c.beginPath();
  points.forEach(([x, y], i) => i ? c.lineTo(x!, y!) : c.moveTo(x!, y!));
  c.strokeStyle = color;
  c.lineWidth = width;
  c.stroke();
}

// Cache at a resolution suited to the drawing size, including the enlarged
// title illustration. Team colors and marks keep faction variants distinct.
function sprite(c: Brush, key: string, point: Point, scale: number, paint: (brush: Brush) => void) {
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
  c.drawImage(source, point.x - 64 * scale, point.y - 64 * scale, 128 * scale, 128 * scale);
}

function flag(c: Brush, x: number, y: number, color: string, size = 1) {
  line(c, [[x, y + 18 * size], [x, y - 11 * size]], INK, 1.6);
  polygon(c, [[x, y - 11 * size], [x + 18 * size, y - 8 * size], [x + 13 * size, y - 3 * size], [x, y - 4 * size]], color);
  ellipse(c, x, y - 12 * size, 1.7, 1.7, GOLD);
}

function house(c: Brush, x: number, y: number, size: number, color: string) {
  c.save(); c.translate(x, y); c.scale(size, size);
  polygon(c, [[-26, -7], [7, -1], [7, 28], [-26, 20]], "#e0d4ad");
  polygon(c, [[7, -1], [29, -13], [29, 14], [7, 28]], "#b6ad8e");
  polygon(c, [[-33, -7], [-10, -30], [28, -23], [7, 3]], color);
  polygon(c, [[7, 3], [28, -23], [35, -11]], "#405d54");
  line(c, [[-29, -7], [7, 0], [27, -22]], "#e0d4ad", 1.2);
  for (let i = 0; i < 3; i++) line(c, [[-24 + i * 7, -13 - i * 5], [12 + i * 6, -7 - i * 5]], "#e2debb66", 0.7);
  line(c, [[-23, -4], [-23, 19], [6, 25], [6, 4]], "#807c60");
  polygon(c, [[-14, 9], [-5, 11], [-5, 23], [-14, 21]], "#3d4e44");
  polygon(c, [[17, 4], [23, 1], [23, 8], [17, 11]], "#f0c97e");
  ellipse(c, -7, 17, 1, 1, GOLD);
  c.restore();
}

function tower(c: Brush, x: number, y: number, size: number, color: string) {
  c.save(); c.translate(x, y); c.scale(size, size);
  polygon(c, [[-12, -20], [4, -16], [4, 27], [-12, 21]], "#ded5b5");
  polygon(c, [[4, -16], [15, -22], [15, 20], [4, 27]], "#a9a88b");
  polygon(c, [[-18, -20], [0, -48], [21, -23], [4, -14]], color);
  line(c, [[0, -45], [4, -17], [18, -23]], "#d0bc86", 1);
  for (let i = 0; i < 3; i++) line(c, [[-11, i * 10 - 10], [3, i * 10 - 6]], "#aaab8d", 0.8);
  polygon(c, [[-7, -9], [-3, -8], [-3, 3], [-7, 2]], "#34473d");
  polygon(c, [[8, 0], [11, -2], [11, 9], [8, 11]], "#34473d");
  c.restore();
}

export function drawAtlasBuilding(c: Brush, glyph: BuildingGlyph, point: Point, size: number, color: string) {
  sprite(c, `b:${glyph.frame}:${color}`, point, size / 76, (b) => {
    ellipse(b, 6, 33, 48, 14, "#31433824");
    polygon(b, [[-48, 17], [-8, -1], [48, 16], [9, 43]], "#b7ba95", "#899779", 1);
    polygon(b, [[-39, 21], [-8, 6], [39, 19], [8, 36]], "#cec9a7", "#9da080", 0.7);
    const frame = glyph.frame;
    if (frame === "town-hall") {
      tower(b, -24, -3, 0.72, color);
      house(b, 3, 0, 1.08, color);
      tower(b, 29, 5, 0.61, color);
      flag(b, -24, -43, color, 0.6);
      line(b, [[-10, 28], [10, 33], [16, 29]], "#ece5c8", 3);
    } else if (frame === "tower-spire" || frame === "cinder-spire") {
      tower(b, 0, -1, 1.12, color);
      flag(b, 0, -45, color, 0.5);
      if (frame === "cinder-spire") {
        polygon(b, [[-5, -29], [1, -45], [8, -29], [0, -22]], "#efb06a", "#974c39");
      }
    } else if (frame === "moon-well" || frame === "ember-shrine") {
      const ember = frame === "ember-shrine";
      ellipse(b, 0, 12, 30, 17, "#9b9c80", INK);
      ellipse(b, 0, 6, 30, 16, "#e7ddba", INK);
      ellipse(b, 0, 6, 23, 11, ember ? "#bc684a" : "#5f9d98", INK);
      ellipse(b, 0, 5, 16, 6, ember ? "#e6ac61" : "#acd1bb");
      for (const x of [-27, 27]) { tower(b, x, -9, 0.35, color); }
      if (ember) polygon(b, [[-7, 4], [-10, -12], [0, -28], [5, -11], [10, -5], [7, 4]], "#edc170", "#ba7746");
      else { ellipse(b, 0, -17, 9, 9, "#f2e2ac", "#93865d"); ellipse(b, 4, -20, 7, 7, "#b6b995"); }
    } else if (frame === "farm-plot") {
      polygon(b, [[-35, 11], [-7, -2], [30, 13], [3, 32]], "#8e8860");
      for (let i = 0; i < 5; i++) {
        line(b, [[-28 + i * 7, 12 + i * 3], [-6 + i * 7, 1 + i * 3]], "#dbbb72", 3);
        for (let j = 0; j < 3; j++) line(b, [[-25 + i * 7 + j * 6, 11 + i * 3 - j * 3], [-27 + i * 7 + j * 6, 5 + i * 3 - j * 3]], "#ded29c", 1);
      }
      house(b, 12, -17, 0.6, color);
      line(b, [[-37, 20], [-37, 4], [-18, 10], [-18, 28]], "#726d4e", 2);
    } else if (frame === "sanctum-dome") {
      house(b, 0, 7, 1, color);
      ellipse(b, -2, -22, 22, 15, "#809d90", INK);
      polygon(b, [[-24, -21], [-16, -38], [-3, -49], [12, -36], [21, -22]], color);
      line(b, [[-3, -46], [-3, -22]], GOLD, 1.5);
      ellipse(b, -3, -50, 3, 3, GOLD, INK);
    } else if (frame === "ember-forge" || frame === "workshop-gear") {
      house(b, -4, 4, 1.06, color);
      polygon(b, [[17, -32], [27, -35], [27, -6], [17, -1]], "#8e917b");
      polygon(b, [[14, -35], [24, -39], [31, -35], [21, -31]], "#d0c6a5");
      polygon(b, [[-14, 10], [1, 13], [1, 26], [-14, 22]], "#543e32");
      ellipse(b, -6, 17, 5, 6, "#e9ac59");
      if (frame === "workshop-gear") {
        ellipse(b, -29, 9, 11, 11, "#a9a88d", INK);
        for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; line(b, [[-29 + Math.cos(a) * 6, 9 + Math.sin(a) * 6], [-29 + Math.cos(a) * 13, 9 + Math.sin(a) * 13]], INK, 3); }
        ellipse(b, -29, 9, 4, 4, GOLD, INK);
      }
    } else {
      house(b, -4, -2, 1.08, color);
      if (frame === "archery-range") {
        line(b, [[25, 10], [18, 31], [33, 31], [25, 10]], "#796b4c", 2);
        ellipse(b, 26, 9, 10, 13, "#e9d8ae", INK);
        ellipse(b, 26, 9, 6, 8, color);
        ellipse(b, 26, 9, 2, 3, GOLD);
      } else if (frame === "stables-gate") {
        for (let i = 0; i < 4; i++) line(b, [[-31 + i * 17, 23 + i * 3], [-31 + i * 17, 10 + i * 3]], "#7e7555", 2.5);
        line(b, [[-31, 16], [20, 25]], "#b9a576", 3);
        b.beginPath(); b.arc(-11, 4, 5, 0, Math.PI); b.strokeStyle = GOLD; b.lineWidth = 2; b.stroke();
      } else {
        polygon(b, [[18, 2], [30, 5], [28, 19], [23, 23], [17, 15]], color);
        line(b, [[16, -4], [34, 20]], "#d6ddcc", 2.4);
        line(b, [[33, -3], [17, 22]], "#d6ddcc", 2.4);
      }
      flag(b, -9, -28, color, 0.75);
    }
  });
}

const SKIN = "#ddc29a";
const STEEL = "#c3cdc2";
const STEEL_DARK = "#7f8e86";
const LEATHER = "#8d6c47";
const LEATHER_DARK = "#5f4b35";
const WOOD = "#7a6547";
const LINEN = "#e6d9b4";
const BOOT = "#554f3b";
const EMBER = "#e07a45";
const EMBER_GLOW = "#f4c86e";
const ASH = "#5f5a54";
const BARK = "#8a7a52";
const MOSS = "#6f8756";
const LEAF = "#8fae6d";
type XY = [number, number];

function mix(hex: string, target: number, amount: number) {
  if (!/^#[0-9a-f]{6}/i.test(hex)) return hex;
  const n = parseInt(hex.slice(1, 7), 16);
  const channel = (shift: number) => Math.round(((n >> shift) & 255) * (1 - amount) + target * amount);
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}
const darker = (hex: string, amount = 0.3) => mix(hex, 0, amount);
const lighter = (hex: string, amount = 0.35) => mix(hex, 255, amount);

// ---- Humanoid rig: feet at y=16, hips y=8, shoulders y=-9, head at (-1,-15).
function legs(b: Brush, stance: "stand" | "brace" | "stride" = "stand", color = BOOT) {
  const pairs = stance === "brace" ? [[-4, 8, -9, 16], [4, 8, 9, 16]]
    : stance === "stride" ? [[-3, 7, -12, 13], [4, 7, 11, 16]]
    : [[-5, 8, -6, 16], [5, 8, 6, 16]];
  for (const [x1, y1, x2, y2] of pairs) {
    line(b, [[x1!, y1!], [x2!, y2!]], color, 4);
    ellipse(b, x2! + 1.2, y2! + 0.6, 3, 1.6, "#3f3a2c");
  }
}

function torso(b: Brush, fill: string, hem = 9, flare = 0, lean = 0) {
  polygon(b, [[-8 + lean, -9], [7 + lean, -9], [11 + flare, hem], [-11 - flare, hem]], fill);
  polygon(b, [[-8 + lean, -8], [-1 + lean, -7], [-3, hem - 1], [-11 - flare, hem - 1]], "#243f3d2e", "transparent", 0);
}

function hemTrim(b: Brush, hem: number, flare = 0, color = GOLD) {
  line(b, [[-10.5 - flare, hem - 1.6], [10.5 + flare, hem - 1.6]], color, 1.8);
}

function quilting(b: Brush, fill: string) {
  for (const x of [-5, -1, 3]) line(b, [[x, -7], [x + (x < 0 ? -1.5 : 1.5), 7]], darker(fill, 0.22), 0.8);
}

function belt(b: Brush, color = LEATHER_DARK, buckle?: string) {
  line(b, [[-9.5, 3], [9.5, 3]], color, 2.4);
  if (buckle) polygon(b, [[-1, 1.4], [2, 1.4], [2, 4.6], [-1, 4.6]], buckle, INK, 0.8);
}

function arm(b: Brush, from: XY, to: XY, sleeve: string, hand = SKIN, width = 3.6) {
  line(b, [from, to], sleeve, width);
  ellipse(b, to[0], to[1], 2.1, 2.1, hand, INK);
}

function head(b: Brush, skin = SKIN, dx = 0) {
  ellipse(b, -1 + dx, -15, 6, 7, skin, INK);
  ellipse(b, 2.4 + dx, -15.5, 0.9, 1.1, INK);
}

function blade(b: Brush, from: XY, to: XY, width: number, fill = "#d6ded0", edge?: string) {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const length = Math.hypot(dx, dy) || 1;
  const px = -dy / length * width / 2, py = dx / length * width / 2;
  polygon(b, [[from[0] + px, from[1] + py], [to[0] - dx / length * width + px * 0.8, to[1] - dy / length * width + py * 0.8], to, [from[0] - px, from[1] - py]], fill, INK, 1);
  if (edge) line(b, [[from[0] - px * 0.8, from[1] - py * 0.8], [to[0] - px * 0.2, to[1] - py * 0.2]], edge, 1.2);
  line(b, [[from[0] + px * 2.2, from[1] + py * 2.2], [from[0] - px * 2.2, from[1] - py * 2.2]], STEEL_DARK, 2.2);
}

function spear(b: Brush, butt: XY, tip: XY, headLength = 8, shaft = WOOD) {
  const dx = tip[0] - butt[0], dy = tip[1] - butt[1];
  const length = Math.hypot(dx, dy);
  const base: XY = [tip[0] - dx / length * headLength, tip[1] - dy / length * headLength];
  line(b, [butt, base], shaft, 2.2);
  const px = -dy / length * 2.6, py = dx / length * 2.6;
  polygon(b, [[base[0] + px, base[1] + py], tip, [base[0] - px, base[1] - py]], "#d8dfd0", INK, 1);
}

function pennant(b: Brush, x: number, y: number, color: string, size = 1) {
  polygon(b, [[x, y], [x - 13 * size, y + 2 * size], [x - 9 * size, y + 5 * size], [x - 13 * size, y + 8 * size], [x, y + 8 * size]], color, INK, 1);
}

function bow(b: Brush, x: number, y: number, height: number, color = "#846c45", arrowTip = "#bcc5b0") {
  b.beginPath(); b.ellipse(x, y, 7, height, -0.1, -Math.PI / 2, Math.PI / 2); b.strokeStyle = color; b.lineWidth = 2.6; b.stroke();
  line(b, [[x - 2, y - height], [x + 1, y + height]], "#d6c494", 0.8);
  line(b, [[x - 10, y + 1], [x + 12, y - 1]], "#5e6049", 1.5);
  polygon(b, [[x + 11, y - 4], [x + 16, y - 1], [x + 11, y + 2]], arrowTip);
}

function quiver(b: Brush, fill = LEATHER) {
  polygon(b, [[-12, -12], [-7, -14], [-2, 4], [-7, 6]], fill, INK, 1.1);
  for (const x of [-11, -9, -7]) line(b, [[x, -13], [x - 2, -19]], "#e9e0c4", 1.5);
}

function roundShield(b: Brush, x: number, y: number, r: number, fill: string, band?: string) {
  ellipse(b, x, y, r * 0.85, r, fill, INK);
  if (band) line(b, [[x - r * 0.6, y - r * 0.5], [x + r * 0.6, y + r * 0.5]], band, 2.6);
  ellipse(b, x, y, r * 0.28, r * 0.3, STEEL_DARK, INK);
}

function kiteShield(b: Brush, x: number, y: number, w: number, h: number, fill: string, rim: string) {
  const pts = [[x - w / 2, y - h * 0.45], [x + w / 2, y - h * 0.55], [x + w / 2, y + h * 0.1], [x, y + h * 0.5], [x - w / 2, y + h * 0.15]];
  polygon(b, pts, fill, INK, 1.3);
  polygon(b, pts.map(([px, py]) => [x + (px! - x) * 0.72, y + (py! - y) * 0.72]), "transparent", rim, 1.1);
}

function leafMark(b: Brush, x: number, y: number, size: number, fill = LEAF) {
  polygon(b, [[x, y - size], [x + size * 0.6, y], [x, y + size], [x - size * 0.6, y]], fill, darker(fill, 0.35), 0.8);
  line(b, [[x, y - size * 0.8], [x, y + size]], darker(fill, 0.4), 0.7);
}

function staff(b: Brush, x: number, top: number, bottom = 16, color = WOOD) {
  line(b, [[x, bottom], [x, top]], color, 2.3);
}

function halo(b: Brush, y = -27, color = GOLD) {
  b.beginPath(); b.ellipse(-1, y, 8.5, 2.6, 0, 0, Math.PI * 2); b.strokeStyle = color; b.lineWidth = 1.5; b.stroke();
}

function capeBehind(b: Brush, color: string, trim = GOLD) {
  polygon(b, [[-7, -10], [5, -10], [1, 2], [-6, 17], [-19, 15], [-15, 0]], darker(color, 0.12));
  line(b, [[-6, 16.5], [-19, 14.5]], trim, 1.6);
}

// ---- Headgear
function kettleHelm(b: Brush) {
  polygon(b, [[-7, -17.5], [-6, -23], [-1, -25.5], [5, -23], [6, -17.5]], STEEL, INK, 1.2);
  ellipse(b, -0.5, -17.8, 10, 2.3, STEEL_DARK, INK);
}

function skullCap(b: Brush) {
  polygon(b, [[-7.5, -15], [-6.5, -21.5], [-1, -24], [5, -21.5], [6, -17], [-1, -18.5]], STEEL_DARK, INK, 1.2);
}

function hood(b: Brush, fill: string) {
  polygon(b, [[-10, -8], [-9.5, -20], [-3, -25.5], [5, -24], [8.5, -17], [7, -10.5], [4.5, -18.5], [-2, -20], [-5, -11]], fill);
}

function pointedHat(b: Brush, fill: string, band = GOLD) {
  ellipse(b, -1, -19.5, 11.5, 2.6, darker(fill, 0.1), INK);
  polygon(b, [[-8, -20], [-4, -30], [-1, -38], [8, -35], [3, -31], [7, -20]], fill);
  line(b, [[-7.5, -21.5], [6.8, -21.5]], band, 1.8);
}

function plumedHelm(b: Brush, plume: string) {
  b.beginPath(); b.moveTo(-1, -24); b.bezierCurveTo(-4, -34, -14, -34, -17, -26); b.bezierCurveTo(-12, -29, -7, -28, -4, -22);
  b.closePath(); b.fillStyle = plume; b.fill(); b.strokeStyle = INK; b.lineWidth = 1; b.stroke();
  polygon(b, [[-7.5, -9.5], [-7.5, -21], [-1, -25], [6.5, -21.5], [7, -9.5]], STEEL, INK, 1.3);
  polygon(b, [[-7, -20], [-1, -24], [6, -21], [-1, -19]], "#e6ece0", "transparent", 0);
  line(b, [[0, -16.5], [6.6, -16.5]], INK, 1.8);
  line(b, [[-1, -24.5], [-1, -10]], GOLD, 1.2);
  for (const y of [-13, -11]) line(b, [[3, y], [6, y]], INK, 0.7);
}

function hornedCap(b: Brush) {
  polygon(b, [[-7.5, -16], [-6.5, -22], [-1, -24.5], [5, -22], [6, -16.5], [-1, -19]], LEATHER_DARK, INK, 1.1);
  polygon(b, [[-6, -21], [-13, -24], [-15, -31], [-10, -26], [-5, -24]], "#e4dcc0", INK, 1);
  polygon(b, [[4, -22], [10, -26], [12, -33], [13, -25], [6, -19]], "#e4dcc0", INK, 1);
}

// ---- Mounts: horse at the origin, rider drawn after translating up.
function horse(b: Brush, coat: string, size: number, dress?: { cloth: string; trim: string }) {
  b.save(); b.scale(size, size);
  line(b, [[-17, 4], [-24, 11]], darker(coat, 0.45), 3.2);
  for (const x of [-13, -6, 10, 16]) {
    line(b, [[x, 9], [x - 2, 19]], darker(coat, 0.3), 2.8);
    ellipse(b, x - 1.5, 19.5, 2, 1.1, "#3f3a2c");
  }
  polygon(b, [[-18, 2], [7, -3], [19, 2], [15, 12], [-13, 12]], coat);
  polygon(b, [[8, 0], [8, -13], [14, -19], [24, -11], [22, -6], [16, -7], [19, 5]], lighter(coat, 0.12));
  line(b, [[13, -17], [9, -10], [10, 2]], darker(coat, 0.45), 3);
  ellipse(b, 19, -12, 1, 1, INK);
  if (dress) {
    polygon(b, [[-19, 0], [8, -4], [18, 1], [17, 14], [8, 17], [-5, 17], [-19, 14]], dress.cloth);
    line(b, [[-19, 13.5], [-5, 16.5], [8, 16.5], [17, 13.5]], dress.trim, 1.8);
    for (const x of [-12, 0, 11]) ellipse(b, x, 8, 1.6, 1.6, dress.trim);
    polygon(b, [[15, -17], [22, -12], [24, -9], [19, -8], [13, -12]], STEEL, INK, 1);
  }
  b.restore();
}

function riderLeg(b: Brush, color = BOOT) {
  line(b, [[1, 7], [4, 15]], color, 3.6);
  ellipse(b, 5, 15.5, 2.6, 1.4, "#3f3a2c");
}

// ---- Units
function paintUnit(b: Brush, kind: UnitKind, color: string) {
  const team = color;
  switch (kind) {
    case "worker": {
      legs(b);
      torso(b, "#b7a176");
      polygon(b, [[-5, -6], [4, -6], [6, 8], [-7, 8]], LINEN, INK, 0.8);
      belt(b);
      ellipse(b, -12, 5, 4, 5, "#92764d", INK); line(b, [[-5, -9], [-12, 1]], "#856b46", 1.6);
      line(b, [[9, 10], [21, -20]], "#78684d", 2.6);
      line(b, [[11, -20], [21, -23], [28, -17]], "#a8b7ab", 3);
      arm(b, [6, -6], [13, 1], "#b7a176");
      head(b);
      ellipse(b, -1, -19, 11, 2.6, "#d9c07a", INK);
      polygon(b, [[-7, -19], [-5, -25], [3, -25.5], [5, -19]], "#d9c07a");
      line(b, [[-6.5, -20.5], [4.8, -20.5]], team, 2);
      return;
    }
    case "footman": {
      legs(b);
      torso(b, team);
      quilting(b, team);
      belt(b);
      blade(b, [13, -1], [18, -20], 3.4);
      arm(b, [6, -6], [12, 1], team);
      head(b);
      kettleHelm(b);
      roundShield(b, -12, 1, 8, "#9c8058", team);
      return;
    }
    case "archer": {
      quiver(b);
      legs(b);
      torso(b, team);
      polygon(b, [[-7, -8], [6, -8], [8, 5], [-8, 5]], LEATHER, INK, 0.9);
      belt(b);
      arm(b, [6, -6], [12, -2], team);
      head(b);
      hood(b, darker(team, 0.18));
      bow(b, 15, -3, 17);
      return;
    }
    case "lancer": {
      legs(b, "brace");
      torso(b, team, 10);
      quilting(b, team);
      belt(b);
      spear(b, [11, 18], [17, -47], 9);
      pennant(b, 16.5, -37, team, 0.7);
      arm(b, [6, -6], [14, -3], team);
      arm(b, [-5, -6], [13.5, -13], darker(team, 0.1));
      head(b);
      skullCap(b);
      return;
    }
    case "groveWarden": {
      legs(b);
      torso(b, team);
      polygon(b, [[-7, -8], [6, -8], [8, 3], [-8, 3]], LEATHER, INK, 0.9);
      belt(b);
      spear(b, [16, 16], [18, -33], 7);
      arm(b, [6, -6], [16, 0], team);
      head(b);
      kettleHelm(b);
      leafMark(b, -1, -29, 4.5);
      kiteShield(b, -12, 0, 12, 22, team, LINEN);
      leafMark(b, -12, -1, 4.2, "#b7cf94");
      return;
    }
    case "raider": {
      ellipse(b, 2, 17, 22, 5.5, "#30483630");
      horse(b, "#9a7651", 0.92);
      polygon(b, [[-8, -3], [6, -5], [8, 5], [-8, 6]], team, INK, 1);
      b.translate(-2, -9);
      riderLeg(b);
      polygon(b, [[-7, -9], [6, -9], [9, 6], [-9, 6]], LEATHER, INK, 1.2);
      line(b, [[-8, 1], [8, 1]], team, 2.2);
      b.beginPath(); b.moveTo(-6, -11); b.bezierCurveTo(-14, -12, -18, -6, -25, -9); b.lineTo(-22, -4); b.bezierCurveTo(-16, -3, -12, -7, -5, -6); b.closePath();
      b.fillStyle = team; b.fill(); b.strokeStyle = INK; b.lineWidth = 1; b.stroke();
      head(b);
      hood(b, darker(team, 0.2));
      b.beginPath(); b.moveTo(12, -1); b.quadraticCurveTo(22, -12, 18, -27); b.quadraticCurveTo(20, -13, 14, 0); b.closePath();
      b.fillStyle = "#d6ded0"; b.fill(); b.strokeStyle = INK; b.lineWidth = 1; b.stroke();
      arm(b, [5, -6], [12, 0], LEATHER);
      return;
    }
    case "knight": {
      ellipse(b, 2, 20, 29, 7, "#30483638");
      horse(b, "#d4cfbb", 1.13, { cloth: team, trim: GOLD });
      b.translate(-3, -12);
      capeBehind(b, team);
      riderLeg(b, STEEL_DARK);
      polygon(b, [[-8, -9], [7, -9], [10, 7], [-10, 7]], STEEL, INK, 1.3);
      polygon(b, [[-8, -8], [-1, -7], [-3, 6], [-10, 6]], "#5c6f6533", "transparent", 0);
      line(b, [[-9, 1], [9, 1]], GOLD, 1.8);
      polygon(b, [[3, -10], [10, -8], [11, -2], [4, -3]], STEEL, INK, 1.1);
      spear(b, [-8, 4], [37, -35], 7, "#6e5940");
      pennant(b, 30.5, -28.5, team, 0.62);
      arm(b, [5, -5], [7, -2], STEEL, STEEL_DARK);
      plumedHelm(b, lighter(team, 0.15));
      polygon(b, [[-18, -6], [-7, -9], [-6, 6], [-11.5, 13], [-18, 7]], team, INK, 1.3);
      polygon(b, [[-16, -4], [-12, 2], [-8, -6]], "transparent", GOLD, 1.6);
      ellipse(b, -12, 2, 2, 2, GOLD);
      return;
    }
    case "priest": {
      torso(b, LINEN, 15, 2);
      polygon(b, [[-4, -9], [-1, -9], [-2, 15], [-5, 15]], team, "transparent", 0);
      polygon(b, [[2, -9], [5, -9], [6, 15], [3, 15]], team, "transparent", 0);
      hemTrim(b, 15, 2);
      belt(b, "#b89c63");
      staff(b, 16, -27);
      line(b, [[11, -27], [21, -27]], GOLD, 2);
      leafMark(b, 16, -32, 4.5, "#d9c882");
      arm(b, [6, -6], [15, 0], LINEN);
      head(b);
      halo(b, -26);
      return;
    }
    case "summoner": {
      b.beginPath(); b.ellipse(1, 14, 18, 5, 0, 0, Math.PI * 2); b.strokeStyle = "#8fcaae"; b.lineWidth = 1.4; b.setLineDash([3, 3]); b.stroke(); b.setLineDash([]);
      torso(b, team, 15, 2);
      hemTrim(b, 15, 2);
      line(b, [[-1, -9], [0, 15]], GOLD, 1.3);
      belt(b, darker(team, 0.35), GOLD);
      staff(b, 16, -24);
      b.beginPath(); b.arc(16, -30, 6, 0, Math.PI * 2); b.strokeStyle = GOLD; b.lineWidth = 1.8; b.stroke();
      ellipse(b, 16, -30, 3.2, 3.2, "#c7e6b0", INK);
      arm(b, [6, -6], [15, 0], team);
      head(b);
      hood(b, darker(team, 0.25));
      line(b, [[-9, -19], [-3, -25]], GOLD, 1.2);
      return;
    }
    case "witch": {
      torso(b, darker(team, 0.2), 15, 2);
      hemTrim(b, 15, 2);
      belt(b, "#3f3441", GOLD);
      staff(b, 16, -24, 16, "#5b4a3a");
      b.beginPath(); b.arc(16, -29, 6, Math.PI * 0.35, Math.PI * 1.65); b.arc(18, -29, 4.6, Math.PI * 1.6, Math.PI * 0.4, true); b.closePath();
      b.fillStyle = "#ece0a6"; b.fill(); b.strokeStyle = INK; b.lineWidth = 1; b.stroke();
      arm(b, [6, -6], [15, 0], darker(team, 0.2));
      head(b);
      pointedHat(b, darker(team, 0.08));
      line(b, [[-5, -4], [0, 1], [-3, 5]], "#9b5a8c", 1.3);
      return;
    }
    case "golem": {
      ellipse(b, 1, 16, 23, 6.5, "#30483638");
      polygon(b, [[-14, 0], [-4, 0], [-5, 17], [-16, 17]], "#838f7c");
      polygon(b, [[5, 0], [15, 0], [17, 17], [5, 17]], "#bac1a3");
      polygon(b, [[-19, -15], [-8, -23], [13, -20], [20, 2], [1, 9], [-18, 0]], "#9ca990");
      polygon(b, [[-8, -23], [13, -20], [7, -9], [-11, -10]], "#d1d2b1");
      polygon(b, [[-25, -10], [-15, -13], [-13, 7], [-23, 8]], "#818d77");
      polygon(b, [[16, -11], [26, -6], [24, 10], [16, 7]], "#b5bca0");
      line(b, [[-23, -8], [-16, -10]], GOLD, 1.8);
      line(b, [[17, -9], [25, -5]], GOLD, 1.8);
      ellipse(b, 0, -2, 5.5, 5.5, "#6a7c68", INK);
      polygon(b, [[0, -6.5], [4, -2], [0, 2.5], [-4, -2]], EMBER_GLOW, darker(team, 0.1), 1);
      line(b, [[-6, -15], [4, -15]], team, 2.4);
      ellipse(b, -3, -18, 1.4, 1.4, EMBER_GLOW); ellipse(b, 5, -17, 1.4, 1.4, EMBER_GLOW);
      polygon(b, [[-12, -21], [-6, -26], [0, -22], [-8, -20]], MOSS, "transparent", 0);
      return;
    }
    case "emberRavager": {
      legs(b, "brace");
      torso(b, team, 8);
      line(b, [[-7, -8], [8, 6]], LEATHER_DARK, 2.6);
      line(b, [[6, -8], [-8, 6]], LEATHER_DARK, 2.6);
      belt(b, LEATHER_DARK);
      arm(b, [-6, -7], [-13, 2], SKIN, SKIN, 4.4);
      line(b, [[-12, -1], [-13, 1]], EMBER, 2.4);
      b.beginPath(); b.moveTo(13, 0); b.lineTo(15, -12); b.quadraticCurveTo(26, -20, 26, -8); b.lineTo(17, -4); b.closePath();
      b.fillStyle = "#cfd6c8"; b.fill(); b.strokeStyle = INK; b.lineWidth = 1.1; b.stroke();
      line(b, [[16, -12], [25.5, -9]], EMBER, 1.6);
      line(b, [[12, 3], [15, -12]], WOOD, 2.4);
      arm(b, [6, -7], [13, 1], SKIN, SKIN, 4.4);
      line(b, [[12, -2], [13.5, 0]], EMBER, 2.4);
      head(b);
      hornedCap(b);
      return;
    }
    case "cinderRunner": {
      for (const [y, x] of [[-4, -19], [3, -22], [10, -18]]) line(b, [[x!, y!], [x! + 7, y!]], "#9a948a", 1.2);
      legs(b, "stride");
      b.beginPath(); b.moveTo(-5, -11); b.bezierCurveTo(-12, -14, -18, -8, -26, -12); b.lineTo(-23, -6); b.bezierCurveTo(-16, -4, -11, -8, -4, -7); b.closePath();
      b.fillStyle = lighter(team, 0.1); b.fill(); b.strokeStyle = INK; b.lineWidth = 1; b.stroke();
      torso(b, team, 8, 0, 2);
      belt(b, ASH);
      blade(b, [-10, 2], [-17, -3], 2.2);
      arm(b, [-5, -6], [-10, 2], team);
      blade(b, [14, 1], [21, -6], 2.2);
      arm(b, [7, -6], [14, 1], team);
      head(b, SKIN, 2);
      hood(b, darker(team, 0.25));
      line(b, [[-3, -12], [6, -11]], ASH, 2.4);
      return;
    }
    case "sparkArcher": {
      quiver(b, ASH);
      ellipse(b, -9, -17, 2.4, 2.4, EMBER_GLOW);
      legs(b);
      torso(b, team);
      line(b, [[-7, -8], [7, 5]], ASH, 2.4);
      belt(b, ASH);
      arm(b, [6, -6], [12, -2], team);
      head(b);
      hood(b, ASH);
      line(b, [[-2, -20], [4.5, -18.5]], EMBER, 1.4);
      bow(b, 14, -3, 13, "#6b4b36", EMBER_GLOW);
      ellipse(b, 29, -4, 3.5, 3.5, "#f4c86e55");
      return;
    }
    case "emberAcolyte": {
      torso(b, LINEN, 15, 2);
      line(b, [[-8, -8], [9, 12]], team, 3.4);
      hemTrim(b, 15, 2);
      belt(b, "#b89c63", GOLD);
      staff(b, 16, -26);
      line(b, [[16, -26], [21, -28], [22, -24]], "#6b5a45", 1.6);
      ellipse(b, 22, -17, 6, 6, "#f4c86e40");
      polygon(b, [[19.5, -22], [24.5, -22], [25, -14], [19, -14]], EMBER_GLOW, GOLD, 1.2);
      line(b, [[22, -21], [22, -15]], EMBER, 1.4);
      arm(b, [6, -6], [15, 0], LINEN);
      head(b);
      line(b, [[-7, -19.5], [5, -19.5]], GOLD, 1.8);
      polygon(b, [[-1, -21], [0.5, -24.5], [2, -21]], EMBER, "transparent", 0);
      return;
    }
    case "ashHexer": {
      torso(b, ASH, 15, 2);
      line(b, [[-10.5, 11], [10.5, 11]], team, 2.4);
      hemTrim(b, 15, 2);
      belt(b, "#3a3632", GOLD);
      line(b, [[16, 16], [15, -8], [18, -16], [14, -24], [17, -29]], "#4f4238", 2.4);
      for (const [x, y, r] of [[19, -33, 3], [15, -37, 2.4], [20, -40, 1.8]]) ellipse(b, x!, y!, r!, r!, "#8f8a8266");
      ellipse(b, 17, -29, 2, 2, EMBER);
      arm(b, [6, -6], [15, -2], ASH);
      head(b);
      hood(b, darker(ASH, 0.2));
      polygon(b, [[-3, -20], [7, -19], [6, -10], [2, -8], [-2, -12]], "#e8dfc6", INK, 1);
      line(b, [[1, -16], [5, -16]], INK, 1.2);
      line(b, [[1, -12], [4, -9]], "#984e43", 1.2);
      return;
    }
    case "pyreCaller": {
      for (const a of [0.4, 2.5, 4.4]) polygon(b, [[Math.cos(a) * 18, 4 + Math.sin(a) * 6 - 3], [Math.cos(a) * 18 + 2, 4 + Math.sin(a) * 6], [Math.cos(a) * 18, 4 + Math.sin(a) * 6 + 3], [Math.cos(a) * 18 - 2, 4 + Math.sin(a) * 6]], EMBER_GLOW, EMBER, 0.8);
      torso(b, team, 15, 2);
      polygon(b, [[-9, -9], [8, -9], [10, -1], [-10, -1]], darker(team, 0.25));
      hemTrim(b, 15, 2);
      belt(b, darker(team, 0.4), GOLD);
      staff(b, 16, -23);
      polygon(b, [[10, -24], [22, -24], [19, -19], [13, -19]], GOLD, INK, 1);
      polygon(b, [[12, -24], [14, -31], [16, -28], [18, -35], [21, -24]], EMBER, "#9c4a36", 1);
      polygon(b, [[14.5, -24], [16.5, -29], [18.5, -24]], EMBER_GLOW, "transparent", 0);
      arm(b, [6, -6], [15, -1], team);
      head(b);
      line(b, [[-7, -19], [5, -19]], GOLD, 1.6);
      return;
    }
    case "mercenary": {
      legs(b);
      torso(b, LEATHER);
      for (const [x, y] of [[-5, -5], [0, -5], [4, -5], [-6, 0], [5, 0]]) ellipse(b, x!, y!, 0.9, 0.9, GOLD);
      line(b, [[-7, -8], [8, 6]], team, 2.6);
      belt(b, LEATHER_DARK, GOLD);
      blade(b, [14, 3], [19, -36], 4.6, "#d6ded0", "#f0f2e8");
      line(b, [[10, 3], [18, 3]], GOLD, 2.4);
      arm(b, [6, -6], [14, 2], LEATHER);
      head(b);
      polygon(b, [[-7.5, -17], [-6, -22], [0, -23.5], [6, -20.5], [6, -17.5]], team);
      line(b, [[-7, -18], [-12, -14]], team, 2);
      line(b, [[-2, -18], [4, -12]], "#9a6a55", 1);
      polygon(b, [[-12, -8], [-5, -10], [-4, 0], [-11, 1]], STEEL, INK, 1.1);
      ellipse(b, -1, -4, 2.4, 2.4, GOLD, "#8d7852");
      return;
    }
    case "contractArcher": {
      legs(b);
      torso(b, LEATHER, 12, 1);
      line(b, [[-8, -8], [8, -8]], team, 3);
      belt(b, LEATHER_DARK, GOLD);
      polygon(b, [[-13, 1], [-8, 0], [-7, 10], [-12, 11]], LEATHER_DARK, INK, 1);
      for (const x of [-12, -10]) line(b, [[x, 1], [x - 1, -4]], "#d8dfd0", 1.2);
      line(b, [[3, -1], [23, -3]], WOOD, 3);
      b.beginPath(); b.moveTo(21, -12); b.quadraticCurveTo(26, -3, 21, 6); b.strokeStyle = STEEL_DARK; b.lineWidth = 2.4; b.stroke();
      line(b, [[21, -12], [16, -3], [21, 6]], "#d6c494", 0.8);
      arm(b, [6, -6], [10, -1], LEATHER);
      head(b);
      ellipse(b, -1, -19.5, 12, 2.6, LEATHER_DARK, INK);
      polygon(b, [[-6, -20], [-5, -26], [3, -26.5], [5, -20]], LEATHER_DARK);
      line(b, [[-5, -21], [4.5, -21]], team, 1.6);
      line(b, [[-5, -24], [-13, -30]], "#e3d6a4", 1.6);
      ellipse(b, 5, -3, 2.2, 2.2, GOLD, "#8d7852");
      return;
    }
    case "fieldMedic": {
      legs(b);
      torso(b, LINEN, 12, 1);
      line(b, [[5, -8], [9, -3]], team, 3);
      belt(b, LEATHER_DARK, GOLD);
      line(b, [[-5, -9], [-12, 2]], "#856b46", 1.6);
      polygon(b, [[-17, 0], [-7, -1], [-6, 10], [-16, 11]], "#92764d", INK, 1);
      line(b, [[-11.5, 2], [-11.5, 8]], "#5d9a6b", 2.2);
      line(b, [[-14.5, 5], [-8.5, 5]], "#5d9a6b", 2.2);
      staff(b, 16, -20);
      polygon(b, [[13, -21], [19, -21], [19, -29], [16, -32], [13, -29]], "#b9dccf", INK, 1);
      line(b, [[16, -28], [16, -23]], "#5d9a6b", 1.4);
      arm(b, [6, -6], [15, 0], LINEN);
      head(b);
      polygon(b, [[-7, -17], [-6, -22.5], [0, -24], [6, -21], [6, -17.5]], team);
      ellipse(b, 3, 4, 2.2, 2.2, GOLD, "#8d7852");
      return;
    }
    case "spirit": {
      ellipse(b, 0, 1, 17, 18, "#8dc6ba33");
      polygon(b, [[0, -23], [12, -4], [5, 9], [0, 18], [-11, 3]], "#b6d8b8", team);
      polygon(b, [[0, -14], [5, 0], [-1, 9], [-6, 0]], "#f2f1c5", "transparent", 0);
      ellipse(b, -2, -1, 1.2, 1.5, INK); ellipse(b, 3, -1, 1.2, 1.5, INK);
      return;
    }
    case "wildling": {
      line(b, [[-4, 7], [-6, 15]], BARK, 3.4);
      line(b, [[4, 7], [6, 15]], BARK, 3.4);
      ellipse(b, 0, 0, 9, 10, BARK, INK);
      for (let i = 0; i < 5; i++) polygon(b, [[-9 + i * 4, 5], [-7 + i * 4, 12], [-5 + i * 4, 5]], i % 2 ? LEAF : MOSS, "transparent", 0);
      line(b, [[7, -1], [15, -12]], WOOD, 3);
      ellipse(b, 16, -14, 3.6, 3.6, "#6c5a3e", INK);
      ellipse(b, 8, -1, 2, 2, BARK, INK);
      ellipse(b, 2, -10, 6, 5.5, "#9a8a60", INK);
      for (const x of [2, 6]) ellipse(b, x, -10.5, 1.2, 1.2, "#f2dc6b");
      line(b, [[-3, -14], [-7, -20]], LEAF, 1.8);
      line(b, [[1, -15], [0, -21]], MOSS, 1.8);
      return;
    }
    case "mossGnawer": {
      b.beginPath(); b.moveTo(-12, 4); b.bezierCurveTo(-20, 2, -22, -8, -16, -10); b.strokeStyle = "#7a7458"; b.lineWidth = 2; b.stroke();
      for (const x of [-8, -3, 4, 8]) line(b, [[x, 6], [x - 1, 14]], "#5f5a44", 2.6);
      ellipse(b, 0, 3, 12, 7.5, "#7f8c62", INK);
      for (const x of [-8, -4, 0, 4]) polygon(b, [[x - 2, -3], [x, -8], [x + 2, -3]], MOSS, "transparent", 0);
      ellipse(b, 11, -1, 6, 5, "#909c73", INK);
      polygon(b, [[8, -5], [9, -10], [11, -5]], "#909c73", INK, 0.9);
      ellipse(b, 13, -2, 1, 1, INK);
      polygon(b, [[15, 2], [17, 2], [17, 6], [15, 5]], LINEN, INK, 0.7);
      return;
    }
    case "thornSlinger": {
      legs(b, "stand", BARK);
      torso(b, "#6f7f4f", 10);
      for (const x of [-9, -4, 1, 6]) polygon(b, [[x, -9], [x + 2, -13], [x + 3, -9]], "#9a8a55", "transparent", 0);
      belt(b, LEATHER_DARK);
      arm(b, [6, -6], [12, -2], "#6f7f4f", BARK);
      head(b, "#a8986a");
      hood(b, MOSS);
      leafMark(b, -8, -21, 3.2);
      bow(b, 15, -3, 16, "#5f6d3c", "#c9d59a");
      for (const y of [-12, 0, 10]) polygon(b, [[19, y], [23, y - 2], [21, y + 2]], "#9a8a55", "transparent", 0);
      return;
    }
    case "barkMender": {
      for (const [x, y] of [[-15, -8], [18, 4], [-12, 10]]) ellipse(b, x!, y!, 1.8, 1.8, "#c5e3a6");
      torso(b, BARK, 15, 2);
      for (const x of [-6, -1, 4]) line(b, [[x, -7], [x + (x < 0 ? -2 : 2), 13]], darker(BARK, 0.25), 0.9);
      belt(b, MOSS);
      staff(b, 16, -24, 16, "#6c5a3e");
      leafMark(b, 19, -27, 5, "#b9dc93");
      leafMark(b, 13, -25, 3.5, "#9fc47d");
      ellipse(b, 16, -26, 9, 9, "#c5e3a633");
      arm(b, [6, -6], [15, 0], BARK, "#a8986a");
      head(b, "#a8986a");
      for (const [x, y, s] of [[-7, -21, 4], [-2, -24, 4.5], [4, -22, 4]]) leafMark(b, x!, y!, s!, LEAF);
      return;
    }
    case "stonebackBrute": {
      ellipse(b, 1, 16, 22, 6, "#30483638");
      line(b, [[-8, 6], [-10, 16]], "#6f775f", 5);
      line(b, [[7, 6], [9, 16]], "#6f775f", 5);
      ellipse(b, -1, -2, 16, 13, "#8a9477", INK);
      polygon(b, [[-17, -4], [-12, -18], [-2, -21], [0, -12], [-9, -4]], "#b3b6a0", INK, 1.1);
      polygon(b, [[-5, -19], [5, -23], [10, -14], [1, -10]], "#a4a891", INK, 1.1);
      polygon(b, [[-12, -18], [-10, -24], [-7, -19]], MOSS, "transparent", 0);
      polygon(b, [[2, -22], [4, -28], [7, -22]], MOSS, "transparent", 0);
      line(b, [[10, -4], [16, 8]], "#7c866a", 6);
      ellipse(b, 17, 10, 4, 3.4, "#8a9477", INK);
      ellipse(b, 13, -9, 6.5, 5.5, "#9aa383", INK);
      ellipse(b, 15, -10, 1.1, 1.1, "#f2dc6b");
      polygon(b, [[16, -6], [18, -9], [19, -5]], LINEN, INK, 0.7);
      return;
    }
    case "gladeWitch": {
      torso(b, "#5f7250", 15, 3);
      polygon(b, [[-10, -9], [8, -9], [11, 1], [-12, 1]], MOSS);
      for (let i = 0; i < 4; i++) leafMark(b, -8 + i * 5, 1, 2.6, LEAF);
      belt(b, "#3f4b35");
      line(b, [[17, 16], [16, 0], [19, -12], [15, -22], [18, -30]], "#5b6b3e", 2.4);
      ellipse(b, 18, -32, 4, 4, "#e2a9a0", INK);
      ellipse(b, 18, -32, 1.5, 1.5, EMBER_GLOW);
      arm(b, [6, -6], [16, -2], "#5f7250", "#c9c9a0");
      head(b, "#c9c9a0");
      polygon(b, [[-9, -9], [-9, -18], [-3, -23], [5, -21], [8, -15], [5, -17], [-4, -18], [-6, -9]], "#6f6a55");
      line(b, [[-4, -21], [-8, -30], [-13, -33]], "#a59962", 1.8);
      line(b, [[-8, -30], [-5, -35]], "#a59962", 1.5);
      line(b, [[2, -22], [5, -31], [9, -35]], "#a59962", 1.8);
      line(b, [[5, -31], [2, -36]], "#a59962", 1.5);
      return;
    }
    case "ancientStag": {
      ellipse(b, 0, 17, 24, 6.5, "#30483638");
      for (const x of [-15, -8, 9, 15]) line(b, [[x, 5], [x - 2, 18]], "#898d6c", 2.6);
      ellipse(b, -2, 1, 19, 9.5, "#d3d0ac", INK);
      polygon(b, [[-17, -3], [-6, -9], [6, -8], [8, 1], [-12, 4]], MOSS, "transparent", 0);
      for (const x of [-13, -7, -1]) ellipse(b, x, 2, 1.6, 1.6, "#f2e9c7");
      polygon(b, [[8, 4], [6, -16], [11, -26], [19, -20], [22, -12], [16, -10], [17, 4]], "#e3dfbe");
      const antler = "#b79f5c";
      line(b, [[10, -24], [4, -32], [3, -42], [0, -46]], antler, 2.2);
      line(b, [[4, -32], [-3, -35], [-6, -42]], antler, 1.9);
      line(b, [[3, -40], [-2, -43]], antler, 1.6);
      line(b, [[15, -24], [21, -33], [21, -43], [25, -47]], antler, 2.2);
      line(b, [[21, -33], [28, -35], [31, -42]], antler, 1.9);
      line(b, [[21, -41], [26, -44]], antler, 1.6);
      for (const [x, y] of [[0, -46], [-6, -42], [25, -47], [31, -42]]) ellipse(b, x!, y!, 1.6, 1.6, EMBER_GLOW);
      ellipse(b, 16, -18, 1.4, 1.4, "#e8b94f");
      line(b, [[-20, 0], [-24, -5]], "#dad6b4", 3);
      return;
    }
  }
}

export function drawAtlasUnit(c: Brush, kind: UnitKind, point: Point, scale: number, color: string) {
  sprite(c, `u:${kind}:${color}`, point, scale, (b) => {
    const art = UNIT_ART[kind];
    if (art.bearing === "foot" && kind !== "wildling") ellipse(b, 2, 16, 17, 6, "#30483630");
    else if (kind === "wildling" || kind === "mossGnawer" || kind === "spirit") ellipse(b, 2, 15, 14, 5, "#30483630");
    paintUnit(b, kind, color);
  });
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
    drawAtlasBuilding(b, { frame: "town-hall", marks: [] }, { x: -10, y: -46 }, 225, "#3d7169");
    drawAtlasBuilding(b, { frame: "tower-spire", marks: [] }, { x: -143, y: 39 }, 98, "#3d7169");
    drawAtlasBuilding(b, { frame: "farm-plot", marks: [] }, { x: 105, y: 41 }, 100, "#4c7766");
    drawAtlasBuilding(b, { frame: "barracks-yard", marks: [] }, { x: -45, y: 110 }, 110, "#3d7169");
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
