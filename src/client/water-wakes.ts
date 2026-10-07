import { shipProfile } from '../shared/ship-geometry';
import type { Unit } from '../shared/types';

/** Foam follows actual forward speed and physical hull dimensions. It never
 * moves, rocks or rescales the ship; three short paths cost no render pass. */
export function drawShipWake(ctx: CanvasRenderingContext2D, ship: Unit, point: { x:number; y:number }, heading: number, seconds: number) {
  const profile = shipProfile(ship), speed = ship.sailing?.speed ?? 0;
  if (!profile || speed < 4) return;
  const strength = Math.min(1, speed / 70), stern = -profile.length / 2;
  const trail = profile.length * (.35 + strength * .4), halfBeam = profile.beam / 2;
  ctx.save(); ctx.translate(point.x, point.y); ctx.rotate(heading);
  ctx.lineCap = 'round'; ctx.strokeStyle = '#d7e6d4';
  ctx.globalAlpha *= strength * (.16 + .025 * Math.sin(seconds * 1.8 + ship.x * .013));
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (const side of [-1, 1]) {
    ctx.moveTo(stern + 2, side * halfBeam * .48);
    ctx.quadraticCurveTo(stern - trail * .35, side * halfBeam * .8, stern - trail, side * halfBeam * 1.65);
  }
  ctx.stroke();
  ctx.globalAlpha *= .5; ctx.lineWidth = 2.5; ctx.beginPath();
  ctx.moveTo(stern - 2, 0); ctx.lineTo(stern - trail * .8, 0); ctx.stroke();
  ctx.globalAlpha *= 2; ctx.lineWidth = 1.6; ctx.beginPath();
  ctx.moveTo(profile.length / 2 - 4, -halfBeam * .25);
  ctx.quadraticCurveTo(profile.length / 2 + 3, 0, profile.length / 2 - 4, halfBeam * .25);
  ctx.stroke(); ctx.restore();
}
