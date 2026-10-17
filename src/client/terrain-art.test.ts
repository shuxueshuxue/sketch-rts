import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { setScratchCanvasFactory } from './art/scratch-canvas';
import { drawTerrain, paintTerrainChunk, setTerrainChunkPainter } from './terrain-art';
import type { Terrain } from '../shared/terrain';

// Two chunks side by side: forest on the left, open ground with a pond on the right.
const map = (): Terrain => ({ cols: 32, rows: 16, cell: 32, cells: Array.from({ length: 16 }, (_, row) => 'T'.repeat(16) + '.'.repeat(4) + (row > 4 && row < 11 ? '~'.repeat(6) : '.'.repeat(6)) + '.'.repeat(6)).join('') });
const frame = (terrain: Terrain) => {
  const canvas = createCanvas(1024, 512), ctx = canvas.getContext('2d');
  drawTerrain(ctx as never, terrain, { x: 0, y: 0 }, 1024, 512);
  return ctx.getImageData(0, 0, 1024, 512).data;
};
const difference = (a: Uint8ClampedArray, b: Uint8ClampedArray) => { let most = 0; for (let i = 0; i < a.length; i++) most = Math.max(most, Math.abs(a[i]! - b[i]!)); return most; };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => { setTerrainChunkPainter(undefined); setScratchCanvasFactory(undefined); vi.restoreAllMocks(); });
describe('terrain chunks painted off the frame', () => {
  it('asks the chunk painter once per missing chunk and lays its coarse colours until the painting arrives', async () => {
    setScratchCanvasFactory((w, h) => createCanvas(w, h) as unknown as HTMLCanvasElement);
    const terrain = map(), asked: string[] = [];
    let arrive!: () => void;
    const arrived = new Promise<void>((resolve) => { arrive = resolve; });
    setTerrainChunkPainter(async (t, cx, cy, density) => { asked.push(`${cx},${cy},${density}`); await arrived; return paintTerrainChunk(t, cx, cy, density); });
    const coarse = frame(terrain);
    frame(terrain);
    expect(asked).toEqual(['0,0,1', '1,0,1']);
    // Deep in the forest the coarse picture is the minimap's forest colour.
    expect([...coarse.slice((256 * 1024 + 256) * 4, (256 * 1024 + 256) * 4 + 4)]).toEqual([0x5a, 0x74, 0x49, 255]);
    arrive();
    await settle();
    const painted = frame(terrain);
    expect(asked).toHaveLength(2);
    setTerrainChunkPainter(undefined);
    expect(difference(painted, frame(map()))).toBe(0);
    expect(difference(coarse, painted)).toBeGreaterThan(0);
  });

  it('paints chunks where they are needed again once the chunk painter fails', async () => {
    setScratchCanvasFactory((w, h) => createCanvas(w, h) as unknown as HTMLCanvasElement);
    const failed = vi.spyOn(console, 'error').mockImplementation(() => {});
    const terrain = map(), painter = vi.fn(() => Promise.reject(new Error('no thread')));
    setTerrainChunkPainter(painter);
    frame(terrain);
    await settle();
    const after = frame(terrain);
    expect(painter).toHaveBeenCalledTimes(2);
    expect(failed).toHaveBeenCalled();
    expect(difference(after, frame(map()))).toBe(0);
  });
});
