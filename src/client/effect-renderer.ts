import { BUILDING_DEFS, UNIT_DEFS, hasSpell } from "../shared/catalog";
import { drawWarfareEffect } from "./warfare-effects";
import { seconds } from "../shared/time";
import type { UnitKind, WorldEffect } from "../shared/types";

type Point = { x: number; y: number };
type Rgb = { r: number; g: number; b: number };

type RenderWorldEffectsOptions = {
  ctx: CanvasRenderingContext2D;
  effects: WorldEffect[];
  worldToScreen: (point: Point) => Point;
  nearScreen: (point: Point, pad: number) => boolean;
  /** Where a unit is drawn (world point), for effects that follow one (a charging rider's trail). */
  unitPosition?: (unitId: string) => Point | undefined;
};

type EffectRenderContext = {
  ctx: CanvasRenderingContext2D;
  worldToScreen: (point: Point) => Point;
};

export type HammerEffectKind = "build" | "repair";

export type HammerEffectFrame = {
  angle: number;
  siteStroke: string;
  siteFill: string;
  sparkStroke: string;
  handleStroke: string;
  headStroke: string;
  site: { rx: number; ry: number };
  impact: Point;
  handle: { from: Point; to: Point };
  head: { from: Point; to: Point };
};

export function hammerEffectFrame(kind: HammerEffectKind, life: number, remaining: number): HammerEffectFrame {
  const clampedLife = Math.max(0, Math.min(1, life));
  const pulse = 1 - clampedLife;
  const swing = (Math.sin(remaining * 0.76) + 1) / 2;
  const angle = 0.64 + swing * 0.82 - Math.PI / 2;
  const handleLength = 34;
  const pivot = { x: -24, y: 4 };
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const impact = { x: pivot.x + dx * handleLength, y: pivot.y + dy * handleLength };
  const handle = {
    from: pivot,
    to: impact,
  };
  const headHalf = 8.5;
  const headCenter = { x: impact.x + dx * 2, y: impact.y + dy * 2 };
  const px = -dy;
  const py = dx;

  return {
    angle,
    siteStroke: kind === "build" ? `rgba(49, 95, 135, ${0.34 + clampedLife * 0.34})` : `rgba(185, 134, 27, ${0.42 + clampedLife * 0.34})`,
    siteFill: kind === "build" ? `rgba(49, 95, 135, ${0.05 + clampedLife * 0.07})` : `rgba(185, 134, 27, ${0.06 + clampedLife * 0.08})`,
    sparkStroke: kind === "build" ? `rgba(101, 142, 170, ${0.5 + clampedLife * 0.28})` : `rgba(222, 174, 63, ${0.54 + clampedLife * 0.28})`,
    handleStroke: "rgba(123, 86, 31, 0.86)",
    headStroke: "rgba(36, 49, 38, 0.86)",
    site: { rx: 18 + pulse * 16, ry: 7 + pulse * 5 },
    impact,
    handle,
    head: {
      from: { x: headCenter.x - px * headHalf, y: headCenter.y - py * headHalf },
      to: { x: headCenter.x + px * headHalf, y: headCenter.y + py * headHalf },
    },
  };
}

