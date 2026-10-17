import type { Obstacle, TerrainLandmark } from "../../shared/types";
import { type Brush, type Point, ellipse, line, polygon } from "./kit";

/** Static scenery painters: geometry and detail, independent of atlas caching. */
// @@@tree-art - A tree of the inked atlas, its foot at (x, y): a pine (tiered, drooping boughs) or a broadleaf (a cloud of
// lobes), one ink line round the whole crown, the lit side toward the upper left and a soft contact shadow to the lower
// right (docs/art-direction-variants.zh.md, rules 5, 6 and 9). `rim` trees stand at a wood's edge: bigger and lighter
// than the ones inside, so a forest reads as a mass with a drawn edge rather than a carpet of one tree.
export type TreeKind = "pine" | "broadleaf";
const TREE_INK = "#293c35";
const CROWN = { pine: { base: "#526c4a", dark: "#3c5239", light: "#7a9466" }, broadleaf: { base: "#5f7a49", dark: "#45603a", light: "#8ea468" } };
export function paintTree(c: Brush, x: number, y: number, size: number, tone = 0, kind: TreeKind = tone % 3 === 2 ? "broadleaf" : "pine", rim = true) {
  const crown = CROWN[kind];
  const base = rim ? crown.base : crown.dark, lit = rim ? crown.light : crown.base;
  c.save(); c.translate(x, y); c.scale(size, size);
  c.fillStyle = "#1d261b"; c.globalAlpha = .22; c.beginPath(); c.ellipse(10, 1, 19, 6.5, -.15, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1;
  c.fillStyle = "#6b5a40"; c.fillRect(-1.8, -9, 3.6, 10); c.strokeStyle = TREE_INK; c.lineWidth = .9 / size; c.strokeRect(-1.8, -9, 3.6, 10);
  const sway = Math.sin(tone * 2.3) * 1.2;
  // The crown's silhouette: stroked wide in ink, then filled, so only its outer edge keeps a line.
  // (A path rebuilt per use, not a Path2D: the headless recorder's canvas has none.)
  const silhouette = () => {
    c.beginPath();
    if (kind === "pine") {
      for (let tier = 0; tier < 4; tier++) {
        const yy = -6 - tier * 10, span = 15 - tier * 3.2, top = yy - 17;
        c.moveTo(sway * tier / 3, top);
        c.lineTo(-span * .55, yy - 5); c.lineTo(-span, yy + 1); c.lineTo(-span * .5, yy - 1);
        c.lineTo(-span * .15, yy + 2); c.lineTo(span * .3, yy - 1); c.lineTo(span, yy + 1);
        c.lineTo(span * .55, yy - 5); c.closePath();
      }
    } else {
      const lobes: [number, number, number][] = [[-8, -17, 9], [8, -18, 9.5], [0, -27, 10], [-4, -11, 8], [6, -10, 7.5], [-10, -26, 6.5], [9, -28, 6.5]];
      for (const [bx, by, r] of lobes) { c.moveTo(bx + r, by); c.arc(bx, by, r, 0, Math.PI * 2); }
    }
  };
  silhouette(); c.strokeStyle = TREE_INK; c.lineWidth = 2.5 / size; c.lineJoin = "round"; c.stroke();
  c.fillStyle = base; c.fill("nonzero");
  c.save(); silhouette(); c.clip("nonzero");
  // Shade: the lower right of the crown a step darker; light: the upper left a step lighter.
  c.fillStyle = crown.dark; c.globalAlpha = rim ? .55 : .35;
  c.beginPath(); c.ellipse(9, -6, 15, 20, -.5, 0, Math.PI * 2); c.fill();
  c.fillStyle = lit; c.globalAlpha = .9;
  if (kind === "pine") for (let tier = 0; tier < 4; tier++) {
    const yy = -6 - tier * 10, span = 15 - tier * 3.2;
    c.beginPath(); c.moveTo(sway * tier / 3, yy - 16); c.lineTo(-span * .8, yy); c.lineTo(-span * .2, yy - 2); c.closePath(); c.fill();
  } else for (const [bx, by, r] of [[-9, -19, 5], [-2, -30, 5.5], [6, -21, 4], [-5, -12, 3.5]] as const) { c.beginPath(); c.arc(bx, by, r, 0, Math.PI * 2); c.fill(); }
  c.restore();
  c.restore();
}

export function paintLandmark(c: Brush, landmark: TerrainLandmark, point: Point) {
  c.save(); c.translate(point.x, point.y);
  c.lineCap = c.lineJoin = "round";
  const size = landmark.size;
  if (landmark.kind === "grove") {
    ellipse(c, 0, 0, size * 0.46, size * 0.26, "#78966b14");
    for (let i = 0; i < 11; i++) {
      const a = i * 2.4 + landmark.rotation;
      const r = Math.sqrt((i + 1) / 11);
      paintTree(c, Math.cos(a) * size * 0.32 * r, -size * 0.17 + i * size * 0.032, 0.65 + (i % 3) * 0.15, i);
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
  } else if (landmark.kind === "road") {
    // Drawn with the others it joins (see @@@road-art).
  } else if (landmark.kind === "ditch") {
    c.rotate(landmark.rotation);
    c.beginPath(); c.moveTo(-size / 2, 0);
    if(landmark.straight)c.lineTo(size/2,0);
    else c.bezierCurveTo(-size / 4, 42, size / 4, -42, size / 2, 0);
    c.lineWidth = 17; c.strokeStyle = "#799c912c"; c.stroke();
    c.lineWidth = 9; c.strokeStyle = "#7caca169"; c.stroke();
    c.lineWidth = 1; c.strokeStyle = "#e0e4c9a6"; c.stroke();
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

// @@@road-art - Roads (docs/art-direction-variants.zh.md, rule 8): a generated map lays a path as a run of short road
// marks end to end. Drawn one by one, each mark's own curve and caps showed as a chain of beads; joined back into the
// path they came from and drawn layer by layer (worn edge, packed bed, two ruts), a road reads as one road.
type RoadPath = { points: Point[]; bounds: { minX: number; minY: number; maxX: number; maxY: number } };
const roadPaths = new WeakMap<readonly TerrainLandmark[], RoadPath[]>();
const ROAD = { ink: "#293c35", edge: "#9b8865", bed: "#d3c39e", rut: "#9b8865" };
function joinRoads(landmarks: readonly TerrainLandmark[]): RoadPath[] {
  const cached = roadPaths.get(landmarks);
  if (cached) return cached;
  const key = (p: Point) => `${Math.round(p.x / 4)},${Math.round(p.y / 4)}`;
  const segments = landmarks.filter((mark) => mark.kind === "road").map((mark) => {
    const half = Math.max(0, mark.size - 40) / 2, dx = Math.cos(mark.rotation) * half, dy = Math.sin(mark.rotation) * half;
    return { mark, a: { x: mark.x - dx, y: mark.y - dy }, b: { x: mark.x + dx, y: mark.y + dy }, used: false };
  });
  const starts = new Map<string, typeof segments>();
  for (const segment of segments) for (const end of [segment.a, segment.b]) (starts.get(key(end)) ?? starts.set(key(end), []).get(key(end))!).push(segment);
  const next = (at: Point) => starts.get(key(at))?.find((segment) => !segment.used);
  const paths: RoadPath[] = [];
  for (const first of segments) {
    if (first.used) continue;
    first.used = true;
    const points = [first.a, first.b];
    for (let tail = next(points.at(-1)!); tail; tail = next(points.at(-1)!)) { tail.used = true; points.push(key(tail.a) === key(points.at(-1)!) ? tail.b : tail.a); }
    for (let head = next(points[0]!); head; head = next(points[0]!)) { head.used = true; points.unshift(key(head.a) === key(points[0]!) ? head.b : head.a); }
    // A lone authored road keeps the gentle bow it was always drawn with.
    if (points.length === 2 && !first.mark.straight) points.splice(1, 0, { x: first.mark.x + Math.sin(first.mark.rotation) * 15, y: first.mark.y - Math.cos(first.mark.rotation) * 15 });
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    paths.push({ points, bounds: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) } });
  }
  roadPaths.set(landmarks, paths);
  return paths;
}

/** Every road among the landmarks, in screen points (`toScreen`), skipping the ones wholly outside `view`. */
export function paintRoads(c: Brush, landmarks: readonly TerrainLandmark[], toScreen: (p: Point) => Point, view: { x: number; y: number; width: number; height: number }) {
  const visible = joinRoads(landmarks).filter(({ bounds }) => bounds.maxX > view.x - 40 && bounds.minX < view.x + view.width + 40 && bounds.maxY > view.y - 40 && bounds.minY < view.y + view.height + 40);
  if (!visible.length) return;
  // A smooth line through the path's points: straight to the first midpoint, then curves through each point to the next midpoint.
  const trace = (points: Point[], offset: number) => {
    const at = points.map((p, i) => {
      const before = points[Math.max(0, i - 1)]!, after = points[Math.min(points.length - 1, i + 1)]!;
      const dx = after.x - before.x, dy = after.y - before.y, length = Math.hypot(dx, dy) || 1;
      return toScreen({ x: p.x - dy / length * offset, y: p.y + dx / length * offset });
    });
    c.beginPath(); c.moveTo(at[0]!.x, at[0]!.y);
    for (let i = 1; i < at.length - 1; i++) c.quadraticCurveTo(at[i]!.x, at[i]!.y, (at[i]!.x + at[i + 1]!.x) / 2, (at[i]!.y + at[i + 1]!.y) / 2);
    c.lineTo(at.at(-1)!.x, at.at(-1)!.y);
  };
  c.save(); c.lineCap = c.lineJoin = "round";
  for (const [width, color, alpha] of [[26, ROAD.ink, .3], [23, ROAD.edge, 1], [18, ROAD.bed, 1]] as const) {
    c.lineWidth = width; c.strokeStyle = color; c.globalAlpha = alpha;
    for (const { points } of visible) { trace(points, 0); c.stroke(); }
  }
  c.lineWidth = 1.6; c.strokeStyle = ROAD.rut; c.globalAlpha = .5;
  for (const { points } of visible) for (const offset of [-4.5, 4.5]) { trace(points, offset); c.stroke(); }
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

// @@@mine-stages - A gold mine shows what is left in it, read from its amount against the gold it started with: rich
// (more than half), worked (half or less), failing (the last tenth) and, once empty, collapsed into a pit. Only the
// amounts decide it, so every mine on every map reads the same way.
export type MineStage = "rich" | "worked" | "failing" | "collapsed";
export function mineStage(mine: { amount: number; startAmount: number }): MineStage {
  if (mine.amount <= 0) return "collapsed";
  const left = mine.amount / Math.max(1, mine.startAmount);
  return left > .5 ? "rich" : left > .1 ? "worked" : "failing";
}

/** The art spans about 84 across (x -42 to 42), round the mine's centre. */
export function paintMine(b: Brush, stage: MineStage = "rich") {
    const spent = stage === "collapsed";
    ellipse(b, 4, 22, 42, 12, "#38302920");
    ellipse(b, 1, 22, 32, 7, "#38302935");
    // A worked-out hill loses its warmth: the same rocks, greyed.
    const tone = (color: string, grey: string) => spent ? grey : color;
    const rock = (p:number[][], color:string) => { polygon(b,p,color,"#55554d",.65); line(b,p.slice(0,3),"#c5bfab",.75); };
    const ore = (x: number, y: number, size = 1) => {
      polygon(b,[[x-3*size,y],[x,y-4*size],[x+4*size,y-1*size],[x+2*size,y+2*size]],"#d6b04f","#7a5d24",.6);
      line(b,[[x-1*size,y-1*size],[x+1*size,y-3*size]],"#f6e3a0",.7);
    };
    rock([[-40,16],[-34,-5],[-21,-23],[-7,-19],[0,7],[-14,25]],tone("#8f9083","#8d8c86"));
    rock([[-25,-7],[-16,-31],[4,-36],[16,-20],[7,7]],tone("#a3a293","#9c9b95"));
    rock([[4,-27],[21,-34],[38,-12],[42,17],[24,25],[12,7]],tone("#85897f","#86857f"));
    rock([[21,-34],[35,-22],[38,-12],[21,-16]],tone("#b9b4a0","#adaba3"));
    if (spent) {
      // The adit has fallen in: its mouth choked with rubble, the frame snapped, and the ground before it sunk into a pit.
      ellipse(b, 2, 26, 24, 9, "#2e2b26", "#5d5a50");
      ellipse(b, 2, 24, 18, 5.5, "#1f1e1b");
      polygon(b,[[-13,22],[-12,-4],[0,-11],[14,-4],[16,22]],"#3b3934","#57564a",.8);
      for (const [x, y, s] of [[-8,10,1.4],[4,6,1.6],[10,16,1.2],[-2,18,1.3],[-10,-1,1],[7,-4,1.1]] as const)
        rock([[x-5*s,y+2*s],[x-2*s,y-4*s],[x+4*s,y-3*s],[x+5*s,y+2*s],[x,y+4*s]],"#8d8a80");
      line(b,[[-15,23],[-15,2]],"#554735",5); line(b,[[-16,21],[-16,2]],"#9a8a6e",1.2);
      line(b,[[-15,2],[-10,-6]],"#554735",4.5);
      line(b,[[-21,-7],[17,3]],"#6b5843",5.5); line(b,[[-21,-9],[17,1]],"#a08c6c",1);
      line(b,[[15,23],[19,8]],"#554735",4.5);
      // The cart left on its side, empty.
      polygon(b,[[22,22],[33,19],[35,27],[25,30]],"#5b5043","#3e3a32",.7);
      ellipse(b,31,17,2.6,2.6,"#373a37","#8d8a80");
      return;
    }
    polygon(b,[[-13,22],[-12,-8],[0,-15],[14,-8],[16,22]],"#242825","#57564a",.8);
    for(const x of [-15,15]) { line(b,[[x,23],[x,-10]],"#554735",5); line(b,[[x-1,21],[x-1,-10]],"#ad936c",1.2); }
    if (stage === "failing") {
      // The lintel sags and a stone has come down in the mouth.
      line(b,[[-19,-11],[18,-6]],"#766047",6); line(b,[[-19,-13],[18,-8]],"#b09a74",1);
      rock([[-4,22],[-1,13],[7,12],[10,22]],"#8a8b80");
    } else {
      line(b,[[-19,-11],[18,-11]],"#766047",6); line(b,[[-19,-13],[18,-13]],"#b09a74",1);
      line(b,[[-15,-3],[-5,-11]],"#8c7656",2); line(b,[[15,-3],[5,-11]],"#8c7656",2);
    }
    for(let i=0;i<5;i++) line(b,[[-10-i*1.8,22+i*3],[12+i,22+i*3]],"#6c5c47",2);
    line(b,[[-4,14],[-13,39]],"#8d9490",1.5); line(b,[[7,14],[12,39]],"#8d9490",1.5);
    polygon(b,[[21,17],[34,17],[32,28],[22,28]],"#655846","#3e3a32",.7);
    // What the cart holds and the ore lying about: heaped, then a little, then none.
    if (stage === "rich") polygon(b,[[21,17],[23,11],[27,9],[31,11],[34,17]],"#d6b04f","#7a5d24",.7);
    if (stage === "worked") polygon(b,[[22,17],[25,14],[30,14],[33,17]],"#c9a64c","#7a5d24",.6);
    for(const x of [23,30]) ellipse(b,x,29,2.8,2.8,"#373a37","#9a9787");
    const lying = stage === "rich" ? [[-29,8,1.2],[-20,20,1.1],[-34,18,1],[37,22,1.1],[-25,27,.9]] : stage === "worked" ? [[-29,8,1],[-20,20,.9]] : [];
    for(const [x,y,size] of lying) ore(x!,y!,size!);
    line(b,[[20,-10],[27,-10],[27,1]],"#61513e",1.3);
    // The lamp burns while there is gold to dig.
    polygon(b,[[24,-1],[30,-1],[30,5],[24,5]],stage === "failing" ? "#8f8162" : "#d9b777","#4e4536",.6);
}

// @@@obstacle-art - Rocks or a stone gate across a way (see @@@obstacle): a heap of boulders the width of the way, or two
// stone pillars with a timber gate between them, lying across the way it shuts; cracked once it is down to half its
// health. Drawn fresh each frame (each lies its own way), as few as they are.
export function paintObstacle(c: Brush, obstacle: Pick<Obstacle, "kind" | "radius" | "along" | "hp" | "maxHp">, point: Point) {
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

