import { createCanvas } from '@napi-rs/canvas';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { paintCreature, creatureReleaseSocket } from './painted-creatures';
import { paintCorpse } from './corpses';
import type { UnitAnimationFrame } from '../unit-animation';

function image(pose: UnitAnimationFrame, team = '#477b91') {
  const canvas = createCanvas(352, 352), b = canvas.getContext('2d');
  b.translate(176, 212); b.scale(2, 2);
  paintCreature(b as unknown as CanvasRenderingContext2D, 'spirit', team, pose);
  return canvas.getContext('2d').getImageData(0, 0, 352, 352).data;
}
const same = (a: Uint8ClampedArray, z: Uint8ClampedArray) => Buffer.from(a).equals(Buffer.from(z));

it('keeps spirit contact attached to the sleeve through directional recovery', () => {
  for (const mode of ['attack', 'cast'] as const) for (const aim of [-6, -4, 0, 4, 6]) for (let frame = 0; frame < 6; frame++) {
    const pose = { mode, aim, frame }, socket = creatureReleaseSocket('spirit', pose)!;
    const canvas = createCanvas(352, 352), b = canvas.getContext('2d');
    b.translate(176, 212); b.scale(2, 2);
    paintCreature(b as unknown as CanvasRenderingContext2D, 'spirit', '#477b91', pose);
    const pixels = b.getImageData(Math.round(176 + socket.x * 2) - 2, Math.round(212 + socket.y * 2) - 2, 5, 5).data;
    expect(pixels.some((v, i) => i % 4 === 3 && v >= 102), `${mode}/${aim}/${frame}`).toBe(true);
  }
});

it('gives all three attack variants and up/level/down gestures distinct drawings', () => {
  const hashes = new Set<string>();
  for (const aim of [-4, 0, 4]) for (let variant = 0; variant < 3; variant++) {
    const pixels = image({ mode: 'attack', frame: 0, variant, aim });
    hashes.add(createHash('sha256').update(pixels).digest('hex'));
  }
  expect(hashes.size).toBe(9);
  expect(same(image({ mode: 'cast', frame: 0, aim: 4 }), image({ mode: 'attack', frame: 0, aim: 4 }))).toBe(false);
});

it('retains actual idle sharing and exact ready endpoints, and burns in its owner\'s colour', () => {
  for (const [a, z] of [[0, 4], [1, 3], [5, 7]]) expect(same(image({ mode: 'idle', frame: a! }), image({ mode: 'idle', frame: z! }))).toBe(true);
  const idle = image({ mode: 'idle', frame: 0 });
  expect(same(image({ mode: 'idle', frame: 0 }, '#b8614b'), idle)).toBe(false);
  for (const mode of ['attack', 'cast'] as const) for (const aim of [-6, -4, 0, 4, 6]) {
    expect(same(image({ mode, frame: 5, aim, variant: 2 }), idle)).toBe(true);
  }
});

it('leaves quiet spectral remains with no detached physical body', () => {
  const canvas = createCanvas(160, 160), b = canvas.getContext('2d'); b.translate(80, 80);
  paintCorpse(b as unknown as CanvasRenderingContext2D, 'spirit');
  const pixels = b.getImageData(0, 0, 160, 160).data;
  let count = 0, opaque = 0, top = 160, bottom = 0;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) {
    count++; opaque = Math.max(opaque, pixels[i]!);
    top = Math.min(top, Math.floor(i / 4 / 160)); bottom = Math.max(bottom, Math.floor(i / 4 / 160));
  }
  expect(count).toBeGreaterThan(60); expect(opaque).toBeLessThan(160);
  expect(top).toBeGreaterThan(70); expect(bottom).toBeLessThan(91);
});
