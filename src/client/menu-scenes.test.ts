import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it, vi } from 'vitest';
import * as simulation from '../shared/sim';
import { UNIT_DEFS } from '../shared/catalog';
import { SIM_TICKS_PER_SECOND } from '../shared/time';
import { shipProfile } from '../shared/ship-geometry';
import { createI18n } from './i18n';
import { createMatchThreadHost } from './match-worker/host';
import type { MatchThreadPort } from './match-worker/adapter';
import { MENU_SCENES, MenuBackdrop, type MenuBattleThreads } from './menu-scenes';
import { worldLabelsFor, type WorldFrame } from './world-renderer';

const context = () => createCanvas(320, 180).getContext('2d') as unknown as CanvasRenderingContext2D;
const labels = worldLabelsFor(createI18n('en'));
const actors = (frame: WorldFrame) => frame.snapshot.units.map(unit => ({ id: unit.id, x: unit.x, y: unit.y, hp: unit.hp, owner: unit.owner }));
const brightness = (ctx: CanvasRenderingContext2D) => {
  const pixels = ctx.getImageData(0, 0, 320, 180).data;
  let light = 0;
  for (let index = 0; index < pixels.length; index += 4) light += pixels[index]! + pixels[index + 1]! + pixels[index + 2]!;
  return light / (pixels.length / 4 * 3);
};
const authored = MENU_SCENES.flatMap((scene, index) => 'presentation' in scene.create() ? [index] : []);
const battles = MENU_SCENES.flatMap((scene, index) => 'battle' in scene.create() ? [index] : []);
// The match thread's own host, answering in this thread: what a worker would run, without the worker.
const inProcessThreads = (started: string[]): MenuBattleThreads => () => {
  const port: MatchThreadPort = { onmessage: null, postMessage(message) { started.push(message.type); host.handle(message); } };
  const host = createMatchThreadHost(event => port.onmessage?.({ data: event }));
  return { port, terminate: () => started.push('terminated') };
};
const paintVisibleWorld = (frames: WorldFrame[]) => (frame: WorldFrame) => {
  frame.ctx.fillStyle = '#e8dfc1';
  frame.ctx.fillRect(0, 0, 320, 180);
  frames.push(frame);
};

