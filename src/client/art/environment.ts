import type { Obstacle, TerrainLandmark } from "../../shared/types";
import { type Brush, type Point, ellipse, line, polygon } from "./kit";

/** Static scenery painters: geometry and detail, independent of atlas caching. */
/** One tree of the atlas, its foot at (x, y). */
export function paintTree(c: Brush, x: number, y: number, size: number, tone = 0) {
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

export function paintLandmark(c: Brush, landmark: TerrainLandmark, point: Point) {
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
    if(landmark.straight)c.lineTo(size/2,0);
    else c.bezierCurveTo(-size / 4, river ? 42 : -20, size / 4, river ? -42 : -20, size / 2, 0);
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

export function paintMine(b: Brush) {
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