export function renderWorldEffects(options: RenderWorldEffectsOptions) {
  const { ctx, effects, worldToScreen, nearScreen, unitPosition } = options;
  const renderer = { ctx, worldToScreen };
  for (const effect of effects) {
    if (drawWarfareEffect(ctx,effect,worldToScreen,nearScreen)) continue;
    if (effect.type === "chargeTrail" && hasEffectVector(effect)) {
      const from = worldToScreen({ x: effect.fromX, y: effect.fromY });
      const to = worldToScreen({ x: effect.toX, y: effect.toY });
      const life = effect.remaining / effect.duration;
      const followed = effect.unitId ? unitPosition?.(effect.unitId) : undefined;
      const rider = followed ? worldToScreen(followed) : estimatedRider(from, to, life, effect.sourceKind);
      if (!nearScreen(rider, 140) && !nearScreen(from, 140)) continue;
      drawChargeTrail(ctx, chargeTrailFrame(from, rider, to, life, riderRadius(effect.sourceKind)));
      continue;
    }

    if (effect.type === "chargeImpact" && hasEffectVector(effect)) {
      const point = worldToScreen(effect);
      if (!nearScreen(point, 90)) continue;
      const from = worldToScreen({ x: effect.fromX, y: effect.fromY });
      drawChargeImpact(ctx, chargeImpactFrame(point, from, effect.remaining / effect.duration));
      continue;
    }

    if (effect.type === "projectile" && hasEffectVector(effect)) {
      const from = worldToScreen({ x: effect.fromX, y: effect.fromY });
      const to = worldToScreen({ x: effect.toX, y: effect.toY });
      if (!nearScreen(to, 90) && !nearScreen(from, 90)) continue;
      const progress = 1 - effect.remaining / effect.duration;
      const look = projectileLook(effect.sourceKind);
      if (look !== "streak") {
        const sourceKind = effect.sourceKind!;
        const launch = launchPoint(from, to, sourceKind);
        if (look === "arrow") drawArrow(ctx, arrowFrame(launch, to, progress, isUnitKind(sourceKind) ? 1 : TOWER_ARROW_SCALE));
        else if (look === "orb") drawSpellOrb(ctx, launch, to, progress, spellOrbPalette(sourceKind));
        else drawPhysicalMissile(ctx, launch, to, progress, look);
        continue;
      }
      const head = {
        x: from.x + (to.x - from.x) * progress,
        y: from.y + (to.y - from.y) * progress,
      };
      drawProjectileTrail(ctx, from, to, head, progress, effect.remaining / effect.duration);
      continue;
    }

    // Weapon poses carry the swing; a source-to-target line duplicates it.
    if (effect.type === "melee") continue;

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
      // Brief, local contact glint, no expanding cross across adjacent troops.
      if (life < .55) continue;
      ctx.save();
      ctx.globalAlpha *= (life-.55)/.45*.7;
      ctx.strokeStyle = "#e4d2aa"; ctx.lineWidth = 1.3;
      const at = effect.unitId ? unitPosition?.(effect.unitId) : undefined;
      const contact = at ? worldToScreen(at) : point;
      ctx.beginPath();
      ctx.moveTo(contact.x-2,contact.y-10);ctx.lineTo(contact.x+2,contact.y-14);
      ctx.moveTo(contact.x+1,contact.y-10);ctx.lineTo(contact.x+3,contact.y-9);
      ctx.stroke();ctx.restore();
      continue;
    }

    if (effect.type === "attackTarget" || effect.type === "queuedAttackTarget") {
      const pulse = life * .5;
      ctx.setLineDash(effect.type === "queuedAttackTarget" ? [5, 5] : []);
      ctx.strokeStyle = effect.type === "queuedAttackTarget" ? `rgba(155, 47, 47, ${pulse * 0.58})` : `rgba(155, 47, 47, ${pulse})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(point.x, point.y + 10, 14, 6, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      continue;
    }

    if (effect.type === "heal") {
      drawHealEffect(renderer, effect, point, life);
      continue;
    }

    if (effect.type === "repair") {
      if (effect.unitId) {
        const at = unitPosition?.(effect.unitId) ?? effect;
        drawWorkerHammer(ctx, worldToScreen(at), effect.remaining, (effect.fromX ?? effect.x) < at.x);
      }
      continue;
    }

    if (effect.type === "build") {
      // The actual builders animate at their hands; a site needs no floating icon.
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

    if (effect.type === "goldBounty") {
      drawGoldBountyEffect(ctx, point, life, effect.amount ?? 0);
      continue;
    }

    if (effect.type === "experienceBurst") {
      drawExperienceBurstEffect(ctx, point, life);
      continue;
    }

    // The creeps' powers (see @@@creep-abilities): a stomp's dust ring, a web's strands, bloodlust's red flare.
    if (effect.type === "stomp") {
      ctx.save();
      ctx.strokeStyle = `rgba(122, 96, 60, ${0.7 * life})`;
      ctx.lineWidth = 4;
      const reach = (effect.radius ?? 160) * (1.1 - life * 0.6);
      ctx.beginPath();
      ctx.ellipse(point.x, point.y + 6, reach, reach * 0.45, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      continue;
    }
    if (effect.type === "web") {
      ctx.save();
      ctx.strokeStyle = `rgba(235, 232, 220, ${0.85 * Math.min(1, life * 3)})`;
      ctx.lineWidth = 1.4;
      for (let spoke = 0; spoke < 6; spoke += 1) {
        const angle = (spoke / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(point.x, point.y + 4);
        ctx.lineTo(point.x + Math.cos(angle) * 18, point.y + 4 + Math.sin(angle) * 9);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.ellipse(point.x, point.y + 4, 11, 5.5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      continue;
    }
    if (effect.type === "bloodlust") {
      ctx.save();
      ctx.strokeStyle = `rgba(181, 52, 40, ${life})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(point.x, point.y - 10, radius * 0.8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      continue;
    }

    if (effect.type === "flameBurn" || effect.type === "scorch") {
      drawFlameBurnEffect(ctx, point, life, effect.remaining);
      continue;
    }

    ctx.lineWidth = 2;
    ctx.save();
    ctx.setLineDash(isQueuedEffect(effect.type) ? [4, 5] : []);
    ctx.strokeStyle = effect.type === "mine" || effect.type === "queuedMine" ? "#b9861b" : effect.type === "attack" || effect.type === "queuedAttack" ? "#9b2f2f" : "#243126";
    if (isQueuedEffect(effect.type)) ctx.globalAlpha *= 0.58;
    ctx.beginPath();
    ctx.globalAlpha *= life * .6;
    ctx.arc(point.x, point.y, 8 + (1-life)*3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function isQueuedEffect(type: WorldEffect["type"]) {
  return type === "queuedMove" || type === "queuedMine" || type === "queuedRepair" || type === "queuedAttack" || type === "queuedAttackTarget";
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

// @@@flame-burn - A burn is fire on the body, not a blast ring: flame tongues lick up from the target's feet, embers
// drift off, and a faint scorch mark stays on the ground while it fades.
const FLAME_TONGUES: readonly { dx: number; base: number; height: number; width: number }[] = [
  { dx: -9, base: 12, height: 14, width: 7 },
  { dx: -3, base: 13, height: 22, width: 8 },
  { dx: 4, base: 12, height: 19, width: 8 },
  { dx: 10, base: 11, height: 12, width: 6 },
  { dx: 0, base: 5, height: 11, width: 5 },
];

function drawFlameBurnEffect(ctx: CanvasRenderingContext2D, point: Point, life: number, tick: number) {
  const flare = 1 - life;
  const strength = Math.min(1, life * 1.6);
  const rise = Math.min(1, flare * 4);
  ctx.save();
  ctx.fillStyle = `rgba(74, 44, 28, ${0.16 * life})`;
  ctx.beginPath();
  ctx.ellipse(point.x, point.y + 13, 15, 5.5, 0, 0, Math.PI * 2);
  ctx.fill();
  const glow = ctx.createRadialGradient(point.x, point.y + 4, 0, point.x, point.y + 4, 24);
  glow.addColorStop(0, `rgba(247, 150, 62, ${0.26 * strength})`);
  glow.addColorStop(1, "rgba(247, 150, 62, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(point.x, point.y + 4, 24, 0, Math.PI * 2);
  ctx.fill();
  FLAME_TONGUES.forEach((tongue, index) => {
    const flicker = 0.78 + 0.22 * Math.sin(tick * 0.9 + index * 1.7);
    drawFlameTongue(ctx, point.x + tongue.dx, point.y + tongue.base, tongue.height * rise * flicker, tongue.width, Math.sin(tick * 0.6 + index) * 2, strength * 0.85);
  });
  drawEmbers(ctx, point, flare, tick, 5, strength);
  ctx.restore();
}

/** Small flames that stay on a scorched unit for as long as the scorch lasts, fading over its last second. */
export function drawScorchedUnitFlames(ctx: CanvasRenderingContext2D, point: Point, radius: number, now: number, remainingTicks: number) {
  const strength = Math.min(1, remainingTicks / seconds(1)) * 0.6;
  const tick = now / 50;
  const spread = radius * 0.45;
  ctx.save();
  drawFlameTongue(ctx, point.x - spread, point.y + 4, 9 + Math.sin(tick * 0.8) * 2, 5, Math.sin(tick * 0.5) * 1.5, strength);
  drawFlameTongue(ctx, point.x + spread * 0.6, point.y + 1, 12 + Math.sin(tick * 0.7 + 2) * 2.5, 6, Math.sin(tick * 0.45 + 1) * 1.5, strength);
  drawEmbers(ctx, { x: point.x, y: point.y - 6 }, (tick / 40) % 1, tick, 3, strength);
  ctx.restore();
}

function drawFlameTongue(ctx: CanvasRenderingContext2D, x: number, baseY: number, height: number, width: number, lean: number, alpha: number) {
  if (height < 1 || alpha <= 0) return;
  const tipX = x + lean;
  const tipY = baseY - height;
  const gradient = ctx.createLinearGradient(0, baseY, 0, tipY);
  gradient.addColorStop(0, `rgba(186, 56, 38, ${alpha})`);
  gradient.addColorStop(0.45, `rgba(236, 124, 48, ${alpha})`);
  gradient.addColorStop(1, `rgba(255, 214, 110, ${alpha * 0.85})`);
  ctx.fillStyle = gradient;
  flameTonguePath(ctx, x, baseY, tipX, tipY, width, height);
  ctx.fill();
  ctx.fillStyle = `rgba(255, 242, 196, ${alpha * 0.7})`;
  flameTonguePath(ctx, x + lean * 0.2, baseY, x + lean * 0.6, baseY - height * 0.5, width * 0.42, height * 0.5);
  ctx.fill();
}

function flameTonguePath(ctx: CanvasRenderingContext2D, x: number, baseY: number, tipX: number, tipY: number, width: number, height: number) {
  ctx.beginPath();
  ctx.moveTo(x - width / 2, baseY);
  ctx.bezierCurveTo(x - width * 0.7, baseY - height * 0.45, tipX - width * 0.15, tipY + height * 0.25, tipX, tipY);
  ctx.bezierCurveTo(tipX + width * 0.2, tipY + height * 0.3, x + width * 0.7, baseY - height * 0.4, x + width / 2, baseY);
  ctx.quadraticCurveTo(x, baseY + width * 0.35, x - width / 2, baseY);
  ctx.closePath();
}

function drawEmbers(ctx: CanvasRenderingContext2D, point: Point, phase: number, tick: number, count: number, strength: number) {
  for (let index = 0; index < count; index += 1) {
    const t = (phase + index * 0.19) % 1;
    const x = point.x + Math.sin(index * 2.3 + tick * 0.25) * (5 + index * 2);
    const y = point.y + 6 - t * 34;
    ctx.fillStyle = `rgba(255, ${190 - index * 12}, 90, ${(1 - t) * 0.8 * strength})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
}

function strokePolyline(ctx: CanvasRenderingContext2D, points: Point[]) {
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();
}

export type ProjectileLook = "arrow" | "orb" | "streak" | "fire" | "spear" | "stone" | "shell";

// @@@projectile-look - The shooter's rules pick the missile: a unit with a spell throws a small spell orb (its weapon is
// weak), any other ranged unit and a tower shoot an arrow (a rider's charge is no spell). Item blasts carry no shooter
// and keep the old streak.
export function projectileLook(sourceKind: WorldEffect["sourceKind"]): ProjectileLook {
  if (!sourceKind) return "streak";
  if (sourceKind === "redDragon" || sourceKind === "dragonWhelp" || sourceKind === "fireShip") return "fire";
  if (sourceKind === "murlocHunter") return "spear";
  if (sourceKind === "thornSlinger") return "stone";
  if (sourceKind === "warship" || sourceKind === "bombardShip" || sourceKind === "catapult" || sourceKind === "organGun") return "shell";
  if (sourceKind === "archer" || sourceKind === "horseArcher" || sourceKind === "sparkArcher" || sourceKind === "contractArcher" || sourceKind === "defenseTower" || sourceKind === "cutter" || sourceKind === "ballista") return "arrow";
  if (isUnitKind(sourceKind) && hasSpell(sourceKind)) return "orb";
  return "stone";
}

function drawPhysicalMissile(ctx: CanvasRenderingContext2D, from: Point, to: Point, progress: number, look: "fire" | "spear" | "stone" | "shell") {
  const frame = arrowFrame(from, to, progress, look === "spear" ? 1.15 : 0.55);
  ctx.save(); ctx.translate(frame.tip.x, frame.tip.y); ctx.rotate(frame.angle);
  if (look === "fire") {
    const glow = ctx.createRadialGradient(-3, 0, 1, -3, 0, 15);
    glow.addColorStop(0, '#e8b466a8'); glow.addColorStop(1, '#b8522b00');
    ctx.fillStyle = glow; ctx.fillRect(-20,-16,36,32);
    ctx.fillStyle = '#b96539'; ctx.beginPath(); ctx.moveTo(6,0); ctx.quadraticCurveTo(-3,-8,-18,-3); ctx.lineTo(-13,0); ctx.lineTo(-21,4); ctx.quadraticCurveTo(-2,8,6,0); ctx.fill();
    ctx.fillStyle = '#f0d092'; ctx.beginPath(); ctx.ellipse(0,0,5,2.5,0,0,Math.PI*2); ctx.fill();
  } else if (look === "spear") {
    ctx.strokeStyle='#9a8767'; ctx.lineWidth=1.8; ctx.beginPath(); ctx.moveTo(-24,0); ctx.lineTo(-3,0); ctx.stroke();
    ctx.fillStyle='#c0c5b7'; ctx.strokeStyle='#373e3d'; ctx.lineWidth=.7; ctx.beginPath(); ctx.moveTo(3,0); ctx.lineTo(-5,-2.5); ctx.lineTo(-4,2.5); ctx.closePath(); ctx.fill(); ctx.stroke();
  } else {
    ctx.fillStyle = look === "stone" ? '#8b8874' : '#555b59'; ctx.strokeStyle='#292f30'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.ellipse(0,0,look === "stone" ? 4.5 : 3.5,3.5,0,0,Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle='#d8cdb09a'; ctx.beginPath(); ctx.moveTo(-2,-2); ctx.lineTo(1,-3); ctx.stroke();
  }
  ctx.restore();
}

function drawWorkerHammer(ctx: CanvasRenderingContext2D, point: Point, remaining: number, left: boolean) {
  const strike = Math.sin(remaining / 2.6);
  ctx.save(); ctx.translate(point.x + (left ? -13 : 13), point.y - 12); ctx.scale(left ? -1 : 1,1); ctx.rotate(-.5 + strike*.65);
  ctx.lineCap='round'; ctx.strokeStyle='#343a36'; ctx.lineWidth=3.3;
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(0,-12); ctx.stroke();
  ctx.strokeStyle='#a88b62'; ctx.lineWidth=1.8; ctx.stroke();
  ctx.fillStyle='#77817f'; ctx.strokeStyle='#30393a'; ctx.lineWidth=.8;
  ctx.fillRect(-5,-15,10,4); ctx.strokeRect(-5,-15,10,4);
  ctx.strokeStyle='#d5d0b3'; ctx.beginPath(); ctx.moveTo(-4,-15); ctx.lineTo(4,-15); ctx.stroke();
  ctx.restore();
}

function isUnitKind(kind: NonNullable<WorldEffect["sourceKind"]>): kind is UnitKind {
  return kind in UNIT_DEFS;
}

const LAUNCH_REACH = 0.8;

/** Missiles leave from the shooter's edge (its catalog radius toward the target), not from the middle of its body. */
export function launchPoint(from: Point, to: Point, sourceKind: NonNullable<WorldEffect["sourceKind"]>): Point {
  const radius = isUnitKind(sourceKind) ? UNIT_DEFS[sourceKind].radius : BUILDING_DEFS[sourceKind].radius;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return from;
  const reach = Math.min(radius * LAUNCH_REACH, length / 2);
  return { x: from.x + (dx / length) * reach, y: from.y + (dy / length) * reach };
}

const ARROW_LENGTH = 22;
const TOWER_ARROW_SCALE = 1.2;
const ARROW_ARC_RATIO = 0.12;
const ARROW_MAX_ARC = 36;

export type ArrowFrame = { tip: Point; tail: Point; angle: number; length: number };

/** An arrow lobbed along a shallow arc from shooter to target: its tip rides the arc and it points along its path. */
export function arrowFrame(from: Point, to: Point, progress: number, scale = 1): ArrowFrame {
  const p = Math.max(0, Math.min(1, progress));
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lift = Math.min(ARROW_MAX_ARC, Math.hypot(dx, dy) * ARROW_ARC_RATIO);
  const tip = { x: from.x + dx * p, y: from.y + dy * p - 4 * lift * p * (1 - p) };
  const angle = Math.atan2(dy - 4 * lift * (1 - 2 * p), dx);
  const length = ARROW_LENGTH * scale;
  return { tip, tail: { x: tip.x - Math.cos(angle) * length, y: tip.y - Math.sin(angle) * length }, angle, length };
}

function drawArrow(ctx: CanvasRenderingContext2D, frame: ArrowFrame) {
  const { tip, tail, angle, length } = frame;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const px = -uy;
  const py = ux;
  const headLength = length * 0.3;
  const headHalf = length * 0.14;
  const neck = { x: tip.x - ux * headLength, y: tip.y - uy * headLength };
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(60, 50, 35, 0.2)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(tail.x - ux * length * 0.7, tail.y - uy * length * 0.7);
  ctx.lineTo(tail.x, tail.y);
  ctx.stroke();

  ctx.strokeStyle = "#5b4127";
  ctx.lineWidth = Math.max(1.6, length * 0.08);
  ctx.beginPath();
  ctx.moveTo(tail.x, tail.y);
  ctx.lineTo(neck.x, neck.y);
  ctx.stroke();

  ctx.fillStyle = "#34403b";
  ctx.strokeStyle = "#1f2a24";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(neck.x + px * headHalf, neck.y + py * headHalf);
  ctx.lineTo(neck.x + ux * headLength * 0.25, neck.y + uy * headLength * 0.25);
  ctx.lineTo(neck.x - px * headHalf, neck.y - py * headHalf);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const vane = length * 0.24;
  const spread = length * 0.13;
  ctx.fillStyle = "#efe6cc";
  ctx.strokeStyle = "rgba(60, 50, 35, 0.7)";
  for (const side of [1, -1]) {
    ctx.beginPath();
    ctx.moveTo(tail.x + ux * vane, tail.y + uy * vane);
    ctx.lineTo(tail.x + px * spread * side + ux * vane * 0.35, tail.y + py * spread * side + uy * vane * 0.35);
    ctx.lineTo(tail.x + px * spread * side - ux * 1.5, tail.y + py * spread * side - uy * 1.5);
    ctx.lineTo(tail.x, tail.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

export type SpellOrbPalette = { glow: Rgb; core: Rgb };

const SPELL_ORB_PALETTES: Record<"grove" | "ember" | "unaligned", SpellOrbPalette> = {
  grove: { glow: { r: 64, g: 164, b: 136 }, core: { r: 228, g: 255, b: 242 } },
  ember: { glow: { r: 222, g: 108, b: 48 }, core: { r: 255, g: 238, b: 204 } },
  unaligned: { glow: { r: 132, g: 112, b: 196 }, core: { r: 242, g: 236, b: 255 } },
};

export function spellOrbPalette(sourceKind: NonNullable<WorldEffect["sourceKind"]>): SpellOrbPalette {
  const race = isUnitKind(sourceKind) ? UNIT_DEFS[sourceKind].race : undefined;
  return SPELL_ORB_PALETTES[race ?? "unaligned"];
}

// A caster's weapon is a pinprick next to its spell, so its orb stays small and faint: smaller than an arrow's head
// to tail, and never brighter than the spell effects drawn above.
function drawSpellOrb(ctx: CanvasRenderingContext2D, from: Point, to: Point, progress: number, palette: SpellOrbPalette) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / length;
  const uy = dy / length;
  const bob = Math.sin(progress * Math.PI * 3) * 1.5;
  const head = { x: from.x + dx * progress - uy * bob, y: from.y + dy * progress + ux * bob };
  const fade = Math.min(1, progress * 6, (1 - progress) * 8 + 0.35);
  ctx.save();
  for (let index = 3; index >= 1; index -= 1) {
    ctx.fillStyle = rgba(palette.glow, (0.3 - index * 0.07) * fade);
    ctx.beginPath();
    ctx.arc(head.x - ux * index * 5, head.y - uy * index * 5, 2.2 - index * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  const glow = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 7);
  glow.addColorStop(0, rgba(palette.glow, 0.42 * fade));
  glow.addColorStop(1, rgba(palette.glow, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(head.x, head.y, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgba(palette.core, 0.85 * fade);
  ctx.strokeStyle = rgba(palette.glow, 0.6 * fade);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(head.x, head.y, 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// @@@projectile-trail - Item blasts read as short fading motion, not a source-to-target debug line.
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

// @@@charge-trail - A charging rider leaves speed lines streaming off its back and a wake of dust kicked up along the
// ground it has covered, the newest puffs small and thick at its hooves, the older ones spread and thin; both fade as
// the dash runs out. On impact (chargeImpact) a flash of gold rays and sparks thrown forward bursts on the target inside
// a ring of dust rolling outward. Everything is placed from the effect's own numbers (no randomness, no clock), so a
// frame drawn twice is drawn the same, in the browser and in recordings alike.
const CHARGE_STREAKS = [
  { side: -0.85, length: 0.72 },
  { side: -0.4, length: 1 },
  { side: 0.05, length: 0.86 },
  { side: 0.45, length: 0.96 },
  { side: 0.9, length: 0.66 },
] as const;
const CHARGE_STREAK_REACH = 96;
const CHARGE_DUST_SPACING = 24;
const CHARGE_DUST_REACH = 260;
const DUST = { r: 150, g: 122, b: 84 };
const DUST_EDGE = { r: 104, g: 80, b: 50 };
const INK = { r: 36, g: 49, b: 38 };
const SPARK_HOT = { r: 255, g: 246, b: 204 };
const SPARK = { r: 242, g: 184, b: 60 };

export type ChargeTrailFrame = {
  streaks: { from: Point; to: Point; alpha: number; width: number }[];
  puffs: { x: number; y: number; rx: number; ry: number; alpha: number }[];
};

export function chargeTrailFrame(start: Point, rider: Point, target: Point, life: number, radius: number): ChargeTrailFrame {
  const heading = unitVector(start, target) ?? unitVector(start, rider) ?? { x: 1, y: 0 };
  const across = { x: -heading.y, y: heading.x };
  const traveled = Math.hypot(rider.x - start.x, rider.y - start.y);
  // Full strength while the rider runs, easing out over the dash's last third.
  const strength = Math.max(0, Math.min(1, life * 3));
  const back = { x: rider.x - heading.x * radius * 0.7, y: rider.y - heading.y * radius * 0.7 };
  const streakReach = Math.min(CHARGE_STREAK_REACH, traveled + radius);
  const streaks = CHARGE_STREAKS.map((streak, index) => {
    const from = { x: back.x + across.x * streak.side * radius, y: back.y + across.y * streak.side * radius };
    const length = streakReach * streak.length;
    return {
      from,
      to: { x: from.x - heading.x * length, y: from.y - heading.y * length },
      alpha: (0.34 + 0.18 * (index % 2)) * strength,
      width: index === 2 ? 2.4 : 1.6,
    };
  }).filter((streak) => streak.alpha > 0.01 && streakReach > 2);
  const ground = radius * 0.72;
  const puffs: ChargeTrailFrame["puffs"] = [];
  const wake = Math.min(traveled, CHARGE_DUST_REACH);
  for (let behind = CHARGE_DUST_SPACING * 0.5, index = 0; behind <= wake; behind += CHARGE_DUST_SPACING, index += 1) {
    const age = behind / CHARGE_DUST_REACH;
    const sway = Math.sin(index * 2.39 + 0.7) * radius * 0.35;
    const rx = radius * (0.34 + age * 0.9);
    puffs.push({
      x: rider.x - heading.x * behind + across.x * sway,
      y: rider.y - heading.y * behind + across.y * sway + ground,
      rx,
      ry: rx * 0.5,
      alpha: (0.46 * (1 - age) + 0.04) * strength,
    });
  }
  return { streaks, puffs: puffs.filter((puff) => puff.alpha > 0.01) };
}

function drawChargeTrail(ctx: CanvasRenderingContext2D, frame: ChargeTrailFrame) {
  ctx.save();
  // Oldest dust first, so the fresh puffs at the hooves sit on top.
  for (const puff of [...frame.puffs].reverse()) {
    ctx.fillStyle = rgba(DUST, puff.alpha * 0.55);
    ctx.strokeStyle = rgba(DUST_EDGE, puff.alpha);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(puff.x, puff.y, puff.rx, puff.ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.lineCap = "round";
  for (const streak of frame.streaks.slice(0, 1)) {
    const gradient = ctx.createLinearGradient(streak.from.x, streak.from.y, streak.to.x, streak.to.y);
    gradient.addColorStop(0, rgba(INK, streak.alpha * .2));
    gradient.addColorStop(1, rgba(INK, 0));
    ctx.strokeStyle = gradient;
    ctx.lineWidth = streak.width;
    ctx.beginPath();
    ctx.moveTo(streak.from.x, streak.from.y);
    ctx.lineTo(streak.to.x, streak.to.y);
    ctx.stroke();
  }
  ctx.restore();
}

// Without the rider's drawn position (an effect drawn on its own), guess it from the dash's progress.
function estimatedRider(from: Point, to: Point, life: number, sourceKind: WorldEffect["sourceKind"]): Point {
  const heading = unitVector(from, to);
  if (!heading) return from;
  const run = Math.max(0, Math.hypot(to.x - from.x, to.y - from.y) - riderRadius(sourceKind) * 2) * Math.max(0, Math.min(1, 1 - life));
  return { x: from.x + heading.x * run, y: from.y + heading.y * run };
}

function riderRadius(sourceKind: WorldEffect["sourceKind"]) {
  return sourceKind && isUnitKind(sourceKind) ? UNIT_DEFS[sourceKind].radius : 18;
}

// The blow lands hard but it is only two blows' worth: a short flash, a few sparks, a puff of dust.
const CHARGE_RAYS = 6;
const CHARGE_SPARKS = [-0.6, -0.2, 0.2, 0.6] as const;
const CHARGE_CLODS = 4;

export type ChargeImpactFrame = {
  ring: { x: number; y: number; rx: number; ry: number; alpha: number };
  rays: { from: Point; to: Point; alpha: number }[];
  sparks: { from: Point; to: Point; alpha: number }[];
  clods: { x: number; y: number; r: number; alpha: number }[];
};

export function chargeImpactFrame(point: Point, rider: Point, life: number): ChargeImpactFrame {
  const clamped = Math.max(0, Math.min(1, life));
  const burst = 1 - clamped;
  const heading = unitVector(rider, point) ?? { x: 1, y: 0 };
  const angle = Math.atan2(heading.y, heading.x);
  const flash = Math.max(0, (clamped - 0.5) / 0.5);
  const rays = flash > 0
    ? Array.from({ length: CHARGE_RAYS }, (_, index) => {
        const ray = angle + (index / CHARGE_RAYS) * Math.PI * 2;
        const inner = 6 + burst * 6;
        const outer = inner + 6 + burst * 12 * (index % 2 === 0 ? 1 : 0.6);
        return {
          from: { x: point.x + Math.cos(ray) * inner, y: point.y + Math.sin(ray) * inner * 0.8 },
          to: { x: point.x + Math.cos(ray) * outer, y: point.y + Math.sin(ray) * outer * 0.8 },
          alpha: flash * 0.6,
        };
      })
    : [];
  const sparks = CHARGE_SPARKS.map((spread, index) => {
    const direction = angle + spread;
    const reach = 8 + burst * (20 + (index % 2) * 8);
    const fall = burst * burst * 6;
    const head = { x: point.x + Math.cos(direction) * reach, y: point.y + Math.sin(direction) * reach * 0.8 + fall };
    return { from: { x: head.x - Math.cos(direction) * 6, y: head.y - Math.sin(direction) * 5 }, to: head, alpha: clamped * 0.8 };
  });
  const ringRx = 12 + burst * 26;
  const clods = Array.from({ length: CHARGE_CLODS }, (_, index) => {
    const around = angle + Math.PI * (0.3 + index * 0.45);
    return {
      x: point.x + Math.cos(around) * ringRx * 0.9,
      y: point.y + 12 + Math.sin(around) * ringRx * 0.36,
      r: 1.5 + (index % 2) + burst * 1.5,
      alpha: clamped * 0.6,
    };
  });
  return { ring: { x: point.x, y: point.y + 12, rx: ringRx, ry: ringRx * 0.38, alpha: clamped * 0.7 }, rays, sparks, clods };
}

function drawChargeImpact(ctx: CanvasRenderingContext2D, frame: ChargeImpactFrame) {
  const { ring } = frame;
  ctx.save();
  ctx.lineCap = "round";
  ctx.fillStyle = rgba(DUST, ring.alpha * 0.18);
  ctx.strokeStyle = rgba(DUST_EDGE, ring.alpha * 0.6);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(ring.x, ring.y, ring.rx, ring.ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  for (const clod of frame.clods) {
    ctx.fillStyle = rgba(DUST, clod.alpha * 0.7);
    ctx.strokeStyle = rgba(DUST_EDGE, clod.alpha);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(clod.x, clod.y, clod.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  for (const ray of frame.rays.slice(0, 2)) {
    ctx.strokeStyle = rgba(SPARK, ray.alpha * 0.85);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ray.from.x, ray.from.y);
    ctx.lineTo(ray.to.x, ray.to.y);
    ctx.stroke();
    ctx.strokeStyle = rgba(SPARK_HOT, ray.alpha);
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
  for (const spark of frame.sparks.slice(0, 2)) {
    ctx.strokeStyle = rgba(SPARK, spark.alpha);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(spark.from.x, spark.from.y);
    ctx.lineTo(spark.to.x, spark.to.y);
    ctx.stroke();
    ctx.fillStyle = rgba(SPARK_HOT, spark.alpha);
    ctx.beginPath();
    ctx.arc(spark.to.x, spark.to.y, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function unitVector(from: Point, to: Point): Point | undefined {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  return length > 0.001 ? { x: (to.x - from.x) / length, y: (to.y - from.y) / length } : undefined;
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

// Deterministic coin arcs and a rising receipt, timed by normalized lifetime.
export function drawGoldBountyEffect(ctx: CanvasRenderingContext2D, point: Point, life: number, amount: number) {
  const elapsed = 1 - Math.max(0, Math.min(1, life));
  ctx.save();
  ctx.globalAlpha = Math.min(1, life * 3);
  ctx.lineWidth = 1.5;
  for (let index = 0; index < 5; index++) {
    const spread = (index - 2) * 12 * elapsed;
    const lift = Math.sin(elapsed * Math.PI) * (19 + (index % 2) * 9);
    ctx.beginPath();
    ctx.ellipse(point.x + spread, point.y - 8 - lift, 3.5, 4.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#f3cf59"; ctx.strokeStyle = "#8c651d"; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(point.x + spread, point.y - 10 - lift); ctx.lineTo(point.x + spread, point.y - 6 - lift); ctx.stroke();
  }
  ctx.font = "bold 14px sans-serif"; ctx.textAlign = "center";
  ctx.lineWidth = 3; ctx.strokeStyle = "#382f21"; ctx.fillStyle = "#ffe18a";
  const textY = point.y - 32 - elapsed * 25;
  ctx.strokeText(`+${amount}`, point.x, textY); ctx.fillText(`+${amount}`, point.x, textY);
  ctx.restore();
}
