import { describe, expect, it } from 'vitest';
import { sketchScene } from '../sdk/scene';
import { issuePlayerCommand, removeUnit, restoreSnapshotIntoGame, snapshotGame, stepGame, createGame } from './sim';
import { checksumGame } from './sim/checksum';
import type { UnitKind } from './types';

function scene(kind: 'archer' | 'sparkArcher' = 'sparkArcher', id = 'spark', targetKind: UnitKind = 'graniteGolem') {
  return sketchScene('small-ground-fire').replaceDefaults()
    .player('us', { race: kind === 'archer' ? 'grove' : 'ember', team: 'a' })
    .player('foe', { team: 'b' }).townHall('us', 500, 500).townHall('foe', 3500, 3500)
    .unit('us', kind, 1000, 1000, { id })
    .unit('foe', targetKind, 1250, 1000, { id: 'target', order: { type: 'hold', x: 1250, y: 1000 } });
}

function ignite() {
  const game = scene().unit('foe', 'footman', 1290, 1000, { id: 'near', order: { type: 'hold', x: 1290, y: 1000 } })
    .unit('foe', 'footman', 1400, 1000, { id: 'far', order: { type: 'hold', x: 1400, y: 1000 } })
    .unit('us', 'footman', 1250, 1040, { id: 'ally', order: { type: 'hold', x: 1250, y: 1040 } }).build().createGame();
  issuePlayerCommand(game, 'us', { type: 'attack', unitIds: ['spark'], targetId: 'target' });
  for (let tick = 0; tick < 600 && !game.effects.some(effect => effect.type === 'burningGround'); tick++) stepGame(game);
  expect(game.effects.some(effect => effect.type === 'burningGround')).toBe(true);
  issuePlayerCommand(game, 'us', { type: 'holdPosition', unitIds: ['spark'] });
  removeUnit(game, 'spark');
  return game;
}

describe('Spark Archer ground fire', () => {
  it('burns a small enemy cluster for six seconds, preserves allied units and stays where the arrow landed', () => {
    const game = ignite(), fire = game.effects.find(effect => effect.type === 'burningGround')!;
    expect(fire.radius).toBe(38);
    expect(fire.duration).toBe(120);
    const at = { x: fire.x, y: fire.y };
    const near = game.units.find(unit => unit.id === 'near')!, far = game.units.find(unit => unit.id === 'far')!;
    const ally = game.units.find(unit => unit.id === 'ally')!;
    const hp = { near: near.hp, far: far.hp, ally: ally.hp };
    issuePlayerCommand(game, 'foe', { type: 'move', unitIds: ['target'], x: 1600, y: 1000 });
    for (let tick = 0; tick < 120; tick++) stepGame(game);
    expect(near.hp).toBeLessThan(hp.near);
    expect(near.effects.some(effect => effect.type === 'scorch')).toBe(true);
    expect(far.hp).toBe(hp.far);
    expect(ally.hp).toBe(hp.ally);
    expect({ x: fire.x, y: fire.y }).toEqual(at);
    expect(Math.hypot(game.units.find(unit => unit.id === 'target')!.x - fire.x, game.units.find(unit => unit.id === 'target')!.y - fire.y)).toBeGreaterThan(150);
    expect(game.effects.some(effect => effect.type === 'burningGround')).toBe(false);
  });

  it('preserves the remaining burn and subsequent state across save and restore after the shooter dies', () => {
    const game = ignite(), restored = createGame('bareDuel');
    restoreSnapshotIntoGame(restored, snapshotGame(game), game.nextId);
    for (let tick = 0; tick < 140; tick++) { stepGame(game); stepGame(restored); }
    expect(snapshotGame(restored)).toEqual(snapshotGame(game));
    expect(checksumGame(restored)).toBe(checksumGame(game));
  });

  it('trades a little single-target damage for higher damage against stationary clustered troops', () => {
    const damage = (kind: 'archer' | 'sparkArcher', clustered: boolean) => {
      let total = 0, arrows = 0, fires = 0;
      for (let sample = 0; sample < 48; sample++) {
        let builder = scene(kind, `shooter-${sample}`, 'footman');
        for (let index = 0; index < 4; index++) {
          const x = clustered ? 1250 + (index % 2 ? 35 : -35) : 1650 + index * 80;
          const y = clustered ? 1000 + (index < 2 ? 35 : -35) : 1100;
          builder = builder.unit('foe', 'footman' as UnitKind, x, y, { order: { type: 'hold', x, y } });
        }
        const game = builder.build().createGame();
        const seen = new Set<string>();
        game.observer = { hit(source, target, taken, before) {
          if (target.owner === 'foe') total += Math.min(taken, before);
          if (source.kind === 'sparkArcher' && taken === 9) arrows++;
        } };
        issuePlayerCommand(game, 'us', { type: 'attack', unitIds: [`shooter-${sample}`], targetId: 'target' });
        for (let tick = 0; tick < 360; tick++) {
          stepGame(game);
          for (const effect of game.effects) if (effect.type === 'burningGround' && !seen.has(effect.id)) { seen.add(effect.id); fires++; }
        }
      }
      if (kind === 'sparkArcher') { expect(fires / arrows).toBeGreaterThan(.1); expect(fires / arrows).toBeLessThan(.2); }
      console.log({ kind, clustered, arrows, fires });
      return total / 48 / 18;
    };
    const grove = damage('archer', false), emberSolo = damage('sparkArcher', false), emberCluster = damage('sparkArcher', true);
    console.log({ grove, emberSolo, emberCluster });
    expect(emberSolo).toBeLessThan(grove);
    expect(emberSolo).toBeGreaterThan(grove * .85);
    expect(emberCluster).toBeGreaterThan(grove * 1.4);
  });
});
