/** Canvas primitives and scenery accents. Anatomy, equipment and surfaces live in their dedicated modules. */
export type Point = { x: number; y: number };

export type Brush = CanvasRenderingContext2D;

export const INK = "#293c35";

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

export const WOOD = "#7a6547";

export const EMBER = "#e07a45";

export const EMBER_GLOW = "#f4c86e";

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

export function leafMark(b: Brush, x: number, y: number, size: number, fill = LEAF) {
  polygon(b, [[x, y - size], [x + size * 0.6, y], [x, y + size], [x - size * 0.6, y]], fill, darker(fill, 0.35), 0.8);
  line(b, [[x, y - size * 0.8], [x, y + size]], darker(fill, 0.4), 0.7);
}
