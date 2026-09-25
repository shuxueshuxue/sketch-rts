// The drawing kit every painter shares: canvas primitives, the palette, the humanoid rig (feet at y=16, head at
// (-1,-15)), headgear, mounts and building parts. Unit and building cards paint with these.
export type Point = { x: number; y: number };
export type Brush = CanvasRenderingContext2D;
export const INK = "#35483c";
export const GOLD = "#cfab62";

export function polygon(c: Brush, points: number[][], fill: string, stroke = INK, width = 1.4) {
  c.beginPath();
  points.forEach(([x, y], i) => i ? c.lineTo(x!, y!) : c.moveTo(x!, y!));
  c.closePath();
  c.fillStyle = fill;
  c.fill();
  if (width) { c.strokeStyle = stroke; c.lineWidth = width; c.stroke(); }
}

export function ellipse(c: Brush, x: number, y: number, rx: number, ry: number, fill: string, stroke?: string) {
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  c.fillStyle = fill;
  c.fill();
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1.2; c.stroke(); }
}

export function line(c: Brush, points: number[][], color = INK, width = 1.4) {
  c.beginPath();
  points.forEach(([x, y], i) => i ? c.lineTo(x!, y!) : c.moveTo(x!, y!));
  c.strokeStyle = color;
  c.lineWidth = width;
  c.stroke();
}

export function flag(c: Brush, x: number, y: number, color: string, size = 1) {
  line(c, [[x, y + 18 * size], [x, y - 11 * size]], INK, 1.6);
  polygon(c, [[x, y - 11 * size], [x + 18 * size, y - 8 * size], [x + 13 * size, y - 3 * size], [x, y - 4 * size]], color);
  ellipse(c, x, y - 12 * size, 1.7, 1.7, GOLD);
}

