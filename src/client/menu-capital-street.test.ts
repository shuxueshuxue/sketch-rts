import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { snapshotGame } from '../shared/sim';
import { createCapitalStreet } from './menu-capital-street';

const positions = (run: ReturnType<typeof createCapitalStreet>) => run.game.units.map(unit => ({ id: unit.id, x: unit.x, y: unit.y, order: unit.order }));

describe('capital street presentation', () => {
  it('uses a fixed local cast without a match AI, catalogue variants or simulation advancement', () => {
    const run = createCapitalStreet();
    expect(run.presentation).toBe(true);
    expect(run.game.units).toHaveLength(24);
    expect(run.game.activePlayers).toEqual(['lion', 'townsfolk']);
    const before = { tick: run.game.tick, units: run.game.units.map(unit => ({ id: unit.id, kind: unit.kind, hp: unit.hp, maxHp: unit.maxHp })), items: run.game.items, buildings: JSON.stringify(run.game.buildings), variants: run.game.variants, props: JSON.stringify(run.props) };
    for (const time of [2, 15, 32, 65, 90, 5000]) run.script(run.game, time);
    expect(run.game.tick).toBe(before.tick);
    expect(run.game.units.map(unit => ({ id: unit.id, kind: unit.kind, hp: unit.hp, maxHp: unit.maxHp }))).toEqual(before.units);
    expect(run.game.items).toBe(before.items);
    expect(JSON.stringify(run.game.buildings)).toBe(before.buildings);
    expect(run.game.variants).toBe(before.variants);
    expect(JSON.stringify(run.props)).toBe(before.props);
    expect(run.game.units.filter(unit => unit.variant).every(unit => Boolean(run.models?.(unit.variant!)))).toBe(true);
  });

  it('can seek to a scene time without accumulated movement, and never teleports at route joins', () => {
    const run = createCapitalStreet();
    run.script(run.game, 65);
    const later = positions(run);
    run.script(run.game, 8); run.script(run.game, 65);
    expect(positions(run)).toEqual(later);
    const fresh = createCapitalStreet(); fresh.script(fresh.game, 65);
    expect(positions(fresh)).toEqual(later);
    run.script(run.game, 0);
    let maximumStep = 0;
    const moving = new Set<string>();
    for (let frame = 1; frame <= 180 * 30; frame++) {
      const before = new Map(run.game.units.map(unit => [unit.id, { x: unit.x, y: unit.y }]));
      run.script(run.game, frame / 30);
      for (const unit of run.game.units) {
        const previous = before.get(unit.id)!;
        const step = Math.hypot(unit.x - previous.x, unit.y - previous.y);
        maximumStep = Math.max(maximumStep, step);
        if (step > .1) moving.add(unit.id);
        expect(Number.isFinite(unit.x + unit.y)).toBe(true);
        expect(unit.x).toBeGreaterThan(900); expect(unit.x).toBeLessThan(2170);
        expect(unit.y).toBeGreaterThan(750); expect(unit.y).toBeLessThan(1440);
      }
    }
    expect(maximumStep).toBeLessThanOrEqual(28 / 30 + 1e-8);
    expect(moving.size).toBeGreaterThanOrEqual(12);
  });

  it('looks across the street slowly, keeps its authored focus inside the map and retains a fixed reduced-motion view', () => {
    const run = createCapitalStreet();
    expect(run.stillSecond).toBe(15);
    const snapshot = snapshotGame(run.game);
    for (const [width, height] of [[1440, 900], [1280, 720], [390, 844]] as const) {
      let previous = run.frameAt!(0, width, height, snapshot).focus;
      for (let frame = 1; frame <= 90 * 30; frame++) {
        const view = run.frameAt!(frame / 30, width, height, snapshot);
        expect(Math.hypot(view.focus.x - previous.x, view.focus.y - previous.y)).toBeLessThan(.19);
        expect(view.focus.x).toBeGreaterThan(1400); expect(view.focus.x).toBeLessThan(2000);
        expect(view.focus.y).toBeGreaterThan(1050); expect(view.focus.y).toBeLessThan(1250);
        expect(view.zoom).toBeGreaterThan(.8); expect(view.zoom).toBeLessThan(1.5);
        previous = view.focus;
      }
    }
  });

  it('fits every local architecture and decoration into the real 128-pixel prop atlas', () => {
    const run = createCapitalStreet();
    const samples = new Map(run.props.filter(prop => run.painters?.[prop.kind]).map(prop => [`${prop.kind}:${prop.state ?? ''}`, prop]));
    for (const [key, prop] of samples) {
      const canvas = createCanvas(256, 256), brush = canvas.getContext('2d');
      brush.translate(128, 128);
      brush.lineJoin = brush.lineCap = 'round';
      run.painters![prop.kind]!(brush as unknown as CanvasRenderingContext2D, prop.state);
      const pixels = brush.getImageData(0, 0, 256, 256).data;
      let occupied = 0, escaped = 0;
      for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) if (pixels[(y * 256 + x) * 4 + 3]) {
        occupied++;
        if (x < 64 || x >= 192 || y < 64 || y >= 192) escaped++;
      }
      expect(occupied, key).toBeGreaterThan(30);
      expect(escaped, key).toBe(0);
    }
  });
});
