import type { BuildingGlyph } from "./building-glyphs";
import type { UnitGlyph } from "./glyphs";
import { unitVisualProfile, type UnitVisualProfile } from "./unit-visual-profile";
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

export function drawAtlasUnit(c: Brush, kind: UnitKind, glyph: UnitGlyph, point: Point, scale: number, color: string) {
  const profile = unitVisualProfile(kind);
  const visualScale = scale * Math.min(1.4, profile.bodyScale);
  if (kind === "emberRavager") drawEmberRavager(c, point, visualScale, color, profile);
  else if (kind === "knight") drawKnight(c, point, visualScale, color, profile);
  else drawAtlasUnitLegacy(c, kind, glyph, point, visualScale, color, profile);
  drawUnitTierBadge(c, point, visualScale, profile);
}

function drawAtlasUnitLegacy(c: Brush, kind: UnitKind, glyph: UnitGlyph, point: Point, scale: number, color: string, profile: UnitVisualProfile) {
  sprite(c, `u:${kind}:${glyph.silhouette}:${glyph.marks.join()}:${color}:${profile.tier}`, point, scale, (b) => {
    const shape = glyph.silhouette;
    const mark = (name: UnitGlyph["marks"][number]) => glyph.marks.includes(name);
    ellipse(b, 2, 16, 17, 6, "#30483630");
    if (shape === "wildling-thorns" && mark("visor")) {
      for (const x of [-13, -6, 9, 15]) line(b, [[x, 7], [x - 2, 18]], "#898d6c", 2.4);
      ellipse(b, -2, 1, 18, 9, "#d3d0ac", INK);
      polygon(b, [[8, 4], [6, -16], [11, -26], [19, -20], [22, -12], [16, -10], [17, 4]], "#e3dfbe");
      line(b, [[10, -24], [4, -32], [3, -41], [0, -44]], "#a59962", 2);
      line(b, [[4, -32], [-3, -35], [-5, -41]], "#a59962", 1.8);
      line(b, [[15, -24], [21, -33], [21, -42], [25, -45]], "#a59962", 2);
      line(b, [[21, -33], [28, -35], [30, -41]], "#a59962", 1.8);
      ellipse(b, 16, -18, 1.3, 1.3, INK);
      line(b, [[-18, 0], [-22, -5]], "#dad6b4", 3);
      for (const x of [-11, -5, 1]) ellipse(b, x, -2, 1.6, 1.6, "#f2e9c7");
      return;
    }
    if (shape === "spirit-wisp") {
      ellipse(b, 0, 1, 17, 18, "#8dc6ba33");
      polygon(b, [[0, -23], [12, -4], [5, 9], [0, 18], [-11, 3]], "#b6d8b8", color);
      polygon(b, [[0, -14], [5, 0], [-1, 9], [-6, 0]], "#f2f1c5", "transparent", 0);
      ellipse(b, -2, -1, 1.2, 1.5, INK); ellipse(b, 3, -1, 1.2, 1.5, INK);
      return;
    }
    if (shape === "golem-block" || mark("blockSeams")) {
      polygon(b, [[-13, 0], [-4, 0], [-5, 16], [-15, 16]], "#838f7c");
      polygon(b, [[5, 0], [14, 0], [16, 16], [5, 16]], "#bac1a3");
      polygon(b, [[-18, -14], [-8, -21], [12, -18], [19, 2], [1, 8], [-17, 0]], "#9ca990");
      polygon(b, [[-8, -21], [12, -18], [7, -8], [-11, -9]], "#d1d2b1");
      polygon(b, [[-23, -9], [-15, -11], [-13, 6], [-22, 6]], "#818d77");
      polygon(b, [[15, -9], [24, -5], [22, 9], [15, 6]], "#b5bca0");
      line(b, [[-3, -2], [2, -6], [5, 0], [0, 4], [-3, -2]], color, 2);
      line(b, [[-5, -14], [3, -14]], "#ecda93", 2);
      if (mark("thornFork")) {
        polygon(b, [[-20, -12], [-23, -23], [-14, -20], [-11, -29], [-4, -22], [2, -28], [8, -20], [18, -20], [19, -9], [10, -13], [1, -18], [-9, -13]], "#758958", "#556d48");
        line(b, [[-15, -15], [-17, -3], [-8, 3], [-11, 11]], "#59704b", 2.4);
        polygon(b, [[12, -4], [23, -3], [22, 10], [16, 14], [12, 8]], "#7c9162", "#596e4a");
      }
      return;
    }
    const mounted = shape === "raider-kite" || shape === "lancer-pennant" || shape === "knight-helm";
    if (mounted) {
      polygon(b, [[-17, 3], [7, -2], [19, 3], [15, 12], [-12, 12]], "#a79a77");
      polygon(b, [[8, 1], [8, -12], [14, -18], [23, -10], [21, -5], [16, -6], [19, 6]], "#c7b28a");
      line(b, [[13, -16], [10, -10], [11, 2]], "#5e5b44", 3);
      for (const x of [-13, -6, 10, 16]) line(b, [[x, 10], [x - 2, 18]], "#5e5b44", 2.6);
      ellipse(b, 18, -10, 1, 1, INK);
      line(b, [[-17, 4], [-23, 9]], "#5e5b44", 3);
      b.translate(-3, -7);
    } else {
      line(b, [[-5, 9], [-7, 16]], "#554f3b", 4);
      line(b, [[5, 9], [7, 16]], "#554f3b", 4);
    }
    const worker = shape === "worker-apron";
    const wild = shape === "wildling-thorns";
    const mage = ["priest-medallion", "summoner-ring", "witch-crescent"].includes(shape) || mark("halo") && wild;
    const cloth = wild ? "#7d8b57" : worker ? "#b7a176" : unitMaterialColor(profile, color);
    polygon(b, [[-8, -9], [7, -9], [12, mage ? 15 : 9], [-12, mage ? 15 : 9]], cloth);
    polygon(b, [[-8, -8], [-1, -7], [-3, 11], [-12, 10]], "#243f3d33", "transparent", 0);
    line(b, [[-8, 5], [9, 5]], "#e0cb8f", 2);
    ellipse(b, -1, -15, 6, 7, "#ddc29a", INK);
    if (worker) {
      polygon(b, [[-11, -19], [-7, -24], [3, -25], [8, -19]], color);
      line(b, [[-12, -18], [10, -18]], INK, 2.2);
      polygon(b, [[-5, -7], [4, -7], [6, 7], [-7, 7]], "#ddcda2");
    } else if (shape === "witch-crescent" || mark("crescent")) {
      polygon(b, [[-12, -18], [0, -34], [7, -19], [12, -16]], color);
      line(b, [[-6, -23], [4, -23]], GOLD, 2);
    } else if (mage) {
      polygon(b, [[-8, -14], [-7, -23], [-1, -28], [6, -22], [7, -14], [0, -21]], color);
    } else if (shape === "bow-crest" || mark("bow")) {
      polygon(b, [[-8, -12], [-9, -22], [0, -27], [8, -20], [7, -12], [2, -20]], color);
    } else if (wild) {
      polygon(b, [[-9, -14], [-13, -29], [-5, -23], [0, -27], [5, -22], [12, -28], [8, -12]], "#758556");
      line(b, [[-10, -25], [-16, -29]], "#a4a779", 2);
      line(b, [[9, -25], [15, -30]], "#a4a779", 2);
    } else {
      polygon(b, [[-8, -14], [-8, -22], [-1, -26], [7, -22], [8, -14]], "#aebeb1");
      line(b, [[-5, -17], [5, -17]], "#263d36", 2.3);
      line(b, [[-1, -25], [-1, -30]], color, 3.5);
    }
    if (mark("pick")) {
      line(b, [[9, 10], [21, -20]], "#78684d", 2.6);
      line(b, [[11, -20], [21, -23], [28, -17]], "#a8b7ab", 3);
    } else if (mark("bow")) {
      b.beginPath(); b.ellipse(15, -3, 8, 18, -0.12, -Math.PI / 2, Math.PI / 2); b.strokeStyle = "#846c45"; b.lineWidth = 2.6; b.stroke();
      line(b, [[13, -21], [16, 15]], "#d6c494", 0.8);
      line(b, [[5, -1], [28, -4]], "#5e6049", 1.5);
      polygon(b, [[27, -7], [32, -4], [27, -1]], "#bcc5b0");
    } else if (mark("longSpear") || mage || mark("cross") || mark("outerRing")) {
      line(b, [[17, 15], [17, -29]], "#796849", 2.4);
      if (mark("longSpear")) polygon(b, [[14, -28], [17, -38], [20, -28]], "#d2daca");
      else { ellipse(b, 17, -28, 5, 6, mark("spark") && !mark("innerSigil") ? "#edb873" : "#c5d9a7", color); }
      if (mark("cross")) line(b, [[11, -27], [23, -27]], GOLD, 2);
      if (mark("flag")) flag(b, 17, -26, color, 0.5);
    } else {
      line(b, [[12, 8], [20, -14]], "#6d644c", 2.5);
      polygon(b, [[18, -12], [23, -25], [23, -11], [14, 8]], "#d4ddcd");
      line(b, [[11, 3], [20, 6]], GOLD, 2.4);
    }
    if (mark("shieldBar") || mark("towerShield") || mark("scar")) {
      polygon(b, [[-18, -5], [-7, -8], [-6, 6], [-12, 13], [-18, 8]], color);
      line(b, [[-16, -3], [-9, -5], [-9, 5], [-12, 9], [-16, 6], [-16, -3]], "#dec48b", 1);
    }
    if (mark("satchel")) { ellipse(b, -12, 5, 4, 5, "#92764d", INK); line(b, [[-5, -9], [-12, 3]], "#856b46", 1.6); }
    if (mark("halo")) { b.beginPath(); b.ellipse(-1, -30, 9, 3, 0, 0, Math.PI * 2); b.strokeStyle = GOLD; b.lineWidth = 1.5; b.stroke(); }
    if (mark("coinSlash")) ellipse(b, -2, 0, 2.4, 2.4, GOLD, "#8d7852");
    if (mark("spark")) polygon(b, [[-2, -2], [1, -8], [4, -2], [1, 2]], "#f0c774", "transparent", 0);
    if (mark("innerSigil")) line(b, [[-4, -2], [0, -5], [4, -1], [0, 3], [-4, -2]], "#c5dcc0", 1);
    if (mark("rune")) line(b, [[-4, 1], [0, -5], [4, 1], [-4, 1]], "#efc89a", 1);
    if (mark("curseSlash")) line(b, [[-4, -17], [1, -12]], "#984e43", 1.5);
    if (mark("towerShield")) polygon(b, [[-18, -8], [-8, -11], [-7, 11], [-17, 14]], color, GOLD, 1);
  });
}

