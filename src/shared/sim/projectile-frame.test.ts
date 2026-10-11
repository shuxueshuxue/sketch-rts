import { expect, it } from 'vitest';
import { createGame, stepGame } from '../sim';
import type { Projectile } from '../types';

function scene() {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.buildings = []; game.resources = []; game.projectiles = [];
  game.items = []; game.mercenaryCamps = []; game.effects = [];
  delete game.shops; delete game.map.terrain;
  game.scriptedVictory = true;
  const target = game.spawnUnit('enemy', 'footman', 1200, 1200);
  target.order = { type: 'hold', x: target.x, y: target.y };
  const shot = (id: string, remaining: number): Projectile => ({
    id, owner: 'player', attackerId: 'departed-attacker', targetId: target.id,
    fromX: 1400, fromY: 1200, toX: target.x, toY: target.y,
    damage: 5, remaining, duration: remaining,
  });
  return { game, target, shot };
}

it('retains in-flight membership until an impact and keeps projectile countdowns', () => {
  const { game, target, shot } = scene();
  const first = shot('first', 2), second = shot('second', 4);
  game.projectiles = [first, second];
  const initial = game.projectiles, health = target.hp;
  stepGame(game);
  expect(game.projectiles).toBe(initial);
  expect(game.projectiles.map(projectile => projectile.remaining)).toEqual([1, 3]);
  expect(target.hp).toBe(health);
  stepGame(game);
  expect(game.projectiles).not.toBe(initial);
  expect(game.projectiles).toEqual([second]);
  expect(second.remaining).toBe(2);
  expect(target.hp).toBeLessThan(health);
});

it('keeps live-iterator impact order when a hit callback appends shots and replaces the array', () => {
  const { game, target, shot } = scene();
  const due = shot('due', 1), future = shot('future', 4), appended = shot('appended', 3);
  game.projectiles = [due, future];
  const initial = game.projectiles;
  let hits = 0;
  game.observer = { hit: (_attacker, victim) => {
    if (victim.id !== target.id || ++hits !== 1) return;
    initial.push(appended, shot('appended-impact', 1));
    game.projectiles = [shot('replacement', 8)];
  } };
  stepGame(game);
  expect(hits).toBe(2);
  expect(game.projectiles).toEqual([future, appended]);
  expect(game.projectiles.map(projectile => projectile.remaining)).toEqual([3, 2]);
  expect(game.projectiles).not.toBe(initial);
});
