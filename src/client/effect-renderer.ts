import type { WorldEffect } from "../shared/types";
import { drawLevelStar } from "./level-star";

type Point = { x: number; y: number };

type RenderWorldEffectsOptions = {
  ctx: CanvasRenderingContext2D;
  effects: WorldEffect[];
  worldToScreen: (point: Point) => Point;
  nearScreen: (point: Point, pad: number) => boolean;
};

type EffectRenderContext = {
  ctx: CanvasRenderingContext2D;
  worldToScreen: (point: Point) => Point;
};

export function renderWorldEffects(options: RenderWorldEffectsOptions) {
  const { ctx, effects, worldToScreen, nearScreen } = options;
  const renderer = { ctx, worldToScreen };
  for (const effect of effects) {
    if (effect.type === "projectile" && hasEffectVector(effect)) {
      const from = worldToScreen({ x: effect.fromX, y: effect.fromY });
      const to = worldToScreen({ x: effect.toX, y: effect.toY });
      if (!nearScreen(to, 90) && !nearScreen(from, 90)) continue;
      const progress = 1 - effect.remaining / effect.duration;
      const head = {
        x: from.x + (to.x - from.x) * progress,
        y: from.y + (to.y - from.y) * progress,
      };
      drawProjectileTrail(ctx, from, to, head, progress, effect.remaining / effect.duration);
      continue;
    }

    if (effect.type === "melee" && hasEffectVector(effect)) {
      const from = worldToScreen({ x: effect.fromX, y: effect.fromY });
      const to = worldToScreen({ x: effect.toX, y: effect.toY });
      const thrust = 0.45 + Math.sin((1 - effect.remaining / effect.duration) * Math.PI) * 0.35;
      const tip = {
        x: from.x + (to.x - from.x) * thrust,
        y: from.y + (to.y - from.y) * thrust,
      };
      ctx.strokeStyle = "#243126";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
      continue;
    }

    if (effect.type === "chainLightning" && hasEffectVector(effect)) {
      const from = worldToScreen({ x: effect.fromX, y: effect.fromY });
      const to = worldToScreen({ x: effect.toX, y: effect.toY });
      if (!nearScreen(to, 120) && !nearScreen(from, 120)) continue;
      drawChainLightningEffect(ctx, effect, from, to);
      continue;
    }

    const point = worldToScreen(effect);
    const pad = effect.type === "guardianField" || effect.type === "storm" ? (effect.radius ?? (effect.type === "guardianField" ? 280 : 145)) + 80 : 90;
    if (!nearScreen(point, pad)) continue;
    const life = effect.remaining / effect.duration;
    const radius = 9 + (1 - life) * 22;

    if (effect.type === "hit") {
      ctx.strokeStyle = "#9b2f2f";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(point.x - radius, point.y);
      ctx.lineTo(point.x + radius, point.y);
      ctx.moveTo(point.x, point.y - radius);
      ctx.lineTo(point.x, point.y + radius);
      ctx.stroke();
      continue;
    }

    if (effect.type === "attackTarget") {
      const pulse = 0.55 + Math.sin(effect.remaining * 0.9) * 0.22;
      ctx.strokeStyle = `rgba(155, 47, 47, ${pulse})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(point.x, point.y + 10, radius * 1.15, radius * 0.5, 0, 0, Math.PI * 2);
      ctx.moveTo(point.x - radius * 1.25, point.y + 10);
      ctx.lineTo(point.x - radius * 0.45, point.y + 10);
      ctx.moveTo(point.x + radius * 0.45, point.y + 10);
      ctx.lineTo(point.x + radius * 1.25, point.y + 10);
      ctx.stroke();
      continue;
    }

    if (effect.type === "heal") {
      drawHealEffect(renderer, effect, point, life);
      continue;
    }

    if (effect.type === "repair") {
      drawRepairEffect(ctx, point, life, effect.remaining);
      continue;
    }

    if (effect.type === "summon") {
      drawSummonEffect(ctx, point, life);
      continue;
    }

    if (effect.type === "curse") {
      drawCurseEffect(ctx, point, life);
      continue;
    }

    if (effect.type === "storm") {
      drawStormEffect(ctx, effect, point, life);
      continue;
    }

    if (effect.type === "guardianField") {
      drawGuardianFieldEffect(ctx, effect, point, life);
      continue;
    }

    if (effect.type === "experienceBurst") {
      drawExperienceBurstEffect(ctx, point, life);
      continue;
    }

    if (effect.type === "levelUp") {
      drawLevelUpEffect(ctx, point, life);
      continue;
    }

    if (effect.type === "flameBurn") {
      drawFlameBurnEffect(ctx, point, life);
      continue;
    }

    ctx.lineWidth = 2;
    ctx.strokeStyle =
      effect.type === "build" ? "#315f87" : effect.type === "mine" ? "#b9861b" : effect.type === "attack" ? "#9b2f2f" : "#243126";
    ctx.setLineDash(effect.type === "build" ? [6, 5] : []);
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

// @@@effect-language - Active powers need readable world symbols, not generic debug circles.
function drawChainLightningEffect(ctx: CanvasRenderingContext2D, effect: WorldEffect, from: Point, to: Point) {
  const life = effect.remaining / effect.duration;
  const progress = 1 - life;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const nx = -dy / length;
  const ny = dx / length;
  const points: Point[] = [];
  for (let i = 0; i <= 7; i += 1) {
    const t = i / 7;
    const wave = i === 0 || i === 7 ? 0 : Math.sin(i * 2.31 + effect.remaining * 0.58) * (10 + Math.sin(progress * Math.PI) * 7);
    points.push({ x: from.x + dx * t + nx * wave, y: from.y + dy * t + ny * wave });
  }

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = `rgba(108, 192, 232, ${0.48 + life * 0.34})`;
  ctx.shadowBlur = 13;
  ctx.strokeStyle = `rgba(80, 166, 218, ${0.48 + life * 0.38})`;
  ctx.lineWidth = 8;
  strokePolyline(ctx, points);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = `rgba(252, 247, 174, ${0.72 + life * 0.2})`;
  ctx.lineWidth = 3;
  strokePolyline(ctx, points);
  ctx.strokeStyle = `rgba(255, 255, 255, ${0.58 + life * 0.22})`;
  ctx.lineWidth = 1.2;
  strokePolyline(ctx, points);
  for (let i = 2; i < points.length - 1; i += 2) {
    const p = points[i]!;
    ctx.strokeStyle = `rgba(128, 213, 242, ${0.28 + life * 0.26})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + nx * 20 - dx / length * 9, p.y + ny * 20 - dy / length * 9);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHealEffect(renderer: EffectRenderContext, effect: WorldEffect, point: Point, life: number) {
  const { ctx, worldToScreen } = renderer;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (hasEffectVector(effect)) {
    const from = worldToScreen({ x: effect.fromX, y: effect.fromY });
    const gradient = ctx.createLinearGradient(from.x, from.y, point.x, point.y);
    gradient.addColorStop(0, `rgba(149, 205, 114, ${0.08 + life * 0.14})`);
    gradient.addColorStop(0.62, `rgba(112, 188, 96, ${0.3 + life * 0.28})`);
    gradient.addColorStop(1, `rgba(234, 255, 205, ${0.58 + life * 0.28})`);
    ctx.shadowColor = "rgba(114, 190, 98, 0.42)";
    ctx.shadowBlur = 9;
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  }

  const pulse = 1 - life;
  const ring = 14 + pulse * 20;
  ctx.shadowColor = "rgba(116, 188, 93, 0.48)";
  ctx.shadowBlur = 12;
  ctx.strokeStyle = `rgba(95, 157, 76, ${0.3 + life * 0.42})`;
  ctx.fillStyle = `rgba(155, 216, 123, ${0.08 + life * 0.08})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(point.x, point.y, ring, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = `rgba(244, 255, 222, ${0.72 + life * 0.18})`;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(point.x - 12, point.y);
  ctx.lineTo(point.x + 12, point.y);
  ctx.moveTo(point.x, point.y - 12);
  ctx.lineTo(point.x, point.y + 12);
  ctx.stroke();
  ctx.restore();
}

function drawRepairEffect(ctx: CanvasRenderingContext2D, point: Point, life: number, remaining: number) {
  const pulse = 1 - life;
  const ring = 16 + pulse * 18;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(49, 95, 135, 0.34)";
  ctx.shadowBlur = 8;
  ctx.strokeStyle = `rgba(49, 95, 135, ${0.32 + life * 0.38})`;
  ctx.fillStyle = `rgba(185, 134, 27, ${0.06 + life * 0.08})`;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.ellipse(point.x, point.y + 16, ring * 1.15, ring * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = `rgba(185, 134, 27, ${0.46 + life * 0.32})`;
  ctx.lineWidth = 3;
  for (let i = 0; i < 4; i += 1) {
    const angle = remaining * 0.34 + i * (Math.PI / 2);
    const x = point.x + Math.cos(angle) * (10 + pulse * 16);
    const y = point.y + 8 + Math.sin(angle) * (5 + pulse * 7);
    ctx.beginPath();
    ctx.moveTo(x - 5, y - 3);
    ctx.lineTo(x + 5, y + 3);
    ctx.moveTo(x + 2, y - 6);
    ctx.lineTo(x - 2, y + 6);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSummonEffect(ctx: CanvasRenderingContext2D, point: Point, life: number) {
  const open = 1 - life;
  ctx.save();
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(96, 111, 190, 0.5)";
  ctx.shadowBlur = 12;
  ctx.fillStyle = `rgba(72, 88, 154, ${0.08 + life * 0.12})`;
  ctx.strokeStyle = `rgba(94, 92, 170, ${0.42 + life * 0.36})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(point.x, point.y + 14, 18 + open * 22, 8 + open * 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = `rgba(226, 220, 255, ${0.48 + life * 0.3})`;
  ctx.lineWidth = 2;
  for (let i = 0; i < 6; i += 1) {
    const angle = i * (Math.PI / 3) + open * 2.2;
    const inner = 9 + open * 10;
    const outer = 24 + open * 18;
    ctx.beginPath();
    ctx.moveTo(point.x + Math.cos(angle) * inner, point.y + Math.sin(angle) * inner + 8);
    ctx.lineTo(point.x + Math.cos(angle) * outer, point.y + Math.sin(angle) * outer + 8);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCurseEffect(ctx: CanvasRenderingContext2D, point: Point, life: number) {
  const spread = 1 - life;
  ctx.save();
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(122, 55, 112, 0.45)";
  ctx.shadowBlur = 10;
  ctx.strokeStyle = `rgba(116, 49, 106, ${0.45 + life * 0.38})`;
  ctx.fillStyle = `rgba(84, 37, 86, ${0.08 + life * 0.1})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(point.x, point.y + 9, 15 + spread * 24, 7 + spread * 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = `rgba(232, 187, 226, ${0.5 + life * 0.26})`;
  ctx.lineWidth = 2.2;
  for (let i = 0; i < 4; i += 1) {
    const offset = (i - 1.5) * 9;
    ctx.beginPath();
    ctx.moveTo(point.x + offset, point.y - 24 - spread * 8);
    ctx.quadraticCurveTo(point.x + offset + 6, point.y - 9, point.x + offset - 2, point.y + 6);
    ctx.stroke();
  }
  ctx.restore();
}

function drawStormEffect(ctx: CanvasRenderingContext2D, effect: WorldEffect, point: Point, life: number) {
  const radius = effect.radius ?? 145;
  const churn = 1 - life;
  ctx.save();
  const gradient = ctx.createRadialGradient(point.x, point.y, 8, point.x, point.y, radius);
  gradient.addColorStop(0, `rgba(207, 236, 245, ${0.16 + life * 0.1})`);
  gradient.addColorStop(0.55, `rgba(84, 154, 194, ${0.13 + life * 0.13})`);
  gradient.addColorStop(1, "rgba(49, 95, 135, 0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(83, 157, 205, 0.35)";
  ctx.shadowBlur = 10;
  for (let ring = 0; ring < 3; ring += 1) {
    ctx.strokeStyle = `rgba(64, 130, 178, ${0.2 + life * 0.18 - ring * 0.04})`;
    ctx.lineWidth = 2.2 - ring * 0.3;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius * (0.36 + ring * 0.24) + Math.sin(effect.remaining * 0.16 + ring) * 5, churn * Math.PI + ring, churn * Math.PI + ring + Math.PI * 1.35);
    ctx.stroke();
  }
  ctx.strokeStyle = `rgba(219, 244, 252, ${0.46 + life * 0.24})`;
  ctx.lineWidth = 2.4;
  for (let i = 0; i < 9; i += 1) {
    const angle = i * 1.73 + effect.remaining * 0.12;
    const lane = radius * (0.18 + ((i * 37) % 64) / 100);
    const x = point.x + Math.cos(angle) * lane;
    const y = point.y + Math.sin(angle) * lane;
    ctx.beginPath();
    ctx.moveTo(x - 4, y - 14);
    ctx.lineTo(x + 5, y + 12);
    ctx.stroke();
  }
  ctx.restore();
}

function drawGuardianFieldEffect(ctx: CanvasRenderingContext2D, effect: WorldEffect, point: Point, life: number) {
  const radius = effect.radius ?? 280;
  const pulse = 1 - life;
  ctx.save();
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(216, 175, 74, 0.36)";
  ctx.shadowBlur = 12;
  ctx.fillStyle = `rgba(208, 182, 82, ${0.035 + life * 0.035})`;
  ctx.strokeStyle = `rgba(166, 137, 53, ${0.28 + life * 0.22})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(point.x, point.y + 12, radius, radius * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = `rgba(245, 231, 157, ${0.42 + life * 0.28})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(point.x, point.y + 12, radius * (0.72 + pulse * 0.12), radius * (0.3 + pulse * 0.05), 0, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 6; i += 1) {
    const angle = i * (Math.PI / 3) + pulse * 0.8;
    const x = point.x + Math.cos(angle) * radius * 0.5;
    const y = point.y + Math.sin(angle) * radius * 0.2 + 12;
    ctx.beginPath();
    ctx.moveTo(x, y - 9);
    ctx.lineTo(x + 8, y - 2);
    ctx.lineTo(x + 5, y + 9);
    ctx.lineTo(x - 5, y + 9);
    ctx.lineTo(x - 8, y - 2);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

function drawExperienceBurstEffect(ctx: CanvasRenderingContext2D, point: Point, life: number) {
  const burst = 1 - life;
  ctx.save();
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(219, 168, 48, 0.58)";
  ctx.shadowBlur = 14;
  ctx.strokeStyle = `rgba(213, 151, 34, ${0.38 + life * 0.34})`;
  ctx.lineWidth = 3;
  for (let i = 0; i < 10; i += 1) {
    const angle = i * (Math.PI / 5);
    const inner = 8 + burst * 8;
    const outer = 22 + burst * 36;
    ctx.beginPath();
    ctx.moveTo(point.x + Math.cos(angle) * inner, point.y + Math.sin(angle) * inner);
    ctx.lineTo(point.x + Math.cos(angle) * outer, point.y + Math.sin(angle) * outer);
    ctx.stroke();
  }
  ctx.fillStyle = `rgba(255, 244, 174, ${0.72 + life * 0.18})`;
  ctx.beginPath();
  ctx.moveTo(point.x, point.y - 18);
  ctx.lineTo(point.x + 5, point.y - 5);
  ctx.lineTo(point.x + 18, point.y);
  ctx.lineTo(point.x + 5, point.y + 5);
  ctx.lineTo(point.x, point.y + 18);
  ctx.lineTo(point.x - 5, point.y + 5);
  ctx.lineTo(point.x - 18, point.y);
  ctx.lineTo(point.x - 5, point.y - 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawLevelUpEffect(ctx: CanvasRenderingContext2D, point: Point, life: number) {
  const burst = 1 - life;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(242, 208, 92, 0.58)";
  ctx.shadowBlur = 15;
  ctx.strokeStyle = `rgba(138, 100, 24, ${0.32 + life * 0.42})`;
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 3; i += 1) {
    ctx.beginPath();
    ctx.ellipse(point.x, point.y + 9 - i * 8, 18 + burst * (28 + i * 9), 6 + burst * (8 + i * 3), 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = `rgba(242, 208, 92, ${0.5 + life * 0.38})`;
  for (let i = 0; i < 8; i += 1) {
    const angle = i * (Math.PI / 4);
    const inner = 12 + burst * 10;
    const outer = 28 + burst * 38;
    ctx.beginPath();
    ctx.moveTo(point.x + Math.cos(angle) * inner, point.y - 6 + Math.sin(angle) * inner);
    ctx.lineTo(point.x + Math.cos(angle) * outer, point.y - 6 + Math.sin(angle) * outer);
    ctx.stroke();
  }
  drawLevelStar(ctx, point.x, point.y - 31 - burst * 16, 3);
  ctx.restore();
}

function drawFlameBurnEffect(ctx: CanvasRenderingContext2D, point: Point, life: number) {
  const flare = 1 - life;
  ctx.save();
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(205, 84, 42, 0.48)";
  ctx.shadowBlur = 12;
  ctx.strokeStyle = `rgba(179, 66, 45, ${0.42 + life * 0.34})`;
  ctx.fillStyle = `rgba(218, 92, 42, ${0.07 + life * 0.12})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(point.x, point.y, 22 + flare * 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = `rgba(247, 171, 78, ${0.5 + life * 0.28})`;
  ctx.lineWidth = 2;
  for (let i = 0; i < 7; i += 1) {
    const angle = i * 0.9 + flare * 2;
    const base = 20 + flare * 20;
    ctx.beginPath();
    ctx.moveTo(point.x + Math.cos(angle) * base, point.y + Math.sin(angle) * base);
    ctx.quadraticCurveTo(point.x + Math.cos(angle + 0.35) * (base + 10), point.y + Math.sin(angle + 0.35) * (base + 10), point.x + Math.cos(angle + 0.1) * (base + 22), point.y + Math.sin(angle + 0.1) * (base + 22));
    ctx.stroke();
  }
  ctx.restore();
}

function strokePolyline(ctx: CanvasRenderingContext2D, points: Point[]) {
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();
}

// @@@projectile-trail - Ranged attacks should read as short fading motion, not a source-to-target debug line.
function drawProjectileTrail(ctx: CanvasRenderingContext2D, from: Point, to: Point, head: Point, progress: number, life: number) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / length;
  const uy = dy / length;
  const trailLength = Math.min(92, Math.max(24, length * 0.42));
  const tail = {
    x: head.x - ux * trailLength,
    y: head.y - uy * trailLength,
  };
  const flightGlow = Math.sin(progress * Math.PI);
  const alpha = Math.max(0.22, Math.min(0.95, 0.24 + flightGlow * 0.62 + life * 0.12));
  const cool = { r: 49, g: 95, b: 135 };
  const ember = mixRgb({ r: 190, g: 62, b: 55 }, { r: 226, g: 129, b: 52 }, progress);
  const hot = mixRgb({ r: 96, g: 139, b: 166 }, { r: 242, g: 208, b: 92 }, Math.min(1, progress * 1.18));
  const gradient = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
  gradient.addColorStop(0, rgba(cool, 0));
  gradient.addColorStop(0.34, rgba(cool, alpha * 0.28));
  gradient.addColorStop(0.72, rgba(ember, alpha * 0.68));
  gradient.addColorStop(1, rgba(hot, alpha));

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = rgba(ember, alpha * 0.58);
  ctx.shadowBlur = 8;
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(tail.x, tail.y);
  ctx.lineTo(head.x, head.y);
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = rgba({ r: 255, g: 251, b: 227 }, alpha * 0.62);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(tail.x + ux * trailLength * 0.52, tail.y + uy * trailLength * 0.52);
  ctx.lineTo(head.x, head.y);
  ctx.stroke();

  ctx.fillStyle = rgba(hot, alpha);
  ctx.strokeStyle = rgba({ r: 36, g: 49, b: 38 }, alpha * 0.55);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(head.x, head.y, 4.6, 3.2, Math.atan2(dy, dx), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function mixRgb(from: { r: number; g: number; b: number }, to: { r: number; g: number; b: number }, amount: number) {
  const clamped = Math.max(0, Math.min(1, amount));
  return {
    r: Math.round(from.r + (to.r - from.r) * clamped),
    g: Math.round(from.g + (to.g - from.g) * clamped),
    b: Math.round(from.b + (to.b - from.b) * clamped),
  };
}

function rgba(color: { r: number; g: number; b: number }, alpha: number) {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${Math.max(0, Math.min(1, alpha))})`;
}

function hasEffectVector(effect: WorldEffect): effect is WorldEffect & Required<Pick<WorldEffect, "fromX" | "fromY" | "toX" | "toY">> {
  return (
    typeof effect.fromX === "number" &&
    typeof effect.fromY === "number" &&
    typeof effect.toX === "number" &&
    typeof effect.toY === "number"
  );
}
