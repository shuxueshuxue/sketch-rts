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
