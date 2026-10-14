import type {ProjectileOrigin} from './projectile-origins';
import { drawChainLightningEffect, drawHealEffect, drawSummonEffect, drawCurseEffect, drawStormEffect, drawGuardianFieldEffect, drawExperienceBurstEffect, drawFlameBurnEffect, drawPhysicalMissile, drawArrow, drawSpellOrb, drawProjectileTrail, drawChargeTrail, drawChargeImpact, drawGoldBountyEffect } from "./art/canvas-effects";
import { estimatedRider, riderRadius, hasEffectVector, chargeTrailFrame, chargeImpactFrame, projectileLook, launchPoint, arrowFrame, isUnitKind, TOWER_ARROW_SCALE, spellOrbPalette } from "./art/effect-presentation";
import { drawWarfareEffect } from "./warfare-effects";
import { SHIP_CAMERA } from "../shared/ship-geometry";
import { GUARDIAN_SCROLL } from "../shared/item-rules";
import { drawVeteranCastEffect } from './ability-effects';
import { shouldRenderCommandFeedback } from './command-feedback';
import type { GameSnapshot, PlayerId, Unit, WorldEffect } from "../shared/types";

type Point = { x: number; y: number };

type RenderWorldEffectsOptions = {
  ctx: CanvasRenderingContext2D;
  effects: WorldEffect[];
  worldToScreen: (point: Point) => Point;
  nearScreen: (point: Point, pad: number) => boolean;
  /** Where a unit is drawn (world point), for effects that follow one (a charging rider's trail). */
  unitPosition?: (unitId: string) => Point | undefined;
  unit?: (unitId:string)=>Unit|undefined;
  viewer?:PlayerId | undefined;
  players?:GameSnapshot["players"];
  reducedMotion?:boolean;
  /** The event-driven presentation tracker already draws directional charge accents. */
  combatTrails?:boolean;
  projectileOrigin?:(effect:WorldEffect)=>ProjectileOrigin|undefined;
};

export function renderWorldEffects(options: RenderWorldEffectsOptions) {
  const { ctx, effects, worldToScreen, nearScreen, unitPosition } = options;
  const renderer = { ctx, worldToScreen };
  for (const effect of effects) {
    if(effect.remaining<=0 || !shouldRenderCommandFeedback(effect,options.viewer))continue;
    if (drawWarfareEffect(ctx,effect,worldToScreen,nearScreen)) continue;
    if (effect.type === "chargeTrail" && hasEffectVector(effect)) {
      if(options.combatTrails)continue;
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
      const origin=options.projectileOrigin?.(effect);
      const from = worldToScreen({ x: origin?.x??effect.fromX, y: (origin?.y??effect.fromY)-(origin?.height??effect.fromHeight??0)*Math.tan(SHIP_CAMERA.tilt) });
      const to = worldToScreen({ x: effect.toX, y: effect.toY-(effect.toHeight ?? 0)*Math.tan(SHIP_CAMERA.tilt) });
      if (!nearScreen(to, 90) && !nearScreen(from, 90)) continue;
      const progress = 1 - effect.remaining / effect.duration;
      const look = projectileLook(effect.sourceKind,effect.attackKind);
      if (look !== "streak") {
        const sourceKind = effect.sourceKind;
        const launch = origin ? from : sourceKind ? launchPoint(from, to, sourceKind) : from;
        if (look === "arrow") drawArrow(ctx, arrowFrame(launch, to, progress, !sourceKind || isUnitKind(sourceKind) ? 1 : TOWER_ARROW_SCALE));
        else if (look === "orb") drawSpellOrb(ctx, launch, to, progress, spellOrbPalette(sourceKind, effect.owner ? options.players?.[effect.owner]?.race : undefined));
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

    // The unit pose carries weapon swings and real work strokes.
    if (effect.type === "melee" || effect.type === "repair" || effect.type === "build") continue;

    if (effect.type === "chainLightning" && hasEffectVector(effect)) {
      const from = worldToScreen({ x: effect.fromX, y: effect.fromY });
      const to = worldToScreen({ x: effect.toX, y: effect.toY });
      if (!nearScreen(to, 120) && !nearScreen(from, 120)) continue;
      drawChainLightningEffect(ctx, effect, from, to);
      continue;
    }

    const point = worldToScreen(effect);
    const pad = effect.type === "guardianField" || effect.type === "storm" ? (effect.radius ?? (effect.type === "guardianField" ? GUARDIAN_SCROLL.radius : 145)) + 80 : 90;
    if (!nearScreen(point, pad)) continue;
    const life = effect.remaining / effect.duration;
    const radius = 9 + (1 - life) * 22;
    const caster=effect.unitId?options.unit?.(effect.unitId):undefined;
    const casterPoint=effect.radius && effect.unitId ? unitPosition?.(effect.unitId) : undefined;
    if(drawVeteranCastEffect(ctx,effect,caster,casterPoint?worldToScreen(casterPoint):point,options.reducedMotion))continue;

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

    if (effect.type === "boardingBlocked") {
      ctx.save();
      ctx.strokeStyle = "#c37639"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(point.x-5,point.y-12); ctx.lineTo(point.x+5,point.y-2);
      ctx.moveTo(point.x+5,point.y-12); ctx.lineTo(point.x-5,point.y-2); ctx.stroke(); ctx.restore(); continue;
    }
    if (effect.type === "heal") {
      drawHealEffect(renderer, effect, point, life);
      continue;
    }

    if (effect.type === "summon") {
      drawSummonEffect(ctx, point, life);
      continue;
    }

    if(effect.type==="itemReceived"){
      ctx.save();ctx.globalAlpha=life;ctx.strokeStyle="#ebce7e";ctx.fillStyle="#6b502b";ctx.lineWidth=2;
      const y=point.y-28-(1-life)*20;
      ctx.beginPath();ctx.ellipse(point.x,point.y,18+(1-life)*20,9+(1-life)*10,0,0,Math.PI*2);ctx.stroke();
      ctx.fillRect(point.x-8,y-6,16,12);ctx.strokeRect(point.x-8,y-6,16,12);
      ctx.beginPath();ctx.moveTo(point.x-8,y-1);ctx.lineTo(point.x+8,y-1);ctx.stroke();ctx.restore();continue;
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
