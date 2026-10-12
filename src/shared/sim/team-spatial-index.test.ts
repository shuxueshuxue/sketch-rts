import { describe, expect, it } from 'vitest';
import { createUnit } from '../map';
import { createGame, restoreSnapshotIntoGame, snapshotGame, stepGame, type Game } from '../sim';
import type { Unit } from '../types';
import { checksumGame } from './checksum';

function scene() {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.buildings = []; game.items = []; game.resources = [];
  game.mercenaryCamps = []; game.shops = []; game.obstacles = []; game.effects = []; game.projectiles = [];
  game.scriptedVictory = true;
  delete game.map.terrain;
  game.teams.player = 'home'; game.teams.enemy = 'hostile';
  const guard = createUnit('guard', 'player', 'archer', 1000, 1000);
  const first = createUnit('first', 'enemy', 'footman', 1130, 970);
  const second = createUnit('second', 'enemy', 'footman', 1130, 1030);
  for (const unit of [guard, first, second]) {
    unit.cooldown = 9999;
    unit.order = { type: 'hold', x: unit.x, y: unit.y };
  }
  game.units = [guard, first, second];
  return { game, guard, first, second };
}

function reacquire(game: Game): Unit {
  const guard = game.units.find(unit => unit.id === 'guard')!;
  guard.order = { type: 'idle' };
  stepGame(game);
  return guard;
}

function targetId(unit: Unit) {
  return unit.order.type === 'attack' ? unit.order.targetId : undefined;
}

describe('team spatial membership across actual simulation frames', () => {
  it('reuses the internal map for movement within a cell while target acquisition reads live coordinates', () => {
    const { game, first } = scene();
    expect(targetId(reacquire(game))).toBe('first');
    const indexes = game.unitSpatialByTeam;
    first.x += 2;
    expect(targetId(reacquire(game))).toBe('second');
    expect(game.unitSpatialByTeam).toBe(indexes);
  });

  it('regroups mutable owners and teams before acquisition, even with unchanged cells and unit order', () => {
    const { game, first } = scene();
    expect(targetId(reacquire(game))).toBe('first');
    const beforeCapture = game.unitSpatialByTeam;
    first.owner = 'player';
    expect(targetId(reacquire(game))).toBe('second');
    expect(game.unitSpatialByTeam).not.toBe(beforeCapture);
    const hostile = game.unitSpatialByTeam!.get('hostile')!;
    expect([...hostile.buckets.values()].flat().map(unit => unit.id)).toEqual(['second']);

    const beforeAlliance = game.unitSpatialByTeam;
    game.teams.enemy = 'home';
    expect(targetId(reacquire(game))).toBeUndefined();
    expect(game.unitSpatialByTeam).not.toBe(beforeAlliance);
    expect([...game.unitSpatialByTeam!.keys()]).toEqual(['home']);
  });

  it('rebuilds first-team and bucket visit order after an in-place source reorder', () => {
    const { game } = scene();
    expect(targetId(reacquire(game))).toBe('first');
    const indexes = game.unitSpatialByTeam;
    game.units.reverse();
    expect(targetId(reacquire(game))).toBe('second');
    expect(game.unitSpatialByTeam).not.toBe(indexes);
    expect([...game.unitSpatialByTeam!.keys()]).toEqual(['hostile', 'home']);
    const hostile = game.unitSpatialByTeam!.get('hostile')!;
    expect([...hostile.buckets.values()].flat().map(unit => unit.id)).toEqual(['second', 'first']);
  });

  it('rebuilds after a same-length replacement with the same ID, team and cell', () => {
    const { game, first } = scene();
    expect(targetId(reacquire(game))).toBe('first');
    const indexes = game.unitSpatialByTeam;
    const replacement = createUnit(first.id, first.owner, first.kind, first.x + 10, first.y);
    replacement.cooldown = 9999;
    replacement.order = { type: 'hold', x: replacement.x, y: replacement.y };
    game.units[1] = replacement;
    expect(targetId(reacquire(game))).toBe('second');
    expect(game.unitSpatialByTeam).not.toBe(indexes);
    const hostile = game.unitSpatialByTeam!.get('hostile')!;
    const members = [...hostile.buckets.values()].flat();
    expect(members).toContain(replacement);
    expect(members).not.toContain(first);
  });

  it('invalidates independent cell coordinates even when their combined numeric bucket key aliases', () => {
    const { game, first } = scene();
    reacquire(game);
    const indexes = game.unitSpatialByTeam;
    const originalX = Math.floor(first.x / 230), originalY = Math.floor(first.y / 230);
    // One x cell and minus 1000 y cells preserve x*1000+y, but change both extents.
    first.x += 230; first.y -= 230000;
    const changedX = Math.floor(first.x / 230), changedY = Math.floor(first.y / 230);
    expect(changedX * 1000 + changedY).toBe(originalX * 1000 + originalY);
    expect(targetId(reacquire(game))).toBe('second');
    expect(game.unitSpatialByTeam).not.toBe(indexes);
    const hostile = game.unitSpatialByTeam!.get('hostile')!;
    expect(hostile.left).toBe(4); expect(hostile.right).toBe(changedX);
    expect(hostile.top).toBe(changedY); expect(hostile.bottom).toBe(4);
  });

  it('matches ordinary fresh rebuilding through movement, captures, alliances, reordering and restore', () => {
    const game = scene().game, fresh = scene().game;
    restoreSnapshotIntoGame(fresh, snapshotGame(game), game.nextId);
    let freshIndexes = fresh.unitSpatialByTeam;
    // An untracked map copy forces the original rebuild path without changing its entries or queries.
    Object.defineProperty(fresh, 'unitSpatialByTeam', {
      configurable: true,
      get: () => freshIndexes && new Map(freshIndexes),
      set: (indexes: typeof freshIndexes) => { freshIndexes = indexes; },
    });
    for (let tick = 0; tick < 12; tick += 1) {
      for (const world of [game, fresh]) {
        const first = world.units.find(unit => unit.id === 'first')!;
        if (tick === 2) first.x += 3;
        if (tick === 4) world.units.reverse();
        if (tick === 6) first.owner = 'player';
        if (tick === 8) world.teams.enemy = 'home';
      }
      if (tick === 10) {
        restoreSnapshotIntoGame(game, snapshotGame(game), game.nextId);
        expect(game.unitSpatialByTeam).toBeUndefined();
      }
      reacquire(game); reacquire(fresh);
      expect(checksumGame(game)).toBe(checksumGame(fresh));
    }
  });
});