function unitMaterialColor(profile: UnitVisualProfile, fallback: string) {
  if (profile.accent === "ember") return "#a85c43";
  if (profile.accent === "brass") return "#b58b4f";
  if (profile.accent === "wild") return "#71875b";
  if (profile.accent === "grove") return fallback === "#a85644" ? "#a85c43" : "#467d6c";
  return fallback;
}

function drawEmberRavager(c: Brush, point: Point, scale: number, color: string, profile: UnitVisualProfile) {
  sprite(c, `u:emberRavager:bruiser:${color}:${profile.tier}`, point, scale, (b) => {
    ellipse(b, 0, 18, 18, 6, "#5b352d42");
    line(b, [[-8, 7], [-10, 18]], "#543d35", 4);
    line(b, [[7, 7], [10, 18]], "#543d35", 4);
    polygon(b, [[-13, -7], [-3, -14], [11, -9], [14, 10], [2, 17], [-15, 9]], "#8e4c3e", "#3d4036", 1.8);
    polygon(b, [[-16, -8], [-25, -3], [-17, 6], [-8, 1]], "#b96946", "#493a31", 1.4);
    polygon(b, [[7, -10], [19, -8], [24, 0], [14, 7], [7, 1]], "#c37148", "#493a31", 1.4);
    line(b, [[-10, 1], [8, 3]], "#e6b45f", 1.8);
    ellipse(b, -2, -18, 7, 8, "#d69a6d", "#443a32");
    polygon(b, [[-11, -19], [-7, -29], [1, -34], [11, -27], [10, -17], [2, -23], [-3, -20]], "#4b3e3a", "#352f2d", 1.5);
    polygon(b, [[-2, -21], [5, -22], [7, -17], [1, -15]], "#efb65d", "#754139", 1);
    ellipse(b, 3, -19, 1.3, 1.2, "#f6d58a");
    line(b, [[12, 10], [29, -22]], "#70523c", 3);
    polygon(b, [[25, -28], [35, -36], [32, -24], [39, -17], [27, -18]], "#d5d9b2", "#3d4036", 1.2);
    polygon(b, [[28, -18], [38, -11], [31, -5], [24, -12]], "#e77643", "#873f35", 1);
    polygon(b, [[-8, -2], [-4, -12], [0, -6], [4, -14], [8, -2], [2, 5]], "#f0c46d", "#a6523e", 1);
    line(b, [[-15, -14], [-19, -21]], "#e6a35b", 2);
    line(b, [[15, -17], [20, -23]], "#e6a35b", 2);
  });
}

