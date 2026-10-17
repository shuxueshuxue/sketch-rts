import { afterEach, describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { setScratchCanvasFactory } from './art/scratch-canvas';
import { clearCanvasArtCache } from './atlas-art';
import { actionPaintSize } from './art/action-direction';
import { createPirateBoarding } from './menu-pirate-boarding';
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

// @@@story-figure-size - The home screen's boarders are painted half again a footman's size and more.
describe('a larger-than-life figure keeps its head on its card', () => {
  setScratchCanvasFactory((w, h) => createCanvas(w, h) as unknown as HTMLCanvasElement);
  const run = createPirateBoarding(1);
  for (const variant of ['menu/pirate', 'menu/pirate-captain', 'menu/marine']) {
    const model = run.models!(variant)!;
    it(`${variant} fits its own card in every pose, and was cut off on a footman's`, () => {
      setScratchCanvasFactory((w, h) => createCanvas(w, h) as unknown as HTMLCanvasElement);
      let cut = false;
      for (const pose of POSES) {
        const paint = (ctx: CanvasRenderingContext2D) => model.paint(ctx, '#856144', pose, 1);
        expect(touchesBorder(paint, model.paint.paintSize!(pose)), `${pose.mode} ${pose.frame}`).toBe(false);
        cut ||= touchesBorder(paint, actionPaintSize(pose, 'footman'));
      }
      expect(cut).toBe(true);
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
