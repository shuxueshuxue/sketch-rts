import { afterEach, describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { setScratchCanvasFactory } from './art/scratch-canvas';
import { clearCanvasArtCache } from './atlas-art';
import { actionPaintSize } from './art/action-direction';
import { createPirateBoarding } from './menu-pirate-boarding';
import { createCapitalStreet } from './menu-capital-street';
import { unitGlyphScale } from './glyphs';
import type { UnitAnimationFrame } from './unit-animation';
import { figures } from './art/appearance';
import { paintFigure } from './art/painted-units';
import type { UnitKind } from '../shared/types';

afterEach(() => { clearCanvasArtCache(); setScratchCanvasFactory(undefined); });

// Paint one pose into a card as the world's card batches do (origin at the card's centre, feet 17 below it) and report
// whether anything opaque touches the card's border: a figure that does was cut off there.
function touchesBorder(paint: (ctx: CanvasRenderingContext2D) => void, tile: number) {
  const canvas = createCanvas(tile, tile), ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  ctx.translate(tile / 2, tile / 2); paint(ctx);
  const data = canvas.getContext('2d').getImageData(0, 0, tile, tile).data;
  const opaque = (x: number, y: number) => data[(y * tile + x) * 4 + 3]! > 8;
  for (let i = 0; i < tile; i++) if (opaque(i, 0) || opaque(i, tile - 1) || opaque(0, i) || opaque(tile - 1, i)) return true;
  return false;
}

const POSES: UnitAnimationFrame[] = [{ mode: 'idle', frame: 0 }, ...[0, 2, 4, 6].map(frame => ({ mode: 'walk' as const, frame })), ...[0, 2, 4, 5].map(frame => ({ mode: 'attack' as const, frame }))];

// Measure the shared face landmark in world coordinates, rather than costume bounds:
// the captain's hat may be taller, but his body must match an ordinary footman.
function faceLandmark(paint: (ctx: CanvasRenderingContext2D) => void, scale: number) {
  const ctx = createCanvas(256, 256).getContext('2d') as unknown as CanvasRenderingContext2D;
  ctx.scale(scale, scale);
  const moveTo = ctx.moveTo.bind(ctx);
  let point: { x: number; y: number } | undefined;
  ctx.moveTo = (x, y) => {
    if (x === -3 && y === -34) {
      const m = ctx.getTransform();
      point = { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
    }
    moveTo(x, y);
  };
  paint(ctx);
  expect(point).toBeDefined();
  return point;
}

describe('home figures use their gameplay body size', () => {
  for (const run of [createPirateBoarding(1), createCapitalStreet()]) {
    const variants = new Map(run.game.units.filter(unit => unit.variant).map(unit => [unit.variant!, unit]));
    for (const [variant, unit] of variants) it(variant, () => {
      const model = run.models!(variant)!;
      for (const pose of POSES.filter(pose => pose.mode !== 'attack')) {
        const scale = unitGlyphScale(unit.radius);
        const gameplay = faceLandmark(ctx => { paintFigure(ctx, unit.kind, '#856144', pose, 1); }, scale);
        const home = faceLandmark(ctx => model.paint(ctx, '#856144', pose, 1), scale);
        expect(home, `${pose.mode} ${pose.frame}`).toEqual(gameplay);
      }
      for (const pose of POSES) {
        expect(model.paint.paintSize!(pose)).toBe(actionPaintSize(pose, unit.kind));
        expect(touchesBorder(ctx => model.paint(ctx, '#856144', pose, 1), actionPaintSize(pose, unit.kind))).toBe(false);
      }
    });
  }
});

// The game's own troops, on land and on deck, share the card path at their own size: each fits the card its pose takes.
describe('every troop keeps its head on its own card', () => {
  for (const kind of Object.keys(figures) as UnitKind[]) it(kind, () => {
    setScratchCanvasFactory((w, h) => createCanvas(w, h) as unknown as HTMLCanvasElement);
    for (const pose of POSES) expect(touchesBorder(ctx => { paintFigure(ctx, kind, '#856144', pose, 1); }, actionPaintSize(pose, kind)), `${pose.mode} ${pose.frame}`).toBe(false);
  });
});