function drawKnight(c: Brush, point: Point, scale: number, color: string, profile: UnitVisualProfile) {
  sprite(c, `u:knight:heavy:${color}:${profile.tier}`, point, scale, (b) => {
    ellipse(b, 2, 21, 27, 8, "#30483642");
    polygon(b, [[-22, 2], [5, -3], [25, 4], [19, 15], [-15, 16]], "#9b8d6e", "#4b5144", 1.7);
    polygon(b, [[13, 1], [16, -14], [25, -17], [31, -8], [27, 1], [20, 8]], "#c2b897", "#4b5144", 1.5);
    line(b, [[22, -15], [19, -3], [22, 6]], "#545c4d", 3);
    for (const x of [-17, -8, 11, 20]) line(b, [[x, 11], [x - 2, 22]], "#4d5142", 3);
    polygon(b, [[-12, -10], [13, -12], [17, 12], [-13, 11]], "#798c85", "#39463f", 1.8);
    polygon(b, [[-11, -10], [-2, -18], [10, -16], [13, -12]], "#c4d0bb", "#4b5d50", 1.2);
    line(b, [[-8, -4], [11, -4]], "#d6b267", 1.8);
    polygon(b, [[-21, -4], [-9, -9], [-8, 13], [-16, 18], [-22, 10]], "#a2b4a0", "#3f594d", 1.6);
    line(b, [[-19, -2], [-11, -5], [-12, 9], [-17, 13], [-19, -2]], "#e1c67c", 1.4);
    polygon(b, [[9, -13], [11, -25], [18, -31], [25, -23], [24, -12]], "#aabaae", "#39463f", 1.4);
    line(b, [[17, -27], [15, -40]], "#d9c27b", 2.2);
    polygon(b, [[13, -40], [17, -51], [21, -40]], "#d4b168", "#4b5144", 1);
    line(b, [[29, -13], [42, -35]], "#6e5940", 2.4);
    polygon(b, [[39, -42], [46, -54], [48, -39], [43, -30]], "#dce2ca", "#4b5144", 1.2);
    flag(b, 29, -31, "#bd9855", 0.55);
  });
}

function drawUnitTierBadge(c: Brush, point: Point, scale: number, profile: UnitVisualProfile) {
  if (profile.tier < 3) return;
  const color = profile.accent === "ember" ? "#d9784a" : profile.accent === "wild" ? "#84996a" : profile.accent === "brass" ? GOLD : "#72a391";
  const pipCount = Math.min(3, profile.tier - 2);
  c.save();
  c.translate(point.x + 21 * scale, point.y - 37 * scale);
  c.scale(scale, scale);
  for (let index = 0; index < pipCount; index += 1) {
    const x = (index - (pipCount - 1) / 2) * 7;
    polygon(c, [[x, -3], [x + 3, 0], [x, 3], [x - 3, 0]], color, "#36473e", 0.7);
  }
  c.restore();
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
    for (let i = 0; i < 5; i++) drawAtlasUnit(b, "footman", { silhouette: "shield-triangle", marks: ["shieldBar", "shortSword"] }, { x: -95 + (i % 3) * 31, y: 192 + Math.floor(i / 3) * 31 }, 1.02, "#3e7369");
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