export function house(c: Brush, x: number, y: number, size: number, color: string) {
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

export function tower(c: Brush, x: number, y: number, size: number, color: string) {
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

export const SKIN = "#ddc29a";
export const STEEL = "#c3cdc2";
export const STEEL_DARK = "#7f8e86";
export const LEATHER = "#8d6c47";
export const LEATHER_DARK = "#5f4b35";
export const WOOD = "#7a6547";
export const LINEN = "#e6d9b4";
export const BOOT = "#554f3b";
export const EMBER = "#e07a45";
export const EMBER_GLOW = "#f4c86e";
export const ASH = "#5f5a54";
export const BARK = "#8a7a52";
export const MOSS = "#6f8756";
export const LEAF = "#8fae6d";
export type XY = [number, number];

export function mix(hex: string, target: number, amount: number) {
  if (!/^#[0-9a-f]{6}/i.test(hex)) return hex;
  const n = parseInt(hex.slice(1, 7), 16);
  const channel = (shift: number) => Math.round(((n >> shift) & 255) * (1 - amount) + target * amount);
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}
export const darker = (hex: string, amount = 0.3) => mix(hex, 0, amount);
export const lighter = (hex: string, amount = 0.35) => mix(hex, 255, amount);

// ---- Humanoid rig: feet at y=16, hips y=8, shoulders y=-9, head at (-1,-15).
export function legs(b: Brush, stance: "stand" | "brace" | "stride" = "stand", color = BOOT) {
  const pairs = stance === "brace" ? [[-4, 8, -9, 16], [4, 8, 9, 16]]
    : stance === "stride" ? [[-3, 7, -12, 13], [4, 7, 11, 16]]
    : [[-5, 8, -6, 16], [5, 8, 6, 16]];
  for (const [x1, y1, x2, y2] of pairs) {
    line(b, [[x1!, y1!], [x2!, y2!]], color, 4);
    ellipse(b, x2! + 1.2, y2! + 0.6, 3, 1.6, "#3f3a2c");
  }
}

export function torso(b: Brush, fill: string, hem = 9, flare = 0, lean = 0) {
  polygon(b, [[-8 + lean, -9], [7 + lean, -9], [11 + flare, hem], [-11 - flare, hem]], fill);
  polygon(b, [[-8 + lean, -8], [-1 + lean, -7], [-3, hem - 1], [-11 - flare, hem - 1]], "#243f3d2e", "transparent", 0);
}

export function hemTrim(b: Brush, hem: number, flare = 0, color = GOLD) {
  line(b, [[-10.5 - flare, hem - 1.6], [10.5 + flare, hem - 1.6]], color, 1.8);
}

export function quilting(b: Brush, fill: string) {
  for (const x of [-5, -1, 3]) line(b, [[x, -7], [x + (x < 0 ? -1.5 : 1.5), 7]], darker(fill, 0.22), 0.8);
}

export function belt(b: Brush, color = LEATHER_DARK, buckle?: string) {
  line(b, [[-9.5, 3], [9.5, 3]], color, 2.4);
  if (buckle) polygon(b, [[-1, 1.4], [2, 1.4], [2, 4.6], [-1, 4.6]], buckle, INK, 0.8);
}

export function arm(b: Brush, from: XY, to: XY, sleeve: string, hand = SKIN, width = 3.6) {
  line(b, [from, to], sleeve, width);
  ellipse(b, to[0], to[1], 2.1, 2.1, hand, INK);
}

export function head(b: Brush, skin = SKIN, dx = 0) {
  ellipse(b, -1 + dx, -15, 6, 7, skin, INK);
  ellipse(b, 2.4 + dx, -15.5, 0.9, 1.1, INK);
}

export function blade(b: Brush, from: XY, to: XY, width: number, fill = "#d6ded0", edge?: string) {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const length = Math.hypot(dx, dy) || 1;
  const px = -dy / length * width / 2, py = dx / length * width / 2;
  polygon(b, [[from[0] + px, from[1] + py], [to[0] - dx / length * width + px * 0.8, to[1] - dy / length * width + py * 0.8], to, [from[0] - px, from[1] - py]], fill, INK, 1);
  if (edge) line(b, [[from[0] - px * 0.8, from[1] - py * 0.8], [to[0] - px * 0.2, to[1] - py * 0.2]], edge, 1.2);
  line(b, [[from[0] + px * 2.2, from[1] + py * 2.2], [from[0] - px * 2.2, from[1] - py * 2.2]], STEEL_DARK, 2.2);
}

export function spear(b: Brush, butt: XY, tip: XY, headLength = 8, shaft = WOOD) {
  const dx = tip[0] - butt[0], dy = tip[1] - butt[1];
  const length = Math.hypot(dx, dy);
  const base: XY = [tip[0] - dx / length * headLength, tip[1] - dy / length * headLength];
  line(b, [butt, base], shaft, 2.2);
  const px = -dy / length * 2.6, py = dx / length * 2.6;
  polygon(b, [[base[0] + px, base[1] + py], tip, [base[0] - px, base[1] - py]], "#d8dfd0", INK, 1);
}

export function pennant(b: Brush, x: number, y: number, color: string, size = 1) {
  polygon(b, [[x, y], [x - 13 * size, y + 2 * size], [x - 9 * size, y + 5 * size], [x - 13 * size, y + 8 * size], [x, y + 8 * size]], color, INK, 1);
}

export function bow(b: Brush, x: number, y: number, height: number, color = "#846c45", arrowTip = "#bcc5b0") {
  b.beginPath(); b.ellipse(x, y, 7, height, -0.1, -Math.PI / 2, Math.PI / 2); b.strokeStyle = color; b.lineWidth = 2.6; b.stroke();
  line(b, [[x - 2, y - height], [x + 1, y + height]], "#d6c494", 0.8);
  line(b, [[x - 10, y + 1], [x + 12, y - 1]], "#5e6049", 1.5);
  polygon(b, [[x + 11, y - 4], [x + 16, y - 1], [x + 11, y + 2]], arrowTip);
}

export function quiver(b: Brush, fill = LEATHER) {
  polygon(b, [[-12, -12], [-7, -14], [-2, 4], [-7, 6]], fill, INK, 1.1);
  for (const x of [-11, -9, -7]) line(b, [[x, -13], [x - 2, -19]], "#e9e0c4", 1.5);
}

export function roundShield(b: Brush, x: number, y: number, r: number, fill: string, band?: string) {
  ellipse(b, x, y, r * 0.85, r, fill, INK);
  if (band) line(b, [[x - r * 0.6, y - r * 0.5], [x + r * 0.6, y + r * 0.5]], band, 2.6);
  ellipse(b, x, y, r * 0.28, r * 0.3, STEEL_DARK, INK);
}

export function kiteShield(b: Brush, x: number, y: number, w: number, h: number, fill: string, rim: string) {
  const pts = [[x - w / 2, y - h * 0.45], [x + w / 2, y - h * 0.55], [x + w / 2, y + h * 0.1], [x, y + h * 0.5], [x - w / 2, y + h * 0.15]];
  polygon(b, pts, fill, INK, 1.3);
  polygon(b, pts.map(([px, py]) => [x + (px! - x) * 0.72, y + (py! - y) * 0.72]), "transparent", rim, 1.1);
}

export function leafMark(b: Brush, x: number, y: number, size: number, fill = LEAF) {
  polygon(b, [[x, y - size], [x + size * 0.6, y], [x, y + size], [x - size * 0.6, y]], fill, darker(fill, 0.35), 0.8);
  line(b, [[x, y - size * 0.8], [x, y + size]], darker(fill, 0.4), 0.7);
}

export function staff(b: Brush, x: number, top: number, bottom = 16, color = WOOD) {
  line(b, [[x, bottom], [x, top]], color, 2.3);
}

export function halo(b: Brush, y = -27, color = GOLD) {
  b.beginPath(); b.ellipse(-1, y, 8.5, 2.6, 0, 0, Math.PI * 2); b.strokeStyle = color; b.lineWidth = 1.5; b.stroke();
}

export function capeBehind(b: Brush, color: string, trim = GOLD) {
  polygon(b, [[-7, -10], [5, -10], [1, 2], [-6, 17], [-19, 15], [-15, 0]], darker(color, 0.12));
  line(b, [[-6, 16.5], [-19, 14.5]], trim, 1.6);
}

// ---- Headgear
export function kettleHelm(b: Brush) {
  polygon(b, [[-7, -17.5], [-6, -23], [-1, -25.5], [5, -23], [6, -17.5]], STEEL, INK, 1.2);
  ellipse(b, -0.5, -17.8, 10, 2.3, STEEL_DARK, INK);
}

export function skullCap(b: Brush) {
  polygon(b, [[-7.5, -15], [-6.5, -21.5], [-1, -24], [5, -21.5], [6, -17], [-1, -18.5]], STEEL_DARK, INK, 1.2);
}

export function hood(b: Brush, fill: string) {
  polygon(b, [[-10, -8], [-9.5, -20], [-3, -25.5], [5, -24], [8.5, -17], [7, -10.5], [4.5, -18.5], [-2, -20], [-5, -11]], fill);
}

export function pointedHat(b: Brush, fill: string, band = GOLD) {
  ellipse(b, -1, -19.5, 11.5, 2.6, darker(fill, 0.1), INK);
  polygon(b, [[-8, -20], [-4, -30], [-1, -38], [8, -35], [3, -31], [7, -20]], fill);
  line(b, [[-7.5, -21.5], [6.8, -21.5]], band, 1.8);
}

export function plumedHelm(b: Brush, plume: string) {
  b.beginPath(); b.moveTo(-1, -24); b.bezierCurveTo(-4, -34, -14, -34, -17, -26); b.bezierCurveTo(-12, -29, -7, -28, -4, -22);
  b.closePath(); b.fillStyle = plume; b.fill(); b.strokeStyle = INK; b.lineWidth = 1; b.stroke();
  polygon(b, [[-7.5, -9.5], [-7.5, -21], [-1, -25], [6.5, -21.5], [7, -9.5]], STEEL, INK, 1.3);
  polygon(b, [[-7, -20], [-1, -24], [6, -21], [-1, -19]], "#e6ece0", "transparent", 0);
  line(b, [[0, -16.5], [6.6, -16.5]], INK, 1.8);
  line(b, [[-1, -24.5], [-1, -10]], GOLD, 1.2);
  for (const y of [-13, -11]) line(b, [[3, y], [6, y]], INK, 0.7);
}

export function hornedCap(b: Brush) {
  polygon(b, [[-7.5, -16], [-6.5, -22], [-1, -24.5], [5, -22], [6, -16.5], [-1, -19]], LEATHER_DARK, INK, 1.1);
  polygon(b, [[-6, -21], [-13, -24], [-15, -31], [-10, -26], [-5, -24]], "#e4dcc0", INK, 1);
  polygon(b, [[4, -22], [10, -26], [12, -33], [13, -25], [6, -19]], "#e4dcc0", INK, 1);
}

// ---- Mounts: horse at the origin, rider drawn after translating up.
export function horse(b: Brush, coat: string, size: number, dress?: { cloth: string; trim: string }) {
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

export function riderLeg(b: Brush, color = BOOT) {
  line(b, [[1, 7], [4, 15]], color, 3.6);
  ellipse(b, 5, 15.5, 2.6, 1.4, "#3f3a2c");
}
