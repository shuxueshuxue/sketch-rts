import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it, vi } from 'vitest';
import * as simulation from '../shared/sim';
import { UNIT_DEFS } from '../shared/catalog';
import { SIM_TICKS_PER_SECOND } from '../shared/time';
import { shipProfile } from '../shared/ship-geometry';
import { createI18n } from './i18n';
import { MENU_SCENES, MenuBackdrop } from './menu-scenes';
import { worldLabelsFor, type WorldFrame } from './world-renderer';

const context = () => createCanvas(320, 180).getContext('2d') as unknown as CanvasRenderingContext2D;
const labels = worldLabelsFor(createI18n('en'));
const actors = (frame: WorldFrame) => frame.snapshot.units.map(unit => ({ id: unit.id, x: unit.x, y: unit.y, hp: unit.hp, owner: unit.owner }));

describe('bounded home scenes using the world presentation', () => {
  it('keeps the three independent scenes and spawns each cast on its support domain', () => {
    expect(MENU_SCENES.map(scene => scene.id)).toEqual(['capital', 'woods', 'fleet']);
    for (const scene of MENU_SCENES) {
      const run = scene.create(), terrain = run.game.map.terrain!;
      expect(run.presentation).toBe(true);
      expect(run.length).toBeGreaterThan(30);
      expect(run.length).toBeLessThanOrEqual(90);
      for (const unit of run.game.units) {
        if (unit.deck) {
          expect(run.game.units.some(ship => ship.id === unit.deck!.shipId && shipProfile(ship))).toBe(true);
          continue;
        }
        const cell = terrain.cells[Math.floor(unit.y / terrain.cell) * terrain.cols + Math.floor(unit.x / terrain.cell)];
        expect(UNIT_DEFS[unit.kind].naval ? ['~', ','] : ['.', ',']).toContain(cell);
      }
    }
  });

  it('advances presentation clocks and forwards local assets without stepping the match simulation', () => {
    const step = vi.spyOn(simulation, 'stepGame');
    try {
      for (let index = 0; index < MENU_SCENES.length; index++) {
        const scene = MENU_SCENES[index]!, run = scene.create();
        const create = vi.spyOn(scene, 'create').mockReturnValue(run);
        try {
          const backdrop = new MenuBackdrop(labels, index), frames: WorldFrame[] = [], ctx = context();
          backdrop.prepare(0);
          for (const now of [0, 5_000, 12_000]) backdrop.draw(ctx, 320, 180, now, false, frame => frames.push(frame));
          expect(frames).toHaveLength(3);
          expect(frames.map(frame => frame.snapshot.tick)).toEqual([0, 5 * SIM_TICKS_PER_SECOND, 12 * SIM_TICKS_PER_SECOND]);
          expect(frames[2]!.models).toBe(run.models);
          expect(frames[2]!.buildingModels).toBe(run.buildingModels);
          expect(frames.every(frame => frame.story && frame.props && frame.animation && frame.combat)).toBe(true);
        } finally { create.mockRestore(); }
      }
      expect(step).not.toHaveBeenCalled();
    } finally { step.mockRestore(); }
  });

  it('holds actors and camera at the authored still frame with reduced motion', () => {
    for (let index = 0; index < MENU_SCENES.length; index++) {
      const backdrop = new MenuBackdrop(labels, index), frames: WorldFrame[] = [], ctx = context();
      const reference = MENU_SCENES[index]!.create().stillSecond!;
      backdrop.prepare(0);
      backdrop.draw(ctx, 320, 180, 2000, true, frame => frames.push(frame));
      backdrop.draw(ctx, 320, 180, 7000, true, frame => frames.push(frame));
      expect(frames.map(frame => frame.snapshot.tick)).toEqual([reference, reference].map(second => Math.floor(second * SIM_TICKS_PER_SECOND)));
      expect(actors(frames[1]!)).toEqual(actors(frames[0]!));
      expect(frames[1]!.view).toEqual(frames[0]!.view);
    }
  });

  it('fades and creates a clean new cast when a bounded scene finishes', () => {
    for (let index = 0; index < MENU_SCENES.length; index++) {
      const backdrop = new MenuBackdrop(labels, index), frames: WorldFrame[] = [], ctx = context();
      const length = MENU_SCENES[index]!.create().length!;
      backdrop.prepare(0);
      backdrop.draw(ctx, 320, 180, 0, false, frame => frames.push(frame));
      backdrop.draw(ctx, 320, 180, length * 1000 + 1, false, frame => frames.push(frame));
      backdrop.draw(ctx, 320, 180, length * 1000 + 100, false, frame => frames.push(frame));
      expect(frames[2]!.snapshot.tick).toBe(0);
      expect(actors(frames[2]!)).toEqual(actors(frames[0]!));
      expect(frames[2]!.snapshot.effects).toEqual(frames[0]!.snapshot.effects);
    }
  });
});
