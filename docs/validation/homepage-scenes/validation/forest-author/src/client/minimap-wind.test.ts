import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import type { GameMap } from '../shared/types';
import { WIND_CHANGE_INTERVAL_TICKS, windAt } from '../shared/wind-field';
import { drawMinimapWind, projectWindDirection, WindMapDisplay, type WindSampler } from './minimap-wind';

const boundary = WIND_CHANGE_INTERVAL_TICKS;
const point = { x: 200, y: 100 };
const rect = { x: 20, y: 30, width: 220, height: 220 };
function map(direction = 0, speed = 80): GameMap {
  return { id: 'combatArena', name: 'Wind chart', width: 1600, height: 800, landmarks: [], wind: { direction, speed } };
}
function changed(fromDirection = 0, direction = Math.PI / 2, fromSpeed = 80, speed = 40): GameMap {
  return { ...map(direction, speed), wind: { direction, speed, changedAtTick: boundary, fromDirection, fromSpeed } };
}
function start(display = new WindMapDisplay(), fromDirection = 0, direction = Math.PI / 2) {
  display.update({ tick: boundary - 1, map: map(fromDirection) }, 0);
  display.update({ tick: boundary, map: changed(fromDirection, direction) }, 100);
  return display;
}

describe('wind chart event display', () => {
  it('does not replay a saved event when a match is first displayed', () => {
    const display = new WindMapDisplay();
    display.update({ tick: boundary, map: changed() }, 100);
    expect(display.sample(point, 100)).toMatchObject({ direction: Math.PI / 2, speed: 40 });
    expect(display.pulse(300)).toBe(0);
  });

  it('turns through the shortest angle and blends speed without changing simulation wind', () => {
    const from = 179 * Math.PI / 180, to = -179 * Math.PI / 180;
    const display = start(new WindMapDisplay(), from, to);
    expect(display.sample(point, 100).direction).toBeCloseTo(from, 8);
    expect(display.sample(point, 850).direction).toBeCloseTo(Math.PI, 8);
    expect(display.sample(point, 850).speed).toBeCloseTo(60, 8);
    expect(display.sample(point, 1600).direction).toBeCloseTo(to, 8);
    expect(windAt(changed(from, to), point).direction).toBeCloseTo(to, 8);
  });

  it('does not restart the notice for repeated snapshots or while paused', () => {
    const display = start();
    expect(display.pulse(240)).toBeGreaterThan(0);
    display.update({ tick: boundary, map: changed() }, 900);
    expect(display.sample(point, 1600).direction).toBeCloseTo(Math.PI / 2);
    display.update({ tick: boundary, map: changed() }, 3000);
    expect(display.pulse(3000)).toBe(0);
    expect(display.pulse(1e6)).toBe(0);
  });

  it('clears a notice on rewind and suppresses weather crossed by a stale snapshot jump', () => {
    const display = start();
    display.update({ tick: boundary - 20, map: map() }, 250);
    expect(display.pulse(300)).toBe(0);
    expect(display.sample(point, 300).direction).toBe(0);
    display.update({ tick: boundary + 100, map: changed() }, 400);
    expect(display.pulse(500)).toBe(0);
    expect(display.sample(point, 500).direction).toBeCloseTo(Math.PI / 2);
  });

  it('resets for a different match or an explicit reset without a stray notification', () => {
    const display = start();
    display.update({ tick: boundary + 1, map: { ...changed(), id: 'bareDuel' } }, 250);
    expect(display.pulse(300)).toBe(0);
    display.reset();
    display.update({ tick: boundary, map: changed() }, 400);
    expect(display.pulse(500)).toBe(0);
  });

  it('keeps the last displayed field stable when a caller changes a map object', () => {
    const display = new WindMapDisplay(), source = map();
    display.update({ tick: 0, map: source }, 0);
    source.wind!.direction = Math.PI / 2;
    expect(display.sample(point, 100).direction).toBe(0);
  });

  it('uses a static brief highlight and no rotation or moving sweep for reduced motion', () => {
    const display = start(new WindMapDisplay({ reducedMotion: true }));
    expect(display.sample(point, 100).direction).toBeCloseTo(Math.PI / 2);
    expect(display.pulse(100)).toBe(1);
    expect(display.pulse(1500)).toBe(1);
    expect(display.pulse(2800)).toBe(0);
    const render = (now: number) => {
      const canvas = createCanvas(260, 280);
      display.draw(canvas.getContext('2d') as never, rect, now);
      return Buffer.from(canvas.getContext('2d').getImageData(0, 0, 260, 280).data);
    };
    expect(render(200).equals(render(1200))).toBe(true);
  });
});

