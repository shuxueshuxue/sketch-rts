import { SIM_TICKS_PER_SECOND } from "../shared/time";
import { textIn, type LineView, type MarkerView, type StageView } from "../story/stage";
import { drawAtlasProp } from "./atlas-art";

type Brush = CanvasRenderingContext2D;
type Point = { x: number; y: number };
type Locale = "zh" | "en";

// @@@story-renderer - How the story's stage (story/stage) looks: bubbles over the units who speak, nameplates under the
// heroes, marks on the ground, words floating up, and across the screen the letterbox, titles, narration, objectives,
// notices, the choice put to the player and the heroes' panel. Drawn from plain data by world-renderer's drawWorld, so a
// recording shows exactly what the browser shows. Everything that animates is timed by the story's own clock (the
// snapshot's tick), so a frame is a function of the game, not of when it was drawn.

// Handwriting for what characters say, a brush hand for titles; each list falls back to what the machine has.
export const SPEECH_FONT = `"Hannotate SC", "Kaiti SC", "STKaiti", "PingFang SC", "Songti SC", "Microsoft YaHei", sans-serif`;
export const TITLE_FONT = `"Kaiti SC", "STKaiti", "KaiTi", "Songti SC", "Hannotate SC", serif`;
const INK = "#3a3024";
const PAPER = "rgba(255, 250, 236, 0.95)";
const PAPER_EDGE = "#5b4a33";
const GOLD = "#c9962f";

export type StoryPainter = {
  ctx: Brush;
  view: StageView;
  locale: Locale;
  width: number;
  height: number;
  // Where a world point is on the screen, and where a unit is drawn this frame.
  project: (point: Point) => Point;
  unitAt: (unitId: string) => (Point & { radius: number }) | undefined;
  zoom: number;
};

const seconds = (ticks: number) => ticks / SIM_TICKS_PER_SECOND;

// ---- On the ground (drawn in world space, under the units).

export function drawStoryGround(ctx: Brush, view: StageView, toScreen: (point: Point) => Point, near: (point: Point, pad: number) => boolean) {
  for (const marker of view.markers) {
    const at = toScreen(marker);
    if (!near(at, marker.radius + 60)) continue;
    drawMarkerGround(ctx, marker, at, seconds(view.tick - marker.start));
  }
}

