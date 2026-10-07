import { afterEach, describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { setScratchCanvasFactory } from './art/scratch-canvas';
import { drawTerrain } from './terrain-art';
import { waterCover } from './water-art';
import type { Terrain } from '../shared/terrain';

afterEach(() => setScratchCanvasFactory(undefined));
describe('water coverage across chunks and camera movement', () => {
  it('matches one continuous seabed at world borders and through every 512-unit chunk edge', () => {
    setScratchCanvasFactory((w, h) => createCanvas(w, h) as unknown as HTMLCanvasElement);
    const terrain: Terrain = { cols: 80, rows: 40, cell: 32, cells: '~'.repeat(3200) };
    const expected = createCanvas(1800, 900), actual = createCanvas(1800, 900);
    expected.getContext('2d').drawImage(waterCover(terrain) as never, 0, 0, 2560, 1280);
    drawTerrain(actual.getContext('2d') as never, terrain, { x: 0, y: 0 }, 1800, 900);
    const a = actual.getContext('2d').getImageData(0, 0, 1800, 900).data;
    const b = expected.getContext('2d').getImageData(0, 0, 1800, 900).data;
    let error = 0; for (let i = 0; i < a.length; i++) error = Math.max(error, Math.abs(a[i]! - b[i]!));
    expect(error).toBeLessThanOrEqual(1);
  });
  it('keeps the same shore and moving waves in the same world position when the camera crosses chunks', () => {
    setScratchCanvasFactory((w, h) => createCanvas(w, h) as unknown as HTMLCanvasElement);
    const terrain: Terrain = { cols: 80, rows: 40, cell: 32, cells: Array.from({ length: 40 }, (_, y) => '.'.repeat(8 + y % 3) + ','.repeat(3) + '~'.repeat(69 - y % 3)).join('') };
    const make = (x: number, y: number) => {
      const canvas = createCanvas(1280, 760), ctx = canvas.getContext('2d');
      ctx.fillStyle = '#b7b48e'; ctx.fillRect(0, 0, 1280, 760);
      drawTerrain(ctx as never, terrain, { x, y }, 1280, 760, 1.25);
      return ctx;
    };
    const a = make(127, 61).getImageData(257, 256, 1023, 504).data;
    const b = make(384, 317).getImageData(0, 0, 1023, 504).data;
    let error = 0; for (let i = 0; i < a.length; i++) error = Math.max(error, Math.abs(a[i]! - b[i]!));
    expect(error).toBeLessThanOrEqual(1);
  });
});