describe('wind chart spatial rendering', () => {
  it('samples every grid cell in world coordinates through the same path as the cursor indicator', () => {
    const samples: { point: { x: number; y: number }; direction: number; speed: number }[] = [];
    const sampler: WindSampler = (world, position) => {
      const wind = { direction: world.wind!.direction + (position.x < world.width / 2 ? 0 : Math.PI), speed: position.y / 10 };
      samples.push({ point: { ...position }, ...wind });
      return wind;
    };
    const display = new WindMapDisplay({ sampler });
    display.update({ tick: 0, map: map() }, 0);
    const indicator = display.sample(point, 0);
    const canvas = createCanvas(260, 280);
    display.draw(canvas.getContext('2d') as never, rect, 0);
    const grid = samples.slice(1);
    expect(grid).toHaveLength(16);
    expect(grid[0]).toEqual({ point, ...indicator });
    expect(grid.at(-1)?.point).toEqual({ x: 1400, y: 700 });
    expect(new Set(grid.map((sample) => sample.direction))).toEqual(new Set([0, Math.PI]));
    expect(new Set(grid.map((sample) => sample.speed))).toEqual(new Set([10, 30, 50, 70]));
  });

  it('projects positive world Y down and preserves direction when map axes have different scales', () => {
    expect(projectWindDirection(0, map(), rect)).toBe(0);
    expect(projectWindDirection(Math.PI / 2, map(), rect)).toBeCloseTo(Math.PI / 2);
    expect(projectWindDirection(Math.PI / 4, map(), rect)).toBeCloseTo(Math.atan2(2, 1));
    expect(projectWindDirection(-Math.PI / 2, map(), rect)).toBeCloseTo(-Math.PI / 2);
  });

  it('clips arrows and the weather sweep to the minimap and restores canvas state', () => {
    const canvas = createCanvas(260, 280), ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ff007f'; ctx.fillRect(0, 0, 260, 280);
    ctx.strokeStyle = '#123456'; ctx.lineWidth = 7;
    drawMinimapWind(ctx as never, map(), rect, () => ({ direction: Math.PI / 4, speed: 80 }), { pulse: 1, sweep: .5 });
    expect(ctx.lineWidth).toBe(7);
    expect(ctx.getTransform().isIdentity).toBe(true);
    const data = ctx.getImageData(0, 0, 260, 280).data;
    let changedInside = 0, escaped = 0;
    for (let y = 0; y < 280; y++) for (let x = 0; x < 260; x++) {
      const color = Array.from(data.slice((y * 260 + x) * 4, (y * 260 + x) * 4 + 4));
      if (x < rect.x || x >= rect.x + rect.width || y < rect.y || y >= rect.y + rect.height) {
        if (color[0] !== 255 || color[1] !== 0 || color[2] !== 127 || color[3] !== 255) escaped++;
      } else if (color[0] !== 255 || color[1] !== 0 || color[2] !== 127) changedInside++;
    }
    expect(escaped).toBe(0);
    expect(changedInside).toBeGreaterThan(rect.width * rect.height * .9);
    // The canvas package's style getter caches the last assignment across restore,
    // so verify the restored stroke with pixels, which also checks the removed clip.
    ctx.beginPath(); ctx.moveTo(0, 5); ctx.lineTo(10, 5); ctx.stroke();
    expect(Array.from(ctx.getImageData(5, 5, 1, 1).data)).toEqual([18, 52, 86, 255]);
  });
});
