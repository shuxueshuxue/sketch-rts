import { describe, expect, it } from 'vitest';
import { createGame } from '../../shared/sim';
import { checksumGame } from '../../shared/sim/checksum';
import { Director } from '../../story/director';
import { wait } from '../../story/ops';
import { Stage } from '../../story/stage';
import { instant, seconds } from '../../story/time';
import { World } from '../../story/world';
import { UnitAnimationTracker } from '../../client/unit-animation';
import { fireRain, piercingShot } from './powers';

function scene(spell: boolean, emit = true) {
  const game = createGame('bareDuel', { players: ['a'], aiPlayers: [], scenario: { replaceDefaultUnits: true, replaceDefaultBuildings: true, replaceDefaultResources: true, replaceDefaultMercenaryCamps: true, replaceDefaultLandmarks: true } });
  game.scriptedVictory = true;
  const caster = game.spawnUnit('a', 'archer', 1000, 1000);
  const target = game.spawnUnit('a', 'footman', 1200, 1000);
  const director = new Director({ id: 'power-animation', game, player: 'a', vars: {}, story: function* (self) {
    const world = new World(game, self.stage, {}, () => self.random());
    if (spell) yield* fireRain({ radius: 50, damage: 10, windUp: .5, least: 1 }).cast(caster, target, world);
    else yield* piercingShot(() => 1).cast(caster, target, world);
    yield* wait(seconds(10));
  } });
  if (!emit) director.stage.unitAction = () => {};
  director.begin();
  return { game, caster, target, director };
}

describe('scripted power release animation', () => {
  it.each([false, true])('starts recovery on actual release, with spell=%s, without changing the simulation', spell => {
    const { game, caster, director } = scene(spell);
    const control = scene(spell, false);
    const tracker = new UnitAnimationTracker();
    const release = seconds(spell ? .5 : .4);
    for (let tick = 0; tick <= release + seconds(1.1); tick++) {
      if (tick) { director.advance(); control.director.advance(); }
      expect(checksumGame(game)).toBe(checksumGame(control.game));
      const cues = director.stage.view().unitActions;
      tracker.update(game, tick * 50, cues);
      if (tick < release) expect(cues).toBeUndefined();
      if (tick === release) {
        expect(cues).toMatchObject([{ unitId: caster.id, tick: release, mode: spell ? 'cast' : 'attack', fromX: caster.x, fromY: caster.y, toX: 1200, toY: 1000 }]);
        expect(tracker.frame(caster, tick * 50)).toMatchObject({ mode: spell ? 'cast' : 'attack', frame: 0 });
        expect(game.effects.some(effect => effect.type === (spell ? 'storm' : 'projectile'))).toBe(true);
      }
      if (tick === release + seconds(.7)) expect(tracker.frame(caster, tick * 50).mode).toBe('idle');
      if (tick > release + seconds(1)) expect(cues).toBeUndefined();
    }
  });

  it('does not emit a release when the target died during arrow preparation', () => {
    const { director, target } = scene(false);
    target.hp = 0;
    for (let tick = 0; tick < seconds(1); tick++) director.advance();
    expect(director.stage.view().unitActions).toBeUndefined();
  });

  it('bounds event memory by living casters and restores recent releases without mutating saved data', () => {
    const { game, caster, director } = scene(true);
    const before = checksumGame(game);
    for (let i = 0; i < 100; i++) director.stage.unitAction(caster, i % 2 ? 'cast' : 'attack');
    expect(checksumGame(game)).toBe(before);
    const memory = director.stage.memory();
    expect(memory.unitActions).toHaveLength(1);
    const restored = new Stage(game, () => instant(game.tick));
    restored.restore(memory);
    expect(restored.view().unitActions).toEqual(memory.unitActions);
    memory.unitActions![0]!.tick = 999;
    expect(restored.view().unitActions![0]!.tick).toBe(0);
    caster.hp = 0;
    restored.tick();
    expect(restored.view().unitActions).toBeUndefined();
  });
});