function drawMarkerGround(ctx: Brush, marker: MarkerView, at: Point, age: number) {
  ctx.save();
  ctx.lineCap = ctx.lineJoin = "round";
  if (marker.kind === "danger") {
    // A telegraph: a red ring that fills as the blow comes.
    const pulse = 0.5 + 0.5 * Math.sin(age * 9);
    ctx.fillStyle = `rgba(190, 54, 34, ${0.1 + 0.12 * pulse})`;
    ctx.strokeStyle = "rgba(160, 40, 28, 0.85)";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([10, 6]);
    ctx.beginPath();
    ctx.ellipse(at.x, at.y, marker.radius, marker.radius * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (marker.kind === "quest" || marker.kind === "rally") {
    ctx.strokeStyle = marker.kind === "quest" ? "rgba(185, 134, 27, 0.9)" : "rgba(49, 95, 135, 0.85)";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 7]);
    ctx.lineDashOffset = -age * 20;
    ctx.beginPath();
    ctx.ellipse(at.x, at.y, marker.radius, marker.radius * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (marker.kind === "place") {
    ctx.strokeStyle = "rgba(91, 74, 51, 0.55)";
    ctx.lineWidth = 1.4;
    ctx.setLineDash([3, 6]);
    ctx.beginPath();
    ctx.ellipse(at.x, at.y, marker.radius, marker.radius * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (marker.kind === "snare") {
    // Thorns: a ring of hooked strokes closing on whoever stands inside.
    ctx.strokeStyle = "rgba(78, 110, 52, 0.9)";
    ctx.lineWidth = 2.2;
    for (let index = 0; index < 10; index += 1) {
      const angle = (index / 10) * Math.PI * 2 + age * 0.4;
      const x = at.x + Math.cos(angle) * marker.radius;
      const y = at.y + Math.sin(angle) * marker.radius * 0.5;
      ctx.beginPath();
      ctx.moveTo(x, y + 4);
      ctx.quadraticCurveTo(x - 6, y - 8, x + 2, y - 14);
      ctx.stroke();
    }
  } else if (marker.kind === "relic") {
    const glow = ctx.createRadialGradient(at.x, at.y, 2, at.x, at.y, marker.radius);
    glow.addColorStop(0, "rgba(255, 226, 140, 0.55)");
    glow.addColorStop(1, "rgba(255, 226, 140, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(at.x, at.y, marker.radius, marker.radius * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.strokeStyle = "rgba(150, 45, 35, 0.8)";
    ctx.lineWidth = 2;
    const r = marker.radius;
    ctx.beginPath();
    ctx.ellipse(at.x, at.y, r, r * 0.5, 0, 0, Math.PI * 2);
    ctx.moveTo(at.x - r - 8, at.y);
    ctx.lineTo(at.x - r + 8, at.y);
    ctx.moveTo(at.x + r - 8, at.y);
    ctx.lineTo(at.x + r + 8, at.y);
    ctx.stroke();
  }
  ctx.restore();
}

// ---- Scenery (world space, with the landmarks).

export function drawStoryProps(ctx: Brush, view: StageView, toScreen: (point: Point) => Point, near: (point: Point, pad: number) => boolean, painter: (kind: string) => ((b: Brush, state: string | undefined) => void) | undefined, now: number) {
  for (const prop of [...view.props].sort((a, b) => a.y - b.y)) {
    const at = toScreen(prop);
    if (!near(at, 140 * prop.scale)) continue;
    const paint = painter(prop.kind);
    if (!paint) continue;
    drawAtlasProp(ctx, `${prop.kind}:${prop.state ?? ""}`, (b) => paint(b, prop.state), at, prop.scale, prop.flip);
    if (prop.state === "burning") drawFlames(ctx, at, prop.scale, now + prop.id * 97);
  }
}

// Flames licking up from a burning prop, flickering with the animation clock.
function drawFlames(ctx: Brush, at: Point, scale: number, now: number) {
  ctx.save();
  ctx.lineJoin = "round";
  for (let index = 0; index < 5; index += 1) {
    const x = at.x + (index - 2) * 11 * scale;
    const height = (18 + 10 * Math.sin(now / 90 + index * 1.7)) * scale;
    const base = at.y - 6 * scale;
    ctx.fillStyle = index % 2 ? "rgba(229, 101, 47, 0.85)" : "rgba(244, 200, 110, 0.9)";
    ctx.beginPath();
    ctx.moveTo(x - 6 * scale, base);
    ctx.quadraticCurveTo(x - 4 * scale, base - height * 0.6, x + Math.sin(now / 70 + index) * 3 * scale, base - height);
    ctx.quadraticCurveTo(x + 5 * scale, base - height * 0.5, x + 6 * scale, base);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = "rgba(90, 80, 72, 0.18)";
  for (let index = 0; index < 3; index += 1) {
    const rise = ((now / 30 + index * 40) % 120) * scale;
    ctx.beginPath();
    ctx.arc(at.x + Math.sin(now / 400 + index) * 12 * scale, at.y - 30 * scale - rise, (8 + rise * 0.12) * scale, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ---- In the air (screen space, over everything in the world).

export function drawStoryAir(painter: StoryPainter) {
  const { ctx, view } = painter;
  ctx.save();
  for (const marker of view.markers) drawMarkerSign(painter, marker);
  drawNameplates(painter);
  drawFloaters(painter);
  drawBubbles(painter);
  ctx.restore();
}

function drawMarkerSign(painter: StoryPainter, marker: MarkerView) {
  const { ctx } = painter;
  const at = painter.project(marker);
  const age = seconds(painter.view.tick - marker.start);
  if (marker.kind === "quest") {
    const bob = Math.sin(age * 3) * 4;
    const y = at.y - 58 + bob;
    if (!onScreen(painter, { x: at.x, y }, 40)) return drawEdgeArrow(painter, at, GOLD);
    ctx.save();
    ctx.fillStyle = "#f4cf62";
    ctx.strokeStyle = "#7a5512";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(at.x - 6, y - 20);
    ctx.lineTo(at.x + 6, y - 20);
    ctx.lineTo(at.x + 3, y + 2);
    ctx.lineTo(at.x - 3, y + 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(at.x, y + 10, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  } else if (marker.kind === "relic") {
    if (!onScreen(painter, at, 30)) return;
    ctx.save();
    ctx.strokeStyle = "#b9861b";
    ctx.lineWidth = 1.6;
    for (let index = 0; index < 4; index += 1) {
      const angle = age * 1.3 + (index * Math.PI) / 2;
      const r = 16 + Math.sin(age * 4 + index) * 5;
      const x = at.x + Math.cos(angle) * r;
      const y = at.y - 18 + Math.sin(angle) * r * 0.5;
      ctx.beginPath();
      ctx.moveTo(x - 4, y);
      ctx.lineTo(x + 4, y);
      ctx.moveTo(x, y - 4);
      ctx.lineTo(x, y + 4);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (marker.label !== undefined && onScreen(painter, at, 60)) {
    ctx.save();
    ctx.font = `600 13px ${SPEECH_FONT}`;
    ctx.textAlign = "center";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(255, 250, 236, 0.9)";
    const text = textIn(marker.label, painter.locale);
    ctx.strokeText(text, at.x, at.y + marker.radius * 0.55 * painter.zoom + 18);
    ctx.fillStyle = marker.kind === "danger" ? "#8e2a1c" : "#5b4214";
    ctx.fillText(text, at.x, at.y + marker.radius * 0.55 * painter.zoom + 18);
    ctx.restore();
  }
}

function drawEdgeArrow(painter: StoryPainter, target: Point, color: string) {
  const { ctx, width, height } = painter;
  const cx = width / 2;
  const cy = height / 2;
  const angle = Math.atan2(target.y - cy, target.x - cx);
  const margin = 34;
  const x = Math.max(margin, Math.min(width - margin, cx + Math.cos(angle) * width));
  const y = Math.max(margin + letterboxHeight(painter), Math.min(height - margin - letterboxHeight(painter), cy + Math.sin(angle) * height));
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.strokeStyle = "#5b4214";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(14, 0);
  ctx.lineTo(-8, -10);
  ctx.lineTo(-3, 0);
  ctx.lineTo(-8, 10);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawNameplates(painter: StoryPainter) {
  const { ctx, view } = painter;
  for (const [unitId, plate] of Object.entries(view.nameplates)) {
    const unit = painter.unitAt(unitId);
    if (!unit) continue;
    const at = painter.project(unit);
    if (!onScreen(painter, at, 80)) continue;
    const y = at.y + unit.radius * painter.zoom + 14;
    const name = textIn(plate.name, painter.locale);
    const label = plate.level !== undefined ? `${name}  Lv${plate.level}` : name;
    ctx.save();
    ctx.font = `600 12px ${SPEECH_FONT}`;
    ctx.textAlign = "center";
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = "rgba(255, 250, 236, 0.85)";
    ctx.strokeText(label, at.x, y);
    ctx.fillStyle = plate.color;
    ctx.fillText(label, at.x, y);
    ctx.restore();
  }
}

function drawFloaters(painter: StoryPainter) {
  const { ctx, view } = painter;
  for (const floater of view.floaters) {
    const life = (view.tick - floater.start) / Math.max(1, floater.end - floater.start);
    const unit = floater.unitId ? painter.unitAt(floater.unitId) : undefined;
    const base = painter.project(unit ?? floater);
    const at = { x: base.x, y: base.y - 42 - life * 38 };
    if (!onScreen(painter, at, 60)) continue;
    ctx.save();
    ctx.globalAlpha = life < 0.75 ? 1 : Math.max(0, (1 - life) / 0.25);
    ctx.font = `700 ${floater.size}px ${SPEECH_FONT}`;
    ctx.textAlign = "center";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(255, 250, 236, 0.92)";
    const text = textIn(floater.text, painter.locale);
    ctx.strokeText(text, at.x, at.y);
    ctx.fillStyle = floater.color;
    ctx.fillText(text, at.x, at.y);
    ctx.restore();
  }
}

type BubbleBox = { line: LineView; anchor: Point; x: number; y: number; w: number; h: number; lines: string[]; offscreen: boolean };

function drawBubbles(painter: StoryPainter) {
  const { ctx, view } = painter;
  const boxes: BubbleBox[] = [];
  ctx.font = `17px ${SPEECH_FONT}`;
  for (const line of view.lines) {
    const unit = painter.unitAt(line.speakerId);
    if (!unit) continue;
    const head = painter.project(unit);
    const anchor = { x: head.x, y: head.y - (unit.radius * 1.9 + 14) * painter.zoom };
    const text = textIn(line.text, painter.locale);
    const lines = wrap(ctx, text, 290);
    const w = Math.max(90, Math.max(...lines.map((row) => ctx.measureText(row).width)) + 28);
    const h = lines.length * 23 + 30;
    const top = letterboxHeight(painter) + 8;
    const x = clamp(anchor.x - w / 2, 10, painter.width - w - 10);
    const y = clamp(anchor.y - h - 16, top, painter.height - h - letterboxHeight(painter) - 10);
    boxes.push({ line, anchor, x, y, w, h, lines, offscreen: !onScreen(painter, anchor, 0) });
  }
  // Bubbles that would cover one another are stacked upward, the older above.
  boxes.sort((a, b) => a.line.start - b.line.start || a.x - b.x);
  for (let index = 1; index < boxes.length; index += 1) {
    const box = boxes[index]!;
    for (const other of boxes.slice(0, index)) {
      if (box.x < other.x + other.w && other.x < box.x + box.w && box.y < other.y + other.h && other.y < box.y + box.h) other.y = Math.max(letterboxHeight(painter) + 8, box.y - other.h - 6);
    }
  }
  for (const box of boxes) drawBubble(painter, box);
}

function drawBubble(painter: StoryPainter, box: BubbleBox) {
  const { ctx, view } = painter;
  const { line } = box;
  const age = seconds(view.tick - line.start);
  const left = seconds(line.end - view.tick);
  const pop = Math.min(1, age / 0.18);
  const alpha = Math.min(1, left / 0.3, 0.35 + pop);
  ctx.save();
  ctx.globalAlpha = Math.max(0, alpha);
  const scale = 0.85 + 0.15 * easeOut(pop);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);
  const tail = { x: clamp(box.anchor.x, box.x + 18, box.x + box.w - 18), y: box.y + box.h };
  ctx.lineJoin = ctx.lineCap = "round";
  ctx.fillStyle = line.tone === "think" ? "rgba(247, 247, 240, 0.94)" : PAPER;
  ctx.strokeStyle = PAPER_EDGE;
  ctx.lineWidth = line.tone === "shout" ? 2.6 : 1.7;
  if (line.tone === "whisper") ctx.setLineDash([5, 4]);
  ctx.shadowColor = "rgba(60, 45, 20, 0.22)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  ctx.beginPath();
  if (line.tone === "shout") jaggedRect(ctx, box.x, box.y, box.w, box.h);
  else roundRect(ctx, box.x, box.y, box.w, box.h, 12);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.stroke();
  ctx.setLineDash([]);
  // The tail points at the speaker (a trail of bubbles for a thought; an arrow to the edge when the speaker is off screen).
  if (!box.offscreen) {
    if (line.tone === "think") {
      for (const [share, r] of [[0.35, 5], [0.7, 3.2]] as const) {
        ctx.beginPath();
        ctx.arc(tail.x + (box.anchor.x - tail.x) * share, tail.y + (box.anchor.y - tail.y) * share, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    } else {
      ctx.beginPath();
      ctx.moveTo(tail.x - 9, tail.y - 1);
      ctx.lineTo(box.anchor.x, Math.max(tail.y + 6, box.anchor.y));
      ctx.lineTo(tail.x + 9, tail.y - 1);
      ctx.fill();
      ctx.stroke();
      ctx.fillRect(tail.x - 8, tail.y - 3, 16, 3.5);
    }
  }
  const name = textIn(line.name, painter.locale);
  if (name) {
    ctx.font = `700 13px ${SPEECH_FONT}`;
    const nameWidth = ctx.measureText(name).width + 16;
    ctx.fillStyle = line.color;
    roundRect(ctx, box.x + 10, box.y - 11, nameWidth, 20, 6);
    ctx.fill();
    ctx.fillStyle = "#fffaf0";
    ctx.textBaseline = "middle";
    ctx.fillText(name, box.x + 18, box.y - 0.5);
  }
  ctx.textBaseline = "alphabetic";
  ctx.font = `${line.tone === "shout" ? "700 " : ""}17px ${SPEECH_FONT}`;
  ctx.fillStyle = line.tone === "whisper" || line.tone === "think" ? "#5d5446" : INK;
  // Words appear as if written: the line fills in over its first moments.
  const shown = Math.floor(Math.min(1, age / Math.min(1.2, 0.04 * box.lines.join("").length + 0.2)) * box.lines.join("").length + 0.999);
  let budget = shown;
  box.lines.forEach((row, index) => {
    const part = [...row].slice(0, Math.max(0, budget)).join("");
    budget -= [...row].length;
    ctx.fillText(part, box.x + 14, box.y + 28 + index * 23);
  });
  ctx.restore();
}

// ---- Across the screen.

export function drawStoryScreen(painter: StoryPainter) {
  const { ctx } = painter;
  ctx.save();
  drawLetterbox(painter);
  drawObjectives(painter);
  drawParty(painter);
  drawNotices(painter);
  // Narration and titles read over a fade to black (a chapter's opening words).
  drawFade(painter);
  drawNarration(painter);
  drawChoice(painter);
  drawTitle(painter);
  ctx.restore();
}

function letterboxHeight(painter: Pick<StoryPainter, "view" | "height">) {
  const { letterbox, tick } = painter.view;
  const t = Math.min(1, seconds(tick - letterbox.since) / 0.6);
  const share = letterbox.on ? easeOut(t) : 1 - easeOut(t);
  return Math.round(painter.height * 0.085 * Math.max(0, share));
}

function drawLetterbox(painter: StoryPainter) {
  const bar = letterboxHeight(painter);
  if (bar <= 0) return;
  const { ctx, width, height } = painter;
  ctx.fillStyle = "#15120e";
  ctx.fillRect(0, 0, width, bar);
  ctx.fillRect(0, height - bar, width, bar);
}

function drawTitle(painter: StoryPainter) {
  const card = painter.view.title;
  if (!card) return;
  const { ctx, width, height, view } = painter;
  const age = seconds(view.tick - card.start);
  const left = seconds(card.end - view.tick);
  const alpha = Math.max(0, Math.min(1, age / 0.8, left / 0.8));
  ctx.save();
  ctx.globalAlpha = alpha;
  const y = height * 0.42;
  const wash = ctx.createLinearGradient(0, y - 90, 0, y + 80);
  wash.addColorStop(0, "rgba(250, 244, 222, 0)");
  wash.addColorStop(0.35, "rgba(250, 244, 222, 0.88)");
  wash.addColorStop(0.7, "rgba(250, 244, 222, 0.88)");
  wash.addColorStop(1, "rgba(250, 244, 222, 0)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, y - 90, width, 170);
  ctx.textAlign = "center";
  ctx.fillStyle = "#2f271c";
  ctx.font = `56px ${TITLE_FONT}`;
  ctx.fillText(textIn(card.text, painter.locale), width / 2, y);
  // A brush stroke under the title, drawn out as the card appears.
  const span = Math.min(1, age / 1.1) * 260;
  ctx.strokeStyle = "rgba(120, 32, 24, 0.75)";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(width / 2 - span, y + 20);
  ctx.quadraticCurveTo(width / 2, y + 27, width / 2 + span, y + 18);
  ctx.stroke();
  if (card.subtitle !== undefined) {
    ctx.font = `24px ${TITLE_FONT}`;
    ctx.fillStyle = "#5a4a33";
    ctx.fillText(textIn(card.subtitle, painter.locale), width / 2, y + 58);
  }
  ctx.restore();
}

function drawNarration(painter: StoryPainter) {
  const card = painter.view.narration;
  if (!card) return;
  const { ctx, width, height, view } = painter;
  const age = seconds(view.tick - card.start);
  const left = seconds(card.end - view.tick);
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, age / 0.5, left / 0.5));
  ctx.font = `24px ${TITLE_FONT}`;
  const rows = wrap(ctx, textIn(card.text, painter.locale), width * 0.7);
  const bar = letterboxHeight(painter);
  const boxHeight = rows.length * 32 + 22;
  const y = bar > 0 ? height - bar - boxHeight - 10 : height - boxHeight - 36;
  const wash = ctx.createLinearGradient(width * 0.1, 0, width * 0.9, 0);
  wash.addColorStop(0, "rgba(30, 25, 18, 0)");
  wash.addColorStop(0.2, "rgba(30, 25, 18, 0.62)");
  wash.addColorStop(0.8, "rgba(30, 25, 18, 0.62)");
  wash.addColorStop(1, "rgba(30, 25, 18, 0)");
  ctx.fillStyle = wash;
  ctx.fillRect(width * 0.1, y, width * 0.8, boxHeight);
  ctx.textAlign = "center";
  ctx.fillStyle = "#f6ecd2";
  rows.forEach((row, index) => ctx.fillText(row, width / 2, y + 33 + index * 32));
  ctx.restore();
}

function drawObjectives(painter: StoryPainter) {
  const { ctx, view } = painter;
  if (view.objectives.length === 0) return;
  const top = letterboxHeight(painter) + 14;
  const rows = view.objectives.map((objective) => {
    const mark = objective.state === "done" ? "☑" : objective.state === "failed" ? "☒" : "☐";
    const words = textIn(objective.text, painter.locale) + (objective.progress ? `  ${objective.progress}` : "");
    return { objective, text: `${mark} ${objective.optional ? (painter.locale === "zh" ? "（支线）" : "(side) ") : ""}${words}` };
  });
  ctx.font = `15px ${SPEECH_FONT}`;
  const w = Math.min(430, Math.max(170, ...rows.map((row) => ctx.measureText(row.text).width + 30)));
  const h = rows.length * 24 + 38;
  ctx.fillStyle = "rgba(252, 246, 226, 0.9)";
  ctx.strokeStyle = PAPER_EDGE;
  ctx.lineWidth = 1.4;
  roundRect(ctx, 14, top, w, h, 8);
  ctx.fill();
  ctx.stroke();
  ctx.font = `700 14px ${SPEECH_FONT}`;
  ctx.fillStyle = "#7a2c1e";
  ctx.fillText(painter.locale === "zh" ? "目标" : "Objectives", 26, top + 21);
  ctx.font = `15px ${SPEECH_FONT}`;
  rows.forEach((row, index) => {
    const state = row.objective.state;
    ctx.fillStyle = state === "done" ? "#4f7a45" : state === "failed" ? "#9a3a2a" : row.objective.optional ? "#6c5c44" : INK;
    ctx.fillText(row.text, 24, top + 45 + index * 24);
    if (state !== "active") {
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(44, top + 40 + index * 24);
      ctx.lineTo(24 + ctx.measureText(row.text).width, top + 40 + index * 24);
      ctx.stroke();
    }
  });
}

function drawNotices(painter: StoryPainter) {
  const { ctx, view, width } = painter;
  let y = letterboxHeight(painter) + 18;
  for (const notice of view.notices) {
    const age = seconds(view.tick - notice.start);
    const left = seconds(notice.end - view.tick);
    const text = textIn(notice.text, painter.locale);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, age / 0.3, left / 0.6));
    ctx.font = `600 16px ${SPEECH_FONT}`;
    const w = ctx.measureText(text).width + 36;
    const x = width / 2 - w / 2;
    ctx.fillStyle = notice.tone === "warn" ? "rgba(122, 40, 28, 0.88)" : notice.tone === "gain" ? "rgba(58, 92, 48, 0.88)" : notice.tone === "quest" ? "rgba(112, 82, 24, 0.9)" : "rgba(44, 52, 60, 0.85)";
    roundRect(ctx, x, y, w, 30, 15);
    ctx.fill();
    ctx.fillStyle = "#fbf3dc";
    ctx.textAlign = "center";
    ctx.fillText(text, width / 2, y + 21);
    ctx.restore();
    y += 36;
  }
}

function drawChoice(painter: StoryPainter) {
  const choice = painter.view.choice;
  if (!choice) return;
  const { ctx, width, height, view } = painter;
  const age = seconds(view.tick - choice.opened);
  ctx.save();
  ctx.globalAlpha = Math.min(1, age / 0.35);
  const prompt = textIn(choice.prompt, painter.locale);
  ctx.font = `20px ${TITLE_FONT}`;
  const promptRows = wrap(ctx, prompt, 560);
  const w = 620;
  const h = promptRows.length * 28 + choice.options.length * 40 + 44;
  const x = width / 2 - w / 2;
  const y = height - letterboxHeight(painter) - h - 24;
  ctx.fillStyle = "rgba(252, 246, 226, 0.96)";
  ctx.strokeStyle = PAPER_EDGE;
  ctx.lineWidth = 2;
  ctx.shadowColor = "rgba(40, 30, 10, 0.3)";
  ctx.shadowBlur = 14;
  roundRect(ctx, x, y, w, h, 10);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.stroke();
  ctx.fillStyle = "#2f271c";
  promptRows.forEach((row, index) => ctx.fillText(row, x + 24, y + 34 + index * 28));
  choice.options.forEach((option, index) => {
    const oy = y + promptRows.length * 28 + 30 + index * 40;
    const picked = choice.picked === option.id;
    const faded = choice.picked !== undefined && !picked;
    if (picked) {
      const glow = Math.min(1, seconds(view.tick - (choice.pickedAt ?? view.tick)) / 0.25);
      ctx.fillStyle = `rgba(214, 170, 72, ${0.35 + 0.25 * glow})`;
      roundRect(ctx, x + 14, oy - 2, w - 28, 34, 6);
      ctx.fill();
    }
    ctx.globalAlpha = Math.min(1, age / 0.35) * (faded ? 0.4 : 1);
    ctx.font = `600 18px ${SPEECH_FONT}`;
    ctx.fillStyle = "#7a2c1e";
    ctx.fillText(`${index + 1}.`, x + 26, oy + 22);
    ctx.fillStyle = INK;
    ctx.font = `18px ${SPEECH_FONT}`;
    ctx.fillText(textIn(option.text, painter.locale), x + 52, oy + 22);
    ctx.globalAlpha = Math.min(1, age / 0.35);
  });
  ctx.restore();
}

// The heroes' panel: one card per hero in a strip along the bottom-left (name, level, health, experience, powers).
function drawParty(painter: StoryPainter) {
  const party = painter.view.party;
  if (!party || party.members.length === 0 || painter.view.letterbox.on) return;
  const { ctx, height } = painter;
  const cardWidth = 196;
  const cardHeight = 70;
  const y = height - cardHeight - 12;
  party.members.forEach((member, index) => {
    const x = 12 + index * (cardWidth + 8);
    ctx.save();
    ctx.fillStyle = "rgba(252, 246, 226, 0.88)";
    ctx.strokeStyle = PAPER_EDGE;
    ctx.lineWidth = 1.2;
    roundRect(ctx, x, y, cardWidth, cardHeight, 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = member.color;
    ctx.fillRect(x, y + 7, 4, cardHeight - 14);
    ctx.font = `700 14px ${SPEECH_FONT}`;
    ctx.fillStyle = INK;
    ctx.fillText(textIn(member.name, painter.locale), x + 12, y + 18);
    ctx.font = `600 12px ${SPEECH_FONT}`;
    ctx.fillStyle = "#7a2c1e";
    ctx.textAlign = "right";
    ctx.fillText(`Lv ${member.level}${member.gear.length > 0 ? `  ✦${member.gear.length}` : ""}`, x + cardWidth - 10, y + 18);
    ctx.textAlign = "left";
    bar(ctx, x + 12, y + 25, cardWidth - 24, 6, member.hp / Math.max(1, member.maxHp), member.hp / member.maxHp > 0.4 ? "#7fa86f" : "#c8724f");
    const xpShare = member.xpNext !== undefined ? (member.xp - member.xpFloor) / Math.max(1, member.xpNext - member.xpFloor) : 1;
    bar(ctx, x + 12, y + 34, cardWidth - 24, 3, xpShare, "#b18cd6");
    ctx.font = `11px ${SPEECH_FONT}`;
    let sx = x + 12;
    for (const skill of member.skills) {
      const name = textIn(skill.name, painter.locale);
      const w = ctx.measureText(name).width + 10;
      if (sx + w > x + cardWidth - 8) break;
      ctx.fillStyle = skill.ready >= 1 ? "rgba(214, 170, 72, 0.9)" : "rgba(160, 150, 130, 0.45)";
      roundRect(ctx, sx, y + 44, w, 16, 5);
      ctx.fill();
      if (skill.ready < 1) {
        ctx.fillStyle = "rgba(214, 170, 72, 0.55)";
        roundRect(ctx, sx, y + 44, Math.max(2, w * skill.ready), 16, 5);
        ctx.fill();
      }
      ctx.fillStyle = INK;
      ctx.fillText(name, sx + 5, y + 56);
      sx += w + 4;
    }
    ctx.restore();
  });
}

function drawFade(painter: StoryPainter) {
  const { fade, tick } = painter.view;
  let alpha = fade.to;
  if (tick < fade.end) alpha = tick <= fade.start ? fade.from : fade.from + ((fade.to - fade.from) * (tick - fade.start)) / Math.max(1, fade.end - fade.start);
  if (alpha <= 0.001) return;
  painter.ctx.fillStyle = `rgba(12, 10, 8, ${Math.min(1, alpha)})`;
  painter.ctx.fillRect(0, 0, painter.width, painter.height);
}

// ---- Helpers.

function bar(ctx: Brush, x: number, y: number, w: number, h: number, share: number, color: string) {
  ctx.fillStyle = "rgba(49, 72, 58, 0.55)";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, share)), h);
}

// Breaks text to fit a width: between words in a spaced script, between any two characters in Chinese.
export function wrap(ctx: Brush, text: string, maxWidth: number): string[] {
  const rows: string[] = [];
  for (const paragraph of text.split("\n")) {
    const tokens = paragraph.match(/[⺀-鿿豈-﫿＀-￯]|[^\s⺀-鿿豈-﫿＀-￯]+|\s+/g) ?? [];
    let row = "";
    for (const token of tokens) {
      const next = row + token;
      if (row && ctx.measureText(next).width > maxWidth && !/^[，。！？、；：」』）,.!?;:]$/.test(token)) {
        rows.push(row.trimEnd());
        row = token.trimStart();
      } else row = next;
    }
    if (row) rows.push(row.trimEnd());
  }
  return rows.length > 0 ? rows : [""];
}

function roundRect(ctx: Brush, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function jaggedRect(ctx: Brush, x: number, y: number, w: number, h: number) {
  const points: Point[] = [];
  const steps = Math.max(8, Math.round((w + h) / 22));
  const edge = (t: number): Point => {
    const p = t * 2 * (w + h);
    if (p < w) return { x: x + p, y };
    if (p < w + h) return { x: x + w, y: y + p - w };
    if (p < 2 * w + h) return { x: x + w - (p - w - h), y: y + h };
    return { x, y: y + h - (p - 2 * w - h) };
  };
  for (let index = 0; index < steps * 2; index += 1) {
    const at = edge(index / (steps * 2));
    const out = index % 2 === 0 ? 5 : -1;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const d = Math.hypot(at.x - cx, at.y - cy) || 1;
    points.push({ x: at.x + ((at.x - cx) / d) * out, y: at.y + ((at.y - cy) / d) * out });
  }
  ctx.moveTo(points[0]!.x, points[0]!.y);
  for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.closePath();
}

function onScreen(painter: Pick<StoryPainter, "width" | "height">, point: Point, pad: number) {
  return point.x >= -pad && point.y >= -pad && point.x <= painter.width + pad && point.y <= painter.height + pad;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(min, max), Math.max(min, value));
}

function easeOut(t: number) {
  return 1 - (1 - t) * (1 - t);
}