describe('bounded home scenes using the world presentation', () => {
  it('passes only the selected pirate scene future asset recipe without adding it to the current world',()=>{
    for(let index=0;index<MENU_SCENES.length;index++){
      const backdrop=new MenuBackdrop(labels,index),current=backdrop.prepare(0);
      expect(current.corpses??[]).toHaveLength(0);expect(current.tick).toBe(0);
      const preparation=backdrop.artPreparation;
      if(MENU_SCENES[index]!.id==='fleet'){
        expect(preparation?.corpses).toHaveLength(3);
        expect(preparation?.models?.('menu/marine')).toBeDefined();
      }else expect(preparation).toBeUndefined();
      expect(backdrop.prepare(0)).toBe(current);expect(current.corpses??[]).toHaveLength(0);
    }
  });
  it('starts the opening at the first visible frame after slow preparation while retaining the same prepared cast',()=>{
    const scene=MENU_SCENES[2]!,run=scene.create(),create=vi.spyOn(scene,'create').mockReturnValue(run);
    try{
      const backdrop=new MenuBackdrop(labels,2,inProcessThreads([])),frames:WorldFrame[]=[],ctx=context();
      backdrop.prepare(9000);
      const corpses=backdrop.artPreparation!.corpses,models=backdrop.artPreparation!.models;
      const game=run.game;
      backdrop.startPresentation(12000);
      backdrop.draw(ctx,320,180,12000,false,frame=>frames.push(frame));
      expect(frames[0]!.snapshot.tick).toBe(0);expect(frames[0]!.snapshot.corpses??[]).toHaveLength(0);
      expect(run.game).toBe(game);expect(backdrop.artPreparation!.corpses).toBe(corpses);
      expect(backdrop.artPreparation!.models).toBe(models);expect(create).toHaveBeenCalledOnce();
      backdrop.draw(ctx,320,180,40000,false,frame=>frames.push(frame));
      backdrop.startPresentation(43000);
      backdrop.draw(ctx,320,180,43000,false,frame=>frames.push(frame));
      expect(frames[2]!.snapshot.tick).toBe(0);expect(frames[2]!.snapshot.corpses??[]).toHaveLength(0);
      expect(frames[2]!.facing).not.toBe(frames[1]!.facing);expect(frames[2]!.animation).not.toBe(frames[1]!.animation);
      expect(frames[2]!.motion).not.toBe(frames[1]!.motion);expect(create).toHaveBeenCalledOnce();
    }finally{create.mockRestore();}
  });
  it('keeps the three independent scenes and spawns each cast on its support domain', () => {
    expect(MENU_SCENES.map(scene => scene.id)).toEqual(['capital', 'woods', 'fleet']);
    expect(battles.map(index => MENU_SCENES[index]!.id)).toEqual(['woods', 'fleet']);
    for (const scene of MENU_SCENES) {
      const run = scene.create(), terrain = run.game.map.terrain!;
      if ('presentation' in run) {
        expect(run.length).toBeGreaterThan(30);
        expect(run.length).toBeLessThanOrEqual(90);
      }
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

  it('advances authored presentation clocks and forwards local assets without stepping the match simulation', () => {
    const step = vi.spyOn(simulation, 'stepGame');
    try {
      for (const index of authored) {
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

  it.each(battles)('fights battle %i with the match simulation on its thread, one thread per battle', (index) => {
    const started: string[] = [], backdrop = new MenuBackdrop(labels, index, inProcessThreads(started)), frames: WorldFrame[] = [], ctx = context();
    const opening = backdrop.prepare(0);
    for (let now = 0; now <= 12_000; now += 50) backdrop.draw(ctx, 320, 180, now, false, frame => frames.push(frame));
    expect(started.filter(type => type === 'scene')).toHaveLength(1);
    expect(frames[0]!.snapshot.tick).toBe(0);
    expect(frames.at(-1)!.snapshot.tick).toBeGreaterThan(10 * SIM_TICKS_PER_SECOND);
    // The armies have closed and struck: the simulation moved them, not a script.
    expect(JSON.stringify(frames.at(-1)!.snapshot.units.map(unit => [unit.x, unit.y]))).not.toBe(JSON.stringify(opening.units.map(unit => [unit.x, unit.y])));
    expect(frames.some(frame => frame.snapshot.effects.some(effect => effect.type === 'hit'))).toBe(true);
    // Another scene ends this battle's thread.
    backdrop.next();
    expect(started.at(-1)).toBe('terminated');
  });

  it.each(battles)('fades out a decided battle %i after its aftermath and opens a fresh one', (index) => {
    const scene = MENU_SCENES[index]!, original = scene.create;
    // A battle already all but over: one side down to its last fighter.
    const create = vi.spyOn(scene, 'create').mockImplementation(seed => {
      const run = original(seed), loser = run.game.activePlayers[0]!;
      run.game.units = run.game.units.filter((unit, at, all) => unit.owner !== loser || all.findIndex(other => other.owner === loser) === at);
      return run;
    });
    try {
      const backdrop = new MenuBackdrop(labels, index), frames: WorldFrame[] = [], ctx = context();
      backdrop.prepare(0);
      let now = 0;
      for (; now <= 60_000 && create.mock.calls.length < 2; now += 50) backdrop.draw(ctx, 320, 180, now, false, paintVisibleWorld(frames));
      expect(create).toHaveBeenCalledTimes(2);
      expect(frames.at(-1)!.snapshot.tick).toBe(0);
      expect(brightness(ctx)).toBeLessThan(16);
    } finally { create.mockRestore(); }
  });

  it('holds actors and camera at the still frame with reduced motion', () => {
    for (let index = 0; index < MENU_SCENES.length; index++) {
      const backdrop = new MenuBackdrop(labels, index), frames: WorldFrame[] = [], ctx = context();
      const reference = MENU_SCENES[index]!.create().stillSecond ?? 0;
      backdrop.prepare(0);
      backdrop.draw(ctx, 320, 180, 2000, true, frame => frames.push(frame));
      backdrop.draw(ctx, 320, 180, 7000, true, frame => frames.push(frame));
      expect(frames.map(frame => frame.snapshot.tick)).toEqual([reference, reference].map(second => Math.floor(second * SIM_TICKS_PER_SECOND)));
      expect(actors(frames[1]!)).toEqual(actors(frames[0]!));
      expect(frames[1]!.view).toEqual(frames[0]!.view);
    }
  });

  it.each(MENU_SCENES.map((scene, index) => [scene.id, index] as const))(
    'keeps the reduced-motion %s composition visible through its ending and after five minutes',
    (_id, index) => {
      const scene = MENU_SCENES[index]!, run = scene.create();
      const create = vi.spyOn(scene, 'create');
      try {
        const backdrop = new MenuBackdrop(labels, index), frames: WorldFrame[] = [], ctx = context();
        const end = (run.length ?? 150) * 1000;
        backdrop.prepare(0);
        for (const now of [0, 2_000, end - 1_500, end - 1_000, end - 100, end, end + 100, end + 1_500, end * 2, 300_000]) {
          backdrop.draw(ctx, 320, 180, now, true, paintVisibleWorld(frames));
          const frame = frames.at(-1)!;
          expect(brightness(ctx), `visible at ${now}ms`).toBeGreaterThan(80);
          expect(frame.snapshot.tick).toBe(Math.floor((run.stillSecond ?? 0) * SIM_TICKS_PER_SECOND));
          expect(actors(frame)).toEqual(actors(frames[0]!));
          expect(frame.view).toEqual(frames[0]!.view);
        }
        expect(create).toHaveBeenCalledOnce();
        backdrop.draw(ctx, 320, 180, 300_100, false, paintVisibleWorld(frames));
        expect(brightness(ctx)).toBeLessThan(16);
        backdrop.draw(ctx, 320, 180, 300_200, false, paintVisibleWorld(frames));
        expect(frames.at(-1)!.snapshot.tick).toBe(0);
        expect(frames.at(-1)!.animation).not.toBe(frames[0]!.animation);
        expect(brightness(ctx)).toBeLessThan(16);
        expect(create).toHaveBeenCalledTimes(2);
        for (let now = 300_250; now <= 302_200; now += 50) backdrop.draw(ctx, 320, 180, now, false, paintVisibleWorld(frames));
        expect(frames.at(-1)!.snapshot.tick).toBe(2 * SIM_TICKS_PER_SECOND);
        expect(brightness(ctx)).toBeGreaterThan(80);
      } finally { create.mockRestore(); }
    },
  );

  it('fades and creates a clean new cast when an authored scene finishes', () => {
    for (const index of authored) {
      const backdrop = new MenuBackdrop(labels, index), frames: WorldFrame[] = [], ctx = context();
      const length = MENU_SCENES[index]!.create().length!;
      backdrop.prepare(0);
      backdrop.draw(ctx, 320, 180, 0, false, paintVisibleWorld(frames));
      expect(brightness(ctx)).toBeLessThan(16);
      backdrop.draw(ctx, 320, 180, length * 1000 - 1500, false, paintVisibleWorld(frames));
      expect(brightness(ctx)).toBeGreaterThan(80);
      backdrop.draw(ctx, 320, 180, length * 1000 + 1, false, paintVisibleWorld(frames));
      expect(brightness(ctx)).toBeLessThan(16);
      backdrop.draw(ctx, 320, 180, length * 1000 + 100, false, paintVisibleWorld(frames));
      expect(brightness(ctx)).toBeLessThan(16);
      expect(frames[3]!.snapshot.tick).toBe(0);
      expect(actors(frames[3]!)).toEqual(actors(frames[0]!));
      expect(frames[3]!.snapshot.effects).toEqual(frames[0]!.snapshot.effects);
      backdrop.draw(ctx, 320, 180, length * 1000 + 2100, false, paintVisibleWorld(frames));
      expect(brightness(ctx)).toBeGreaterThan(80);
    }
  });
});
