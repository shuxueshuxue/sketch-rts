import { createCanvas } from '@napi-rs/canvas';
import { expect, it } from 'vitest';
import { ITEM_DEFS } from '../../shared/equipment';
import type { ItemKind } from '../../shared/types';
import { drawPaintedItem } from './items';

it('renders every gameplay item through the shared shop, inventory and drop painter', () => {
  for (const kind of Object.keys(ITEM_DEFS) as ItemKind[]) for (const ground of [false, true]) {
    const canvas = createCanvas(96, 96);
    const ctx = canvas.getContext('2d');
    drawPaintedItem(ctx as unknown as CanvasRenderingContext2D, kind, { x: 48, y: 48 }, 58, ground);
    const pixels = ctx.getImageData(0, 0, 96, 96).data;
    let covered = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index]) covered++;
    expect(covered, `${kind} ground=${ground}`).toBeGreaterThan(100);
    const transform = ctx.getTransform();
    expect([transform.a, transform.b, transform.c, transform.d, transform.e, transform.f]).toEqual([1, 0, 0, 1, 0, 0]);
  }
});
